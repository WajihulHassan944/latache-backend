import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type User } from '../../../generated/prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { UserRole } from '../../../common/enums/user-role.enum';
import { AdminAuditService } from '../../admin-audit/admin-audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PaymentsService } from '../../payments/payments.service';
import { PAYMENT_STATUS, PAYMENT_TRANSACTION_KIND } from '../../payments/payments.constants';
import type {
  AdminDisputeActionDto,
  AdminDisputesQueryDto,
} from '../dto';
import { fullName, money, pagination } from '../admin-dashboard.utils';

const ACTIVE_DISPUTE_STATUSES = ['open', 'under_investigation', 'escalated'] as const;
const REFUND_RESOLUTION_TYPES = new Set([
  'full_refund',
  'partial_refund',
  'full_refund_and_warning',
  'partial_refund_and_warning',
]);
const WARNING_RESOLUTION_TYPES = new Set([
  'warning',
  'full_refund_and_warning',
  'partial_refund_and_warning',
]);
const DAY_MS = 86_400_000;

interface AverageRow {
  value: number | string | Prisma.Decimal | null;
}

const disputeDisplayId = (id: string): string => `DSP-${id.slice(-6).toUpperCase()}`;
const bookingDisplayId = (id: number): string => `B-${String(id).padStart(4, '0')}`;
const todayUtc = (): Date => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

@Injectable()
export class AdminDisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AdminAuditService,
  ) {}

  async list(query: AdminDisputesQueryDto) {
    const summary = await this.summary();
    if (query.view === 'resolution_actions') {
      return this.resolutionActions(query, summary);
    }

    const { page, limit, skip } = pagination(query.page, query.limit);
    const where = this.listWhere(query);
    const [rows, totalItems] = await Promise.all([
      this.prisma.taskComplaint.findMany({
        where,
        include: {
          filedBy: { select: { id: true, role: true, firstName: true, lastName: true } },
          assignedAdmin: { select: { id: true, firstName: true, lastName: true, email: true } },
          booking: {
            select: {
              id: true,
              status: true,
              bookingDate: true,
              totalChargedAmount: true,
              serviceAmount: true,
              platformFeeAmount: true,
              commissionRatePercent: true,
              taxAmount: true,
              taxRatePercent: true,
              taxInclusive: true,
              serviceSurchargeAmount: true,
              tipAmount: true,
              donationAmount: true,
              paymentCurrency: true,
              paymentStatus: true,
              customer: { select: { id: true, firstName: true, lastName: true } },
              tasker: { select: { id: true, firstName: true, lastName: true } },
              service: { select: { id: true, name: true, slug: true } },
            },
          },
          _count: { select: { evidences: true, evidenceRequests: true, resolutions: true } },
        },
        orderBy: this.orderBy(query.sort),
        skip,
        take: limit,
      }),
      this.prisma.taskComplaint.count({ where }),
    ]);

    return {
      summary,
      view: query.view ?? 'open',
      items: rows.map((complaint) => this.listItem(complaint)),
      pagination: { page, limit, totalItems, totalPages: Math.ceil(totalItems / limit) },
    };
  }

  async details(id: string) {
    const complaint = await this.prisma.taskComplaint.findUnique({
      where: { id },
      include: {
        filedBy: {
          select: { id: true, role: true, firstName: true, lastName: true, email: true, profilePicture: true },
        },
        assignedAdmin: { select: { id: true, firstName: true, lastName: true, email: true } },
        resolvedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        booking: {
          include: {
            customer: {
              select: { id: true, firstName: true, lastName: true, email: true, profilePicture: true, accountStatus: true },
            },
            tasker: {
              select: { id: true, firstName: true, lastName: true, email: true, profilePicture: true, accountStatus: true, rating: true },
            },
            service: { select: { id: true, name: true, slug: true } },
            serviceOption: { select: { id: true, name: true, slug: true } },
            paymentTransactions: { orderBy: { createdAt: 'desc' } },
            workSession: true,
          },
        },
        evidences: {
          orderBy: { createdAt: 'asc' },
          include: {
            uploadedBy: { select: { id: true, role: true, firstName: true, lastName: true } },
            reviewedBy: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        evidenceRequests: {
          orderBy: { createdAt: 'desc' },
          include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
        },
        resolutions: {
          orderBy: { createdAt: 'desc' },
          include: { actor: { select: { id: true, firstName: true, lastName: true, email: true } } },
        },
      },
    });
    if (!complaint) throw new NotFoundException('Dispute not found');

    const audit = await this.prisma.adminAuditLog.findMany({
      where: { entityType: 'dispute', entityId: complaint.id },
      orderBy: { createdAt: 'asc' },
      include: { actor: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
    const refundable = await this.refundableAmount(complaint.booking.id);
    const hasNormalizedInitialEvidence = complaint.evidences.some(
      (evidence) => evidence.source === 'initial_complaint',
    );
    const initialAttachments = hasNormalizedInitialEvidence
      ? []
      : Array.isArray(complaint.attachments)
        ? complaint.attachments
        : [];
    const timeline = this.timeline(complaint, audit);

    return {
      id: complaint.id,
      disputeId: disputeDisplayId(complaint.id),
      status: complaint.status,
      priority: complaint.priority,
      category: complaint.category,
      description: complaint.description,
      filedBy: {
        id: String(complaint.filedBy.id),
        role: complaint.filedBy.role,
        name: fullName(complaint.filedBy.firstName, complaint.filedBy.lastName),
        email: complaint.filedBy.email,
        profilePicture: complaint.filedBy.profilePicture ?? '',
      },
      assignedAdmin: complaint.assignedAdmin
        ? {
            id: String(complaint.assignedAdmin.id),
            name: fullName(complaint.assignedAdmin.firstName, complaint.assignedAdmin.lastName),
            email: complaint.assignedAdmin.email,
          }
        : null,
      booking: {
        id: String(complaint.booking.id),
        bookingId: bookingDisplayId(complaint.booking.id),
        status: complaint.booking.status,
        date: complaint.booking.bookingDate.toISOString().slice(0, 10),
        service: complaint.booking.service,
        serviceOption: complaint.booking.serviceOption,
        customer: {
          id: String(complaint.booking.customer.id),
          name: fullName(complaint.booking.customer.firstName, complaint.booking.customer.lastName),
          email: complaint.booking.customer.email,
          profilePicture: complaint.booking.customer.profilePicture ?? '',
          accountStatus: complaint.booking.customer.accountStatus,
        },
        tasker: {
          id: String(complaint.booking.tasker.id),
          name: fullName(complaint.booking.tasker.firstName, complaint.booking.tasker.lastName),
          email: complaint.booking.tasker.email,
          profilePicture: complaint.booking.tasker.profilePicture ?? '',
          accountStatus: complaint.booking.tasker.accountStatus,
          rating: Number(complaint.booking.tasker.rating),
        },
        workSession: complaint.booking.workSession
          ? {
              status: complaint.booking.workSession.status,
              startedAt: complaint.booking.workSession.startedAt.toISOString(),
              stoppedAt: complaint.booking.workSession.stoppedAt?.toISOString() ?? null,
              notes: complaint.booking.workSession.notes,
            }
          : null,
      },
      payment: {
        source: complaint.booking.paymentSource,
        status: complaint.booking.paymentStatus,
        currency: complaint.booking.paymentCurrency,
        totalChargedAmount: complaint.booking.totalChargedAmount === null ? null : money(complaint.booking.totalChargedAmount),
        refundableAmount: refundable,
        stripePaymentIntentId: complaint.booking.stripePaymentIntentId,
        transactions: complaint.booking.paymentTransactions.map((transaction) => ({
          id: transaction.id,
          kind: transaction.kind,
          provider: transaction.provider,
          providerReference: transaction.providerReference,
          status: transaction.status,
          amount: money(transaction.amount),
          currency: transaction.currency,
          failureReason: transaction.failureReason,
          createdAt: transaction.createdAt.toISOString(),
        })),
      },
      evidenceReview: {
        status: complaint.evidenceReviewStatus,
        reviewedAt: complaint.evidenceReviewedAt?.toISOString() ?? null,
        notes: complaint.evidenceReviewNotes,
        awaitingResponseFrom: complaint.awaitingResponseFrom,
        responseDueAt: complaint.responseDueAt?.toISOString() ?? null,
      },
      evidence: {
        initialAttachments,
        items: complaint.evidences.map((evidence) => ({
          id: evidence.id,
          name: evidence.name,
          publicId: evidence.publicId,
          secureUrl: evidence.secureUrl,
          resourceType: evidence.resourceType,
          bytes: evidence.bytes,
          mimeType: evidence.mimeType,
          source: evidence.source,
          uploadedByRole: evidence.uploadedByRole,
          uploadedBy: evidence.uploadedBy
            ? {
                id: String(evidence.uploadedBy.id),
                role: evidence.uploadedBy.role,
                name: fullName(evidence.uploadedBy.firstName, evidence.uploadedBy.lastName),
              }
            : null,
          reviewedAt: evidence.reviewedAt?.toISOString() ?? null,
          reviewedBy: evidence.reviewedBy
            ? {
                id: String(evidence.reviewedBy.id),
                name: fullName(evidence.reviewedBy.firstName, evidence.reviewedBy.lastName),
              }
            : null,
          createdAt: evidence.createdAt.toISOString(),
        })),
        requests: complaint.evidenceRequests.map((request) => ({
          id: request.id,
          requestedFrom: request.requestedFrom,
          message: request.message,
          status: request.status,
          dueAt: request.dueAt?.toISOString() ?? null,
          fulfilledAt: request.fulfilledAt?.toISOString() ?? null,
          requestedBy: {
            id: String(request.createdBy.id),
            name: fullName(request.createdBy.firstName, request.createdBy.lastName),
          },
          createdAt: request.createdAt.toISOString(),
        })),
      },
      resolution: {
        type: complaint.resolutionType,
        summary: complaint.resolutionSummary,
        amount: complaint.resolutionAmount === null ? null : money(complaint.resolutionAmount),
        currency: complaint.resolutionCurrency,
        resolvedAt: complaint.resolvedAt?.toISOString() ?? null,
        resolvedBy: complaint.resolvedBy
          ? {
              id: String(complaint.resolvedBy.id),
              name: fullName(complaint.resolvedBy.firstName, complaint.resolvedBy.lastName),
              email: complaint.resolvedBy.email,
            }
          : null,
        history: complaint.resolutions.map((resolution) => ({
          id: resolution.id,
          status: resolution.status,
          actionType: resolution.actionType,
          refundAmount: resolution.refundAmount === null ? null : money(resolution.refundAmount),
          currency: resolution.currency,
          warningTarget: resolution.warningTarget,
          notifyParties: resolution.notifyParties,
          summary: resolution.summary,
          refundTransactionId: resolution.refundTransactionId,
          providerRefundId: resolution.providerRefundId,
          providerRefundStatus: resolution.providerRefundStatus,
          failureReason: resolution.failureReason,
          actor: {
            id: String(resolution.actor.id),
            name: fullName(resolution.actor.firstName, resolution.actor.lastName),
            email: resolution.actor.email,
          },
          appliedAt: resolution.appliedAt?.toISOString() ?? null,
          createdAt: resolution.createdAt.toISOString(),
          updatedAt: resolution.updatedAt.toISOString(),
        })),
      },
      escalation: {
        escalatedAt: complaint.escalatedAt?.toISOString() ?? null,
        reason: complaint.escalationReason,
      },
      timeline,
      availableActions: this.availableActions(complaint.status),
      createdAt: complaint.createdAt.toISOString(),
      updatedAt: complaint.updatedAt.toISOString(),
    };
  }

  async action(actor: User, id: string, dto: AdminDisputeActionDto) {
    switch (dto.action) {
      case 'start_investigation':
        return this.startInvestigation(actor, id, dto);
      case 'assign':
        return this.assign(actor, id, dto);
      case 'set_priority':
        return this.setPriority(actor, id, dto);
      case 'escalate':
        return this.escalate(actor, id, dto);
      case 'request_evidence':
        return this.requestEvidence(actor, id, dto);
      case 'add_evidence':
        return this.addEvidence(actor, id, dto);
      case 'review_evidence':
        return this.reviewEvidence(actor, id, dto);
      case 'save_resolution_draft':
        return this.saveResolutionDraft(actor, id, dto);
      case 'resolve':
        return this.resolve(actor, id, dto);
      case 'reopen':
        return this.reopen(actor, id, dto);
      default:
        throw new BadRequestException('Unsupported dispute action');
    }
  }

  private async startInvestigation(actor: User, id: string, dto: AdminDisputeActionDto) {
    const assignedAdminId = dto.assignedAdminId ?? actor.id;
    await this.assertAdministrator(assignedAdminId);
    await this.prisma.$transaction(async (transaction) => {
      const complaint = await this.lockComplaint(transaction, id);
      this.assertActive(complaint.status);
      await transaction.taskComplaint.update({
        where: { id },
        data: { status: 'under_investigation', assignedAdminId },
      });
      await this.audit.record({
        actorId: actor.id,
        action: 'dispute_investigation_started',
        entityType: 'dispute',
        entityId: id,
        metadata: { assignedAdminId },
      }, transaction);
    });
    return this.details(id);
  }

  private async assign(actor: User, id: string, dto: AdminDisputeActionDto) {
    if (!dto.assignedAdminId) throw new BadRequestException('assignedAdminId is required');
    await this.assertAdministrator(dto.assignedAdminId);
    await this.prisma.$transaction(async (transaction) => {
      const complaint = await this.lockComplaint(transaction, id);
      this.assertActive(complaint.status);
      await transaction.taskComplaint.update({ where: { id }, data: { assignedAdminId: dto.assignedAdminId } });
      await this.audit.record({
        actorId: actor.id,
        action: 'dispute_assigned',
        entityType: 'dispute',
        entityId: id,
        metadata: { assignedAdminId: dto.assignedAdminId },
      }, transaction);
    });
    return this.details(id);
  }

  private async setPriority(actor: User, id: string, dto: AdminDisputeActionDto) {
    if (!dto.priority) throw new BadRequestException('priority is required');
    await this.prisma.$transaction(async (transaction) => {
      const complaint = await this.lockComplaint(transaction, id);
      this.assertActive(complaint.status);
      await transaction.taskComplaint.update({ where: { id }, data: { priority: dto.priority } });
      await this.audit.record({
        actorId: actor.id,
        action: 'dispute_priority_changed',
        entityType: 'dispute',
        entityId: id,
        metadata: { previousPriority: complaint.priority, priority: dto.priority },
      }, transaction);
    });
    return this.details(id);
  }

  private async escalate(actor: User, id: string, dto: AdminDisputeActionDto) {
    const reason = dto.reason?.trim();
    if (!reason || reason.length < 5) throw new BadRequestException('A meaningful escalation reason is required');
    await this.prisma.$transaction(async (transaction) => {
      const complaint = await this.lockComplaint(transaction, id);
      this.assertActive(complaint.status);
      await transaction.taskComplaint.update({
        where: { id },
        data: {
          status: 'escalated',
          priority: complaint.priority === 'normal' ? 'high' : complaint.priority,
          escalatedAt: complaint.escalatedAt ?? new Date(),
          escalationReason: reason,
          assignedAdminId: complaint.assignedAdminId ?? actor.id,
        },
      });
      await this.audit.record({
        actorId: actor.id,
        action: 'dispute_escalated',
        entityType: 'dispute',
        entityId: id,
        reason,
      }, transaction);
    });
    return this.details(id);
  }

  private async requestEvidence(actor: User, id: string, dto: AdminDisputeActionDto) {
    const requestedFrom = dto.requestedFrom;
    const message = dto.message?.trim();
    if (!requestedFrom) throw new BadRequestException('requestedFrom is required');
    if (!message || message.length < 5) throw new BadRequestException('Evidence request message is required');
    const dueAt = dto.dueDate ? new Date(`${dto.dueDate}T23:59:59.999Z`) : null;
    if (dueAt && Number.isNaN(dueAt.getTime())) throw new BadRequestException('Invalid evidence due date');

    await this.prisma.$transaction(async (transaction) => {
      const complaint = await this.lockComplaint(transaction, id);
      this.assertActive(complaint.status);
      const booking = await transaction.booking.findUniqueOrThrow({ where: { id: complaint.bookingId } });
      const requestedRoles: Array<'customer' | 'tasker'> = requestedFrom === 'both'
        ? ['customer', 'tasker']
        : [requestedFrom];

      const requests: Array<{ id: string; requestedFrom: 'customer' | 'tasker' }> = [];
      for (const role of requestedRoles) {
        const request = await transaction.disputeEvidenceRequest.create({
          data: {
            complaintId: id,
            createdById: actor.id,
            requestedFrom: role,
            message,
            dueAt,
          },
        });
        requests.push({ id: request.id, requestedFrom: role });
      }

      await transaction.taskComplaint.update({
        where: { id },
        data: {
          status: complaint.status === 'open' ? 'under_investigation' : complaint.status,
          evidenceReviewStatus: 'needs_more_evidence',
          awaitingResponseFrom: requestedFrom,
          responseDueAt: dueAt,
          assignedAdminId: complaint.assignedAdminId ?? actor.id,
        },
      });

      for (const request of requests) {
        const userId = request.requestedFrom === 'customer' ? booking.customerId : booking.taskerId;
        await this.notifications.create(userId, {
          category: 'tasks',
          type: 'dispute_evidence_requested',
          title: 'More evidence requested',
          body: message,
          entityType: 'dispute',
          entityId: id,
          metadata: { evidenceRequestId: request.id, dueAt: dueAt?.toISOString() ?? null },
        }, transaction);
      }

      await this.audit.record({
        actorId: actor.id,
        action: 'dispute_evidence_requested',
        entityType: 'dispute',
        entityId: id,
        reason: message,
        metadata: {
          requestedFrom,
          evidenceRequestIds: requests.map((request) => request.id),
          dueAt: dueAt?.toISOString() ?? null,
        },
      }, transaction);
    });
    return this.details(id);
  }

  private async addEvidence(actor: User, id: string, dto: AdminDisputeActionDto) {
    if (!dto.evidence?.length) throw new BadRequestException('At least one evidence item is required');
    await this.prisma.$transaction(async (transaction) => {
      const complaint = await this.lockComplaint(transaction, id);
      this.assertActive(complaint.status);
      await transaction.disputeEvidence.createMany({
        data: dto.evidence!.map((evidence) => ({
          complaintId: id,
          uploadedById: actor.id,
          uploadedByRole: actor.role,
          source: 'admin_evidence',
          name: evidence.name,
          publicId: evidence.publicId ?? null,
          secureUrl: evidence.secureUrl,
          resourceType: evidence.resourceType ?? null,
          bytes: evidence.bytes ?? null,
          mimeType: evidence.mimeType ?? null,
        })),
      });
      await transaction.taskComplaint.update({
        where: { id },
        data: { evidenceReviewStatus: 'pending' },
      });
      await this.audit.record({
        actorId: actor.id,
        action: 'dispute_evidence_added',
        entityType: 'dispute',
        entityId: id,
        metadata: { count: dto.evidence!.length },
      }, transaction);
    });
    return this.details(id);
  }

  private async reviewEvidence(actor: User, id: string, dto: AdminDisputeActionDto) {
    const notes = dto.reviewNotes?.trim();
    if (!notes || notes.length < 3) throw new BadRequestException('reviewNotes is required');
    await this.prisma.$transaction(async (transaction) => {
      const complaint = await this.lockComplaint(transaction, id);
      this.assertActive(complaint.status);
      const now = new Date();
      await transaction.disputeEvidence.updateMany({
        where: { complaintId: id, reviewedAt: null },
        data: { reviewedAt: now, reviewedById: actor.id },
      });
      const pendingEvidenceRequests = await transaction.disputeEvidenceRequest.count({
        where: { complaintId: id, status: 'pending' },
      });
      await transaction.taskComplaint.update({
        where: { id },
        data: {
          evidenceReviewStatus: pendingEvidenceRequests > 0 ? 'needs_more_evidence' : 'reviewed',
          evidenceReviewedAt: now,
          evidenceReviewNotes: notes,
          assignedAdminId: complaint.assignedAdminId ?? actor.id,
        },
      });
      await this.audit.record({
        actorId: actor.id,
        action: 'dispute_evidence_reviewed',
        entityType: 'dispute',
        entityId: id,
        reason: notes,
      }, transaction);
    });
    return this.details(id);
  }

  private async saveResolutionDraft(actor: User, id: string, dto: AdminDisputeActionDto) {
    const values = await this.resolutionValues(id, dto, true);
    const resolution = await this.prisma.$transaction(async (transaction) => {
      const complaint = await this.lockComplaint(transaction, id);
      this.assertActive(complaint.status);
      if (dto.resolutionId) {
        const existing = await transaction.disputeResolution.findFirst({
          where: { id: dto.resolutionId, complaintId: id, status: 'draft' },
        });
        if (!existing) throw new NotFoundException('Resolution draft not found');
        return transaction.disputeResolution.update({
          where: { id: existing.id },
          data: { actorId: actor.id, ...values, status: 'draft' },
        });
      }
      return transaction.disputeResolution.create({
        data: { complaintId: id, actorId: actor.id, ...values, status: 'draft' },
      });
    });
    return { draft: this.serializeResolution(resolution), dispute: await this.details(id) };
  }

  private async resolve(actor: User, id: string, dto: AdminDisputeActionDto) {
    const values = await this.resolutionValues(id, dto, false);
    const isRefund = REFUND_RESOLUTION_TYPES.has(values.actionType);
    if (isRefund) this.assertFinanceManage(actor);

    const prepared = await this.prisma.$transaction(async (transaction) => {
      const complaint = await this.lockComplaint(transaction, id);
      this.assertActive(complaint.status);
      const booking = await transaction.booking.findUniqueOrThrow({ where: { id: complaint.bookingId } });
      let refundAmount: number | null = null;
      if (isRefund) {
        const pendingRefundResolution = await transaction.disputeResolution.findFirst({
          where: {
            complaintId: id,
            status: 'processing',
            actionType: { in: [...REFUND_RESOLUTION_TYPES] },
          },
          select: { id: true },
        });
        if (pendingRefundResolution) {
          throw new ConflictException('A refund resolution is already processing for this dispute');
        }
        if (![PAYMENT_STATUS.Paid, PAYMENT_STATUS.PartiallyRefunded].includes(booking.paymentStatus as never)) {
          throw new ConflictException('Refund outcomes require a settled booking payment');
        }
        const remaining = await this.refundableAmount(booking.id, transaction);
        if (remaining <= 0) throw new ConflictException('This booking has no remaining refundable amount');
        const isFull = values.actionType.startsWith('full_refund');
        refundAmount = isFull ? remaining : values.refundAmount;
        if (!refundAmount || refundAmount <= 0) {
          throw new BadRequestException('refundAmount is required for partial refund outcomes');
        }
        if (refundAmount > remaining + 0.0001) {
          throw new ConflictException(`Refund exceeds remaining refundable amount of ${booking.paymentCurrency} ${remaining.toFixed(2)}`);
        }
      }

      let resolution;
      if (dto.resolutionId) {
        const draft = await transaction.disputeResolution.findFirst({
          where: { id: dto.resolutionId, complaintId: id, status: 'draft' },
        });
        if (!draft) throw new NotFoundException('Resolution draft not found');
        resolution = await transaction.disputeResolution.update({
          where: { id: draft.id },
          data: {
            actorId: actor.id,
            ...values,
            refundAmount,
            currency: refundAmount === null ? null : booking.paymentCurrency,
            status: isRefund ? 'processing' : 'applied',
            appliedAt: isRefund ? null : new Date(),
            failureReason: null,
          },
        });
      } else {
        resolution = await transaction.disputeResolution.create({
          data: {
            complaintId: id,
            actorId: actor.id,
            ...values,
            refundAmount,
            currency: refundAmount === null ? null : booking.paymentCurrency,
            status: isRefund ? 'processing' : 'applied',
            appliedAt: isRefund ? null : new Date(),
          },
        });
      }

      if (!isRefund) {
        const dismissed = values.actionType === 'dismiss';
        const now = new Date();
        await transaction.taskComplaint.update({
          where: { id },
          data: {
            status: dismissed ? 'dismissed' : 'resolved',
            resolvedAt: now,
            resolvedById: actor.id,
            resolutionType: values.actionType,
            resolutionSummary: values.summary,
            resolutionAmount: null,
            resolutionCurrency: null,
            awaitingResponseFrom: null,
            responseDueAt: null,
          },
        });
        await this.audit.record({
          actorId: actor.id,
          action: dismissed ? 'dispute_dismissed' : 'dispute_resolved',
          entityType: 'dispute',
          entityId: id,
          reason: values.summary,
          metadata: { actionType: values.actionType },
        }, transaction);
        await this.warningAudit(transaction, actor.id, values.actionType, values.warningTarget, booking, id, values.summary);
        if (values.notifyParties) {
          await this.notifyResolution(transaction, booking.customerId, booking.taskerId, id, values.summary);
        }
      } else {
        await transaction.taskComplaint.update({
          where: { id },
          data: {
            status: complaint.status === 'open' ? 'under_investigation' : complaint.status,
            assignedAdminId: complaint.assignedAdminId ?? actor.id,
          },
        });
        await this.audit.record({
          actorId: actor.id,
          action: 'dispute_refund_submitted',
          entityType: 'dispute',
          entityId: id,
          reason: values.summary,
          metadata: { actionType: values.actionType, refundAmount, currency: booking.paymentCurrency },
        }, transaction);
      }
      return { resolution, booking, refundAmount };
    });

    if (isRefund) {
      const refund = await this.payments.issueDisputeRefund({
        bookingId: prepared.booking.id,
        complaintId: id,
        resolutionId: prepared.resolution.id,
        actorId: actor.id,
        amount: prepared.refundAmount!,
        summary: prepared.resolution.summary,
      });
      return { refund, dispute: await this.details(id) };
    }

    const paymentRelease = await this.payments.releaseDisputeHold(prepared.booking.id);
    return { paymentRelease, dispute: await this.details(id) };
  }

  private async reopen(actor: User, id: string, dto: AdminDisputeActionDto) {
    const reason = dto.reason?.trim();
    if (!reason || reason.length < 5) throw new BadRequestException('A meaningful reopen reason is required');
    await this.prisma.$transaction(async (transaction) => {
      const complaint = await this.lockComplaint(transaction, id);
      if (!['resolved', 'dismissed'].includes(complaint.status)) {
        throw new ConflictException('Only resolved or dismissed disputes can be reopened');
      }
      await transaction.taskComplaint.update({
        where: { id },
        data: {
          status: 'under_investigation',
          assignedAdminId: actor.id,
          resolvedAt: null,
          resolvedById: null,
          resolutionType: null,
          resolutionSummary: null,
          resolutionAmount: null,
          resolutionCurrency: null,
        },
      });
      await this.audit.record({
        actorId: actor.id,
        action: 'dispute_reopened',
        entityType: 'dispute',
        entityId: id,
        reason,
      }, transaction);
    });
    return this.details(id);
  }

  private async resolutionValues(id: string, dto: AdminDisputeActionDto, draft: boolean) {
    let resolutionType = dto.resolutionType;
    let summary = dto.resolutionSummary?.trim();
    let refundAmount = dto.refundAmount ?? null;
    let warningTarget: 'customer' | 'tasker' | 'both' | null = dto.warningTarget ?? null;
    let notifyParties = dto.notifyParties ?? true;

    if (dto.resolutionId && (!resolutionType || !summary)) {
      const existing = await this.prisma.disputeResolution.findFirst({
        where: { id: dto.resolutionId, complaintId: id, status: 'draft' },
      });
      if (!existing) throw new NotFoundException('Resolution draft not found');
      resolutionType ??= existing.actionType as AdminDisputeActionDto['resolutionType'];
      summary ??= existing.summary;
      refundAmount ??= existing.refundAmount === null ? null : Number(existing.refundAmount);
      warningTarget ??= existing.warningTarget as 'customer' | 'tasker' | 'both' | null;
      notifyParties = dto.notifyParties ?? existing.notifyParties;
    }

    if (!resolutionType) throw new BadRequestException('resolutionType is required');
    if (!summary || summary.length < 5) throw new BadRequestException('resolutionSummary is required');
    if (resolutionType.startsWith('partial_refund') && (!refundAmount || refundAmount <= 0)) {
      throw new BadRequestException('refundAmount is required for partial refund outcomes');
    }
    if (WARNING_RESOLUTION_TYPES.has(resolutionType) && !warningTarget) {
      throw new BadRequestException('warningTarget is required for warning outcomes');
    }
    if (draft && resolutionType.startsWith('full_refund')) refundAmount = null;

    return {
      actionType: resolutionType,
      refundAmount,
      warningTarget,
      notifyParties,
      summary,
    };
  }

  private async summary() {
    const today = todayUtc();
    const tomorrow = new Date(today.getTime() + DAY_MS);
    const weekAgo = new Date(Date.now() - 7 * DAY_MS);
    const [
      newToday,
      awaitingResponse,
      totalOpen,
      activeInvestigations,
      highPriority,
      escalatedToday,
      totalEscalated,
      resolvedTotal,
      resolved7d,
      urgentCases,
      actionsTaken7d,
      refundsIssued7d,
      warningsIssued7d,
      casesDismissed7d,
      averageOpenRows,
      averageResolutionRows,
    ] = await Promise.all([
      this.prisma.taskComplaint.count({ where: { createdAt: { gte: today, lt: tomorrow } } }),
      this.prisma.taskComplaint.count({ where: { status: { in: [...ACTIVE_DISPUTE_STATUSES] }, awaitingResponseFrom: { not: null } } }),
      this.prisma.taskComplaint.count({ where: { status: { in: [...ACTIVE_DISPUTE_STATUSES] } } }),
      this.prisma.taskComplaint.count({ where: { status: 'under_investigation' } }),
      this.prisma.taskComplaint.count({ where: { status: { in: [...ACTIVE_DISPUTE_STATUSES] }, priority: { in: ['high', 'urgent'] } } }),
      this.prisma.taskComplaint.count({ where: { escalatedAt: { gte: today, lt: tomorrow } } }),
      this.prisma.taskComplaint.count({ where: { status: 'escalated' } }),
      this.prisma.taskComplaint.count({ where: { status: { in: ['resolved', 'dismissed'] } } }),
      this.prisma.taskComplaint.count({ where: { resolvedAt: { gte: weekAgo } } }),
      this.prisma.taskComplaint.count({ where: { status: { in: [...ACTIVE_DISPUTE_STATUSES] }, priority: 'urgent' } }),
      this.prisma.disputeResolution.count({ where: { status: 'applied', appliedAt: { gte: weekAgo } } }),
      this.prisma.disputeResolution.count({ where: { status: 'applied', appliedAt: { gte: weekAgo }, actionType: { contains: 'refund' } } }),
      this.prisma.disputeResolution.count({ where: { status: 'applied', appliedAt: { gte: weekAgo }, actionType: { contains: 'warning' } } }),
      this.prisma.disputeResolution.count({ where: { status: 'applied', appliedAt: { gte: weekAgo }, actionType: 'dismiss' } }),
      this.prisma.$queryRaw<AverageRow[]>`
        SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - "createdAt")) / 86400.0), 0) AS value
        FROM "TaskComplaints"
        WHERE "status" = 'under_investigation'
      `,
      this.prisma.$queryRaw<AverageRow[]>`
        SELECT COALESCE(AVG(EXTRACT(EPOCH FROM ("resolvedAt" - "createdAt")) / 86400.0), 0) AS value
        FROM "TaskComplaints"
        WHERE "resolvedAt" IS NOT NULL
      `,
    ]);
    return {
      open: { newToday, awaitingResponse, totalOpen },
      investigation: {
        activeInvestigations,
        averageDaysOpen: Number(Number(averageOpenRows[0]?.value ?? 0).toFixed(1)),
        highPriority,
      },
      escalated: {
        escalatedToday,
        awaitingSeniorReview: totalEscalated,
        totalEscalated,
      },
      resolved: {
        resolvedTotal,
        averageResolutionDays: Number(Number(averageResolutionRows[0]?.value ?? 0).toFixed(1)),
        resolved7d,
        satisfaction: {
          trackingAvailable: false,
          rate: null,
          reason: 'No post-dispute satisfaction survey is implemented; the API does not invent a percentage.',
        },
      },
      evidence: { urgentCases, resolved7d },
      resolutionActions: { actionsTaken7d, refundsIssued7d, warningsIssued7d, casesDismissed7d },
    };
  }

  private async resolutionActions(
    query: AdminDisputesQueryDto,
    summary: Awaited<ReturnType<AdminDisputesService['summary']>>,
  ) {
    const { page, limit, skip } = pagination(query.page, query.limit);
    const search = query.search?.trim();
    const displaySuffix = search?.toUpperCase().startsWith('DSP-') ? search.slice(4).trim() : null;
    const bookingSearch = search ? Number.parseInt(search.replace(/^(BKG-|B-)/i, ''), 10) : Number.NaN;
    const appliedAt = this.dateRange(query.from, query.to);
    const complaintFilter: Prisma.TaskComplaintWhereInput = {
      ...(query.priority && query.priority !== 'all' ? { priority: query.priority } : {}),
      ...(query.assignedAdminId ? { assignedAdminId: query.assignedAdminId } : {}),
    };
    const hasComplaintFilter = Object.keys(complaintFilter).length > 0;
    const where: Prisma.DisputeResolutionWhereInput = {
      status: 'applied',
      ...(appliedAt ? { appliedAt } : {}),
      ...(hasComplaintFilter ? { complaint: complaintFilter } : {}),
      ...(search
        ? {
            OR: [
              ...(displaySuffix
                ? [{ complaintId: { endsWith: displaySuffix, mode: 'insensitive' as const } }]
                : []),
              ...(Number.isInteger(bookingSearch) && bookingSearch > 0
                ? [{ complaint: { bookingId: bookingSearch } }]
                : []),
              { actionType: { contains: search, mode: 'insensitive' } },
              { summary: { contains: search, mode: 'insensitive' } },
              { complaint: { booking: { customer: { firstName: { contains: search, mode: 'insensitive' } } } } },
              { complaint: { booking: { customer: { lastName: { contains: search, mode: 'insensitive' } } } } },
              { complaint: { booking: { tasker: { firstName: { contains: search, mode: 'insensitive' } } } } },
              { complaint: { booking: { tasker: { lastName: { contains: search, mode: 'insensitive' } } } } },
            ],
          }
        : {}),
    };

    const [rows, totalItems] = await Promise.all([
      this.prisma.disputeResolution.findMany({
        where,
        include: {
          actor: { select: { id: true, firstName: true, lastName: true } },
          complaint: {
            include: {
              booking: {
                select: {
                  id: true,
                  customer: { select: { id: true, firstName: true, lastName: true } },
                  tasker: { select: { id: true, firstName: true, lastName: true } },
                },
              },
            },
          },
        },
        orderBy: { appliedAt: query.sort === 'oldest' ? 'asc' : 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.disputeResolution.count({ where }),
    ]);
    return {
      summary,
      view: 'resolution_actions',
      items: rows.map((resolution) => ({
        id: resolution.id,
        disputeId: disputeDisplayId(resolution.complaintId),
        bookingId: bookingDisplayId(resolution.complaint.booking.id),
        actionType: resolution.actionType,
        refundAmount: resolution.refundAmount === null ? null : money(resolution.refundAmount),
        currency: resolution.currency,
        warningTarget: resolution.warningTarget,
        summary: resolution.summary,
        providerRefundStatus: resolution.providerRefundStatus,
        customer: fullName(
          resolution.complaint.booking.customer.firstName,
          resolution.complaint.booking.customer.lastName,
        ),
        tasker: fullName(
          resolution.complaint.booking.tasker.firstName,
          resolution.complaint.booking.tasker.lastName,
        ),
        actor: {
          id: String(resolution.actor.id),
          name: fullName(resolution.actor.firstName, resolution.actor.lastName),
        },
        appliedAt: resolution.appliedAt?.toISOString() ?? null,
      })),
      pagination: { page, limit, totalItems, totalPages: Math.ceil(totalItems / limit) },
    };
  }

  private listWhere(query: AdminDisputesQueryDto): Prisma.TaskComplaintWhereInput {
    const search = query.search?.trim();
    const displaySuffix = search?.toUpperCase().startsWith('DSP-') ? search.slice(4).trim() : null;
    const bookingSearch = search ? Number.parseInt(search.replace(/^(BKG-|B-)/i, ''), 10) : Number.NaN;
    const createdAt = this.dateRange(query.from, query.to);
    const base: Prisma.TaskComplaintWhereInput = {
      ...(createdAt ? { createdAt } : {}),
      ...(query.priority && query.priority !== 'all' ? { priority: query.priority } : {}),
      ...(query.assignedAdminId ? { assignedAdminId: query.assignedAdminId } : {}),
      ...(search
        ? {
            OR: [
              ...(displaySuffix ? [{ id: { endsWith: displaySuffix, mode: 'insensitive' as const } }] : []),
              ...(Number.isInteger(bookingSearch) && bookingSearch > 0 ? [{ bookingId: bookingSearch }] : []),
              { category: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
              { booking: { customer: { firstName: { contains: search, mode: 'insensitive' } } } },
              { booking: { customer: { lastName: { contains: search, mode: 'insensitive' } } } },
              { booking: { tasker: { firstName: { contains: search, mode: 'insensitive' } } } },
              { booking: { tasker: { lastName: { contains: search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    switch (query.view ?? 'open') {
      case 'open':
        return { ...base, status: 'open' };
      case 'under_investigation':
        return { ...base, status: 'under_investigation' };
      case 'escalated':
        return { ...base, status: 'escalated' };
      case 'resolved':
        return { ...base, status: { in: ['resolved', 'dismissed'] } };
      case 'evidence_review':
        return {
          AND: [
            base,
            {
              status: { in: [...ACTIVE_DISPUTE_STATUSES] },
              OR: [
                { evidenceReviewStatus: { in: ['pending', 'needs_more_evidence'] } },
                { evidences: { some: { reviewedAt: null } } },
              ],
            },
          ],
        };
      case 'all':
      default:
        return base;
    }
  }

  private orderBy(sort: AdminDisputesQueryDto['sort']): Prisma.TaskComplaintOrderByWithRelationInput[] {
    if (sort === 'oldest') return [{ createdAt: 'asc' }];
    if (sort === 'amount_desc') return [{ booking: { totalChargedAmount: 'desc' } }, { createdAt: 'desc' }];
    if (sort === 'priority') return [{ priority: 'desc' }, { createdAt: 'desc' }];
    return [{ createdAt: 'desc' }];
  }

  private listItem(complaint: any) {
    const amount = complaint.booking.totalChargedAmount === null
      ? money(
          Number(complaint.booking.serviceAmount ?? 0) +
            Number(complaint.booking.platformFeeAmount) +
            (complaint.booking.taxInclusive ? 0 : Number(complaint.booking.taxAmount ?? 0)) +
            Number(complaint.booking.serviceSurchargeAmount ?? 0) +
            Number(complaint.booking.tipAmount) +
            Number(complaint.booking.donationAmount),
        )
      : money(complaint.booking.totalChargedAmount);
    return {
      id: complaint.id,
      disputeId: disputeDisplayId(complaint.id),
      bookingId: bookingDisplayId(complaint.booking.id),
      category: complaint.category,
      reason: complaint.category.replaceAll('_', ' '),
      description: complaint.description,
      status: complaint.status,
      priority: complaint.priority,
      amount: { amount, currency: complaint.booking.paymentCurrency },
      paymentStatus: complaint.booking.paymentStatus,
      date: complaint.createdAt.toISOString().slice(0, 10),
      customer: {
        id: String(complaint.booking.customer.id),
        name: fullName(complaint.booking.customer.firstName, complaint.booking.customer.lastName),
      },
      tasker: {
        id: String(complaint.booking.tasker.id),
        name: fullName(complaint.booking.tasker.firstName, complaint.booking.tasker.lastName),
      },
      service: complaint.booking.service,
      filedBy: {
        id: String(complaint.filedBy.id),
        role: complaint.filedBy.role,
        name: fullName(complaint.filedBy.firstName, complaint.filedBy.lastName),
      },
      assignedAdmin: complaint.assignedAdmin
        ? {
            id: String(complaint.assignedAdmin.id),
            name: fullName(complaint.assignedAdmin.firstName, complaint.assignedAdmin.lastName),
          }
        : null,
      evidenceReviewStatus: complaint.evidenceReviewStatus,
      awaitingResponseFrom: complaint.awaitingResponseFrom,
      responseDueAt: complaint.responseDueAt?.toISOString() ?? null,
      counts: complaint._count,
      createdAt: complaint.createdAt.toISOString(),
      updatedAt: complaint.updatedAt.toISOString(),
    };
  }

  private async lockComplaint(transaction: Prisma.TransactionClient, id: string) {
    await transaction.$queryRaw`SELECT "id" FROM "TaskComplaints" WHERE "id" = ${id} FOR UPDATE`;
    const complaint = await transaction.taskComplaint.findUnique({ where: { id } });
    if (!complaint) throw new NotFoundException('Dispute not found');
    return complaint;
  }

  private assertActive(status: string): void {
    if (!ACTIVE_DISPUTE_STATUSES.includes(status as never)) {
      throw new ConflictException('This dispute is already closed; reopen it before applying active-case actions');
    }
  }

  private async assertAdministrator(id: number): Promise<void> {
    const admin = await this.prisma.user.findFirst({
      where: { id, role: { in: [UserRole.Admin, UserRole.SuperAdmin] }, accountStatus: 'active', deletedAt: null },
      select: { id: true, role: true, permissions: true },
    });
    if (!admin) throw new BadRequestException('Assigned administrator is unavailable');
    if (admin.role !== UserRole.SuperAdmin && !admin.permissions.includes('support.read')) {
      throw new BadRequestException('Assigned administrator does not have support.read access');
    }
  }

  private assertFinanceManage(actor: User): void {
    if (actor.role === UserRole.SuperAdmin) return;
    if (!actor.permissions.includes('finance.manage')) {
      throw new ForbiddenException('Refund resolutions require finance.manage in addition to support.manage');
    }
  }

  private async refundableAmount(bookingId: number, transaction?: Prisma.TransactionClient): Promise<number> {
    const db = transaction ?? this.prisma;
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      select: { totalChargedAmount: true },
    });
    if (!booking?.totalChargedAmount) return 0;
    const refunds = await db.paymentTransaction.aggregate({
      where: {
        bookingId,
        kind: PAYMENT_TRANSACTION_KIND.Refund,
        status: { in: ['processing', 'pending', 'succeeded'] },
      },
      _sum: { amount: true },
    });
    return Math.max(0, money(Number(booking.totalChargedAmount) - Number(refunds._sum.amount ?? 0)));
  }

  private async warningAudit(
    transaction: Prisma.TransactionClient,
    actorId: number,
    actionType: string,
    warningTarget: string | null,
    booking: { customerId: number; taskerId: number },
    complaintId: string,
    summary: string,
  ): Promise<void> {
    if (!WARNING_RESOLUTION_TYPES.has(actionType) || !warningTarget) return;
    const targets = warningTarget === 'both'
      ? [booking.customerId, booking.taskerId]
      : warningTarget === 'customer'
        ? [booking.customerId]
        : [booking.taskerId];
    for (const targetUserId of targets) {
      await this.audit.record({
        actorId,
        targetUserId,
        action: 'dispute_warning_issued',
        entityType: 'dispute',
        entityId: complaintId,
        reason: summary,
      }, transaction);
    }
  }

  private async notifyResolution(
    transaction: Prisma.TransactionClient,
    customerId: number,
    taskerId: number,
    complaintId: string,
    summary: string,
  ): Promise<void> {
    for (const userId of [customerId, taskerId]) {
      await this.notifications.create(userId, {
        category: 'tasks',
        type: 'booking_dispute_resolved',
        title: 'Booking dispute resolved',
        body: summary.slice(0, 500),
        entityType: 'dispute',
        entityId: complaintId,
      }, transaction);
    }
  }

  private serializeResolution(resolution: {
    id: string;
    status: string;
    actionType: string;
    refundAmount: Prisma.Decimal | null;
    currency: string | null;
    warningTarget: string | null;
    notifyParties: boolean;
    summary: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: resolution.id,
      status: resolution.status,
      actionType: resolution.actionType,
      refundAmount: resolution.refundAmount === null ? null : money(resolution.refundAmount),
      currency: resolution.currency,
      warningTarget: resolution.warningTarget,
      notifyParties: resolution.notifyParties,
      summary: resolution.summary,
      createdAt: resolution.createdAt.toISOString(),
      updatedAt: resolution.updatedAt.toISOString(),
    };
  }

  private availableActions(status: string): string[] {
    if (status === 'resolved' || status === 'dismissed') return ['reopen'];
    return [
      'start_investigation',
      'assign',
      'set_priority',
      'escalate',
      'request_evidence',
      'add_evidence',
      'review_evidence',
      'save_resolution_draft',
      'resolve',
    ];
  }

  private timeline(complaint: any, audit: any[]) {
    const events: Array<Record<string, unknown> & { at: string }> = [
      {
        type: 'dispute_opened',
        at: complaint.createdAt.toISOString(),
        label: `Dispute opened by ${fullName(complaint.filedBy.firstName, complaint.filedBy.lastName)}`,
      },
    ];
    if (complaint.escalatedAt) {
      events.push({ type: 'dispute_escalated', at: complaint.escalatedAt.toISOString(), label: complaint.escalationReason ?? 'Escalated' });
    }
    for (const evidence of complaint.evidences) {
      events.push({ type: 'evidence_added', at: evidence.createdAt.toISOString(), label: evidence.name, evidenceId: evidence.id });
    }
    for (const request of complaint.evidenceRequests) {
      events.push({ type: 'evidence_requested', at: request.createdAt.toISOString(), label: request.message, requestId: request.id });
    }
    for (const resolution of complaint.resolutions) {
      events.push({ type: `resolution_${resolution.status}`, at: (resolution.appliedAt ?? resolution.createdAt).toISOString(), label: resolution.summary, resolutionId: resolution.id });
    }
    for (const event of audit) {
      events.push({
        type: event.action,
        at: event.createdAt.toISOString(),
        label: event.reason ?? event.action.replaceAll('_', ' '),
        actor: event.actor ? fullName(event.actor.firstName, event.actor.lastName) : null,
      });
    }
    return events.sort((a, b) => a.at.localeCompare(b.at));
  }

  private dateRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
    if ((from && !to) || (!from && to)) throw new BadRequestException('from and to must be supplied together');
    if (!from || !to) return undefined;
    const start = new Date(`${from}T00:00:00.000Z`);
    const end = new Date(`${to}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid dispute date range');
    }
    if (start > end) throw new BadRequestException('from must be earlier than or equal to to');
    return { gte: start, lt: new Date(end.getTime() + DAY_MS) };
  }
}
