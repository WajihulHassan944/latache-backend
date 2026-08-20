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
import {
  PAYMENT_SOURCE,
  PAYMENT_STATUS,
  PAYMENT_TRANSACTION_KIND,
} from '../../payments/payments.constants';
import { DisputeLifecycleService } from '../../disputes/dispute-lifecycle.service';
import type { AdminDisputeActionDto, AdminDisputesQueryDto } from '../dto';
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

interface DisputeListRow {
  id: string;
  category: string;
  description: string;
  status: string;
  priority: string;
  evidenceReviewStatus: string;
  awaitingResponseFrom: string | null;
  responseDueAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  filedByRole: string;
  filedBy: {
    id: number;
    role: string;
    firstName: string | null;
    lastName: string | null;
  };
  assignedAdmin: {
    id: number;
    firstName: string | null;
    lastName: string | null;
  } | null;
  booking: {
    id: number;
    totalChargedAmount: Prisma.Decimal | null;
    serviceAmount: Prisma.Decimal | null;
    platformFeeAmount: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    taxInclusive: boolean;
    serviceSurchargeAmount: Prisma.Decimal;
    tipAmount: Prisma.Decimal;
    donationAmount: Prisma.Decimal;
    paymentCurrency: string;
    paymentStatus: string;
    customer: { id: number; firstName: string | null; lastName: string | null };
    tasker: { id: number; firstName: string | null; lastName: string | null };
    service: { id: number; name: string | null; slug: string | null };
  };
  _count: { evidences: number; evidenceRequests: number; resolutions: number };
}

interface DisputeTimelineSource {
  createdAt: Date;
  escalatedAt: Date | null;
  escalationReason: string | null;
  filedBy: { firstName: string | null; lastName: string | null };
  evidences: Array<{ id: string; name: string; createdAt: Date }>;
  evidenceRequests: Array<{ id: string; message: string; createdAt: Date }>;
  resolutions: Array<{
    id: string;
    status: string;
    summary: string;
    appliedAt: Date | null;
    createdAt: Date;
  }>;
}

interface DisputeAuditTimelineEvent {
  action: string;
  reason: string | null;
  createdAt: Date;
  actor: { firstName: string | null; lastName: string | null } | null;
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
    private readonly disputes: DisputeLifecycleService,
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
          select: {
            id: true,
            role: true,
            firstName: true,
            lastName: true,
            email: true,
            profilePicture: true,
          },
        },
        assignedAdmin: { select: { id: true, firstName: true, lastName: true, email: true } },
        resolvedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        booking: {
          include: {
            customer: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                profilePicture: true,
                accountStatus: true,
                customerProfile: { select: { status: true } },
              },
            },
            tasker: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                profilePicture: true,
                accountStatus: true,
                taskerProfile: { select: { status: true, rating: true } },
                rating: true,
              },
            },
            service: { select: { id: true, name: true, slug: true } },
            serviceOption: { select: { id: true, name: true, slug: true } },
            paymentTransactions: { orderBy: { createdAt: 'desc' } },
            workSession: true,
            stripeChargebacks: { orderBy: { updatedAt: 'desc' } },
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
          include: {
            actor: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
        participantActions: {
          orderBy: { createdAt: 'asc' },
          include: { user: { select: { id: true, role: true, firstName: true, lastName: true } } },
        },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { author: { select: { id: true, role: true, firstName: true, lastName: true } } },
        },
        satisfactionSurveys: {
          orderBy: { createdAt: 'asc' },
          include: { user: { select: { id: true, role: true, firstName: true, lastName: true } } },
        },
        deliveries: { orderBy: { createdAt: 'desc' } },
        cashRefunds: {
          orderBy: { createdAt: 'desc' },
          include: {
            confirmedBy: { select: { id: true, firstName: true, lastName: true } },
            resolution: { select: { id: true, actionType: true, summary: true } },
          },
        },
        disciplinaryActions: {
          orderBy: { createdAt: 'asc' },
          include: {
            user: { select: { id: true, role: true, firstName: true, lastName: true } },
            actor: { select: { id: true, firstName: true, lastName: true } },
          },
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
      lifecycle: {
        filingDeadlineAt: complaint.filingDeadlineAt?.toISOString() ?? null,
        slaDueAt: complaint.slaDueAt?.toISOString() ?? null,
        slaBreachedAt: complaint.slaBreachedAt?.toISOString() ?? null,
        withdrawnAt: complaint.withdrawnAt?.toISOString() ?? null,
        appealCount: complaint.appealCount,
      },
      filedBy: {
        id: String(complaint.filedBy.id),
        role: complaint.filedByRole,
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
          accountStatus: complaint.booking.customer.customerProfile?.status ?? complaint.booking.customer.accountStatus,
        },
        tasker: {
          id: String(complaint.booking.tasker.id),
          name: fullName(complaint.booking.tasker.firstName, complaint.booking.tasker.lastName),
          email: complaint.booking.tasker.email,
          profilePicture: complaint.booking.tasker.profilePicture ?? '',
          accountStatus: complaint.booking.tasker.taskerProfile?.status ?? complaint.booking.tasker.accountStatus,
          rating: Number(complaint.booking.tasker.taskerProfile?.rating ?? complaint.booking.tasker.rating),
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
        totalChargedAmount:
          complaint.booking.totalChargedAmount === null
            ? null
            : money(complaint.booking.totalChargedAmount),
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
        stripeChargebacks: complaint.booking.stripeChargebacks.map((chargeback) => ({
          id: chargeback.id,
          status: chargeback.status,
          reason: chargeback.reason,
          amount: money(chargeback.amount),
          currency: chargeback.currency,
          evidenceDueBy: chargeback.evidenceDueBy?.toISOString() ?? null,
          chargeId: chargeback.chargeId,
          paymentIntentId: chargeback.paymentIntentId,
          latestStripeEventType: chargeback.latestStripeEventType,
          openedAt: chargeback.openedAt.toISOString(),
          closedAt: chargeback.closedAt?.toISOString() ?? null,
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
          reminderSentAt: request.reminderSentAt?.toISOString() ?? null,
          overdueAt: request.overdueAt?.toISOString() ?? null,
          expiredAt: request.expiredAt?.toISOString() ?? null,
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
          proposedAt: resolution.proposedAt?.toISOString() ?? null,
          proposalResponseDueAt: resolution.proposalResponseDueAt?.toISOString() ?? null,
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
      participantActivity: {
        actions: complaint.participantActions.map((action) => ({
          id: action.id,
          action: action.action,
          resolutionId: action.resolutionId,
          message: action.message,
          user: {
            id: String(action.user.id),
            role: action.userRole,
            name: fullName(action.user.firstName, action.user.lastName),
          },
          createdAt: action.createdAt.toISOString(),
        })),
        comments: complaint.comments.map((comment) => ({
          id: comment.id,
          body: comment.body,
          author: {
            id: String(comment.author.id),
            role: comment.authorRole,
            name: fullName(comment.author.firstName, comment.author.lastName),
          },
          createdAt: comment.createdAt.toISOString(),
        })),
        satisfaction: complaint.satisfactionSurveys.map((survey) => ({
          id: survey.id,
          rating: survey.rating,
          comment: survey.comment,
          user: {
            id: String(survey.user.id),
            role: survey.userRole,
            name: fullName(survey.user.firstName, survey.user.lastName),
          },
          createdAt: survey.createdAt.toISOString(),
          updatedAt: survey.updatedAt.toISOString(),
        })),
      },
      cashRefunds: complaint.cashRefunds.map((refund) => ({
        id: refund.id,
        resolutionId: refund.resolutionId,
        status: refund.status,
        amount: money(refund.amount),
        currency: refund.currency,
        manualTransferReference: refund.manualTransferReference,
        confirmationNotes: refund.confirmationNotes,
        confirmedBy: refund.confirmedBy
          ? { id: String(refund.confirmedBy.id), name: fullName(refund.confirmedBy.firstName, refund.confirmedBy.lastName) }
          : null,
        confirmedAt: refund.confirmedAt?.toISOString() ?? null,
        createdAt: refund.createdAt.toISOString(),
      })),
      disciplinaryActions: complaint.disciplinaryActions.map((action) => ({
        id: action.id,
        kind: action.kind,
        points: action.points,
        stateBefore: action.stateBefore,
        stateAfter: action.stateAfter,
        reason: action.reason,
        user: { id: String(action.user.id), role: action.targetRole, name: fullName(action.user.firstName, action.user.lastName) },
        actor: action.actor
          ? { id: String(action.actor.id), name: fullName(action.actor.firstName, action.actor.lastName) }
          : null,
        createdAt: action.createdAt.toISOString(),
      })),
      deliveries: complaint.deliveries.map((delivery) => ({
        id: delivery.id,
        recipientId: String(delivery.recipientId),
        channel: delivery.channel,
        eventType: delivery.eventType,
        status: delivery.status,
        attempts: delivery.attempts,
        sentAt: delivery.sentAt?.toISOString() ?? null,
        failureReason: delivery.failureReason,
        createdAt: delivery.createdAt.toISOString(),
      })),
      escalation: {
        escalatedAt: complaint.escalatedAt?.toISOString() ?? null,
        reason: complaint.escalationReason,
      },
      timeline,
      availableActions: this.availableActions(
        complaint.status,
        complaint.cashRefunds.some((refund) => refund.status === 'pending_manual_transfer'),
      ),
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
      case 'propose_resolution':
        return this.proposeResolution(actor, id, dto);
      case 'resolve':
        return this.resolve(actor, id, dto);
      case 'confirm_cash_refund':
        return this.confirmCashRefund(actor, id, dto);
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
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'dispute_investigation_started',
          entityType: 'dispute',
          entityId: id,
          metadata: { assignedAdminId },
        },
        transaction,
      );
      await this.notifyAdminActionParticipants(transaction, complaint.bookingId, id, {
        eventType: 'dispute_investigation_started',
        title: 'Dispute investigation started',
        body: 'Latache has started reviewing the booking dispute.',
        eventKey: `investigation:${assignedAdminId}`,
      });
    });
    return this.details(id);
  }

  private async assign(actor: User, id: string, dto: AdminDisputeActionDto) {
    if (!dto.assignedAdminId) throw new BadRequestException('assignedAdminId is required');
    await this.assertAdministrator(dto.assignedAdminId);
    await this.prisma.$transaction(async (transaction) => {
      const complaint = await this.lockComplaint(transaction, id);
      this.assertActive(complaint.status);
      await transaction.taskComplaint.update({
        where: { id },
        data: { assignedAdminId: dto.assignedAdminId },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'dispute_assigned',
          entityType: 'dispute',
          entityId: id,
          metadata: { assignedAdminId: dto.assignedAdminId },
        },
        transaction,
      );
      await this.notifyAdminActionParticipants(transaction, complaint.bookingId, id, {
        eventType: 'dispute_assignment_updated',
        title: 'Dispute assignment updated',
        body: 'The administrator responsible for the dispute was updated.',
        eventKey: `assignment:${dto.assignedAdminId}`,
      });
    });
    return this.details(id);
  }

  private async setPriority(actor: User, id: string, dto: AdminDisputeActionDto) {
    if (!dto.priority) throw new BadRequestException('priority is required');
    await this.prisma.$transaction(async (transaction) => {
      const complaint = await this.lockComplaint(transaction, id);
      this.assertActive(complaint.status);
      await transaction.taskComplaint.update({ where: { id }, data: { priority: dto.priority } });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'dispute_priority_changed',
          entityType: 'dispute',
          entityId: id,
          metadata: { previousPriority: complaint.priority, priority: dto.priority },
        },
        transaction,
      );
      await this.notifyAdminActionParticipants(transaction, complaint.bookingId, id, {
        eventType: 'dispute_priority_updated',
        title: 'Dispute priority updated',
        body: `The dispute priority is now ${dto.priority}.`,
        eventKey: `priority:${dto.priority}`,
      });
    });
    return this.details(id);
  }

  private async escalate(actor: User, id: string, dto: AdminDisputeActionDto) {
    const reason = dto.reason?.trim();
    if (!reason || reason.length < 5)
      throw new BadRequestException('A meaningful escalation reason is required');
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
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'dispute_escalated',
          entityType: 'dispute',
          entityId: id,
          reason,
        },
        transaction,
      );
      await this.notifyAdminActionParticipants(transaction, complaint.bookingId, id, {
        eventType: 'dispute_escalated',
        title: 'Dispute escalated',
        body: 'The dispute was escalated for additional review.',
        eventKey: `escalated:${complaint.escalatedAt?.toISOString() ?? Date.now()}`,
      });
    });
    return this.details(id);
  }

  private async requestEvidence(actor: User, id: string, dto: AdminDisputeActionDto) {
    const requestedFrom = dto.requestedFrom;
    const message = dto.message?.trim();
    if (!requestedFrom) throw new BadRequestException('requestedFrom is required');
    if (!message || message.length < 5)
      throw new BadRequestException('Evidence request message is required');
    const explicitDueAt = dto.dueDate ? new Date(`${dto.dueDate}T23:59:59.999Z`) : null;
    if (explicitDueAt && Number.isNaN(explicitDueAt.getTime()))
      throw new BadRequestException('Invalid evidence due date');
    if (explicitDueAt && explicitDueAt.getTime() <= Date.now()) {
      throw new BadRequestException('Evidence due date must be in the future');
    }

    await this.prisma.$transaction(async (transaction) => {
      const complaint = await this.lockComplaint(transaction, id);
      this.assertActive(complaint.status);
      const booking = await transaction.booking.findUniqueOrThrow({
        where: { id: complaint.bookingId },
      });
      const policy = await this.disputes.policy(transaction);
      const dueAt = explicitDueAt ?? new Date(Date.now() + policy.evidenceResponseHours * 60 * 60 * 1000);
      const requestedRoles: Array<'customer' | 'tasker'> =
        requestedFrom === 'both' ? ['customer', 'tasker'] : [requestedFrom];

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
        await this.disputes.notifyUser(transaction, id, userId, {
          eventType: 'dispute_evidence_requested',
          title: 'More evidence requested',
          body: message,
          eventKey: request.id,
          metadata: { evidenceRequestId: request.id, dueAt: dueAt?.toISOString() ?? null },
        });
      }

      await this.audit.record(
        {
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
        },
        transaction,
      );
    });
    return this.details(id);
  }

  private async addEvidence(actor: User, id: string, dto: AdminDisputeActionDto) {
    const evidenceItems = dto.evidence;
    if (!evidenceItems?.length) {
      throw new BadRequestException('At least one evidence item is required');
    }
    const verified = await this.disputes.verifyEvidence(actor, evidenceItems);
    const seenPublicIds = new Set<string>();
    const normalized = verified.filter((evidence) => {
      if (seenPublicIds.has(evidence.publicId)) return false;
      seenPublicIds.add(evidence.publicId);
      return true;
    }).map((evidence) => ({
      ...evidence,
      name:
        evidenceItems.find((item) => item.publicId === evidence.publicId)?.name?.trim() ||
        evidence.originalFileName ||
        'Admin dispute evidence',
    }));
    await this.prisma.$transaction(async (transaction) => {
      const complaint = await this.lockComplaint(transaction, id);
      this.assertActive(complaint.status);
      const existing = await transaction.disputeEvidence.findMany({
        where: { complaintId: id, publicId: { in: normalized.map((item) => item.publicId) } },
        select: { publicId: true },
      });
      const existingPublicIds = new Set(
        existing.map((item) => item.publicId).filter((value): value is string => Boolean(value)),
      );
      const newEvidence = normalized.filter((item) => !existingPublicIds.has(item.publicId));
      if (newEvidence.length === 0) return;
      await this.disputes.assertEvidenceCapacity(id, newEvidence, transaction);
      await transaction.disputeEvidence.createMany({
        data: newEvidence.map((evidence) => ({
          complaintId: id,
          uploadedById: actor.id,
          uploadedByRole: actor.role,
          source: 'admin_evidence',
          name: evidence.name,
          publicId: evidence.publicId,
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
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'dispute_evidence_added',
          entityType: 'dispute',
          entityId: id,
          metadata: { count: newEvidence.length },
        },
        transaction,
      );
      await this.notifyAdminActionParticipants(transaction, complaint.bookingId, id, {
        eventType: 'dispute_evidence_received',
        title: 'Evidence added to dispute',
        body: 'Latache added verified evidence to the dispute record.',
        eventKey: `admin-evidence:${newEvidence.map((item) => item.publicId).join('|')}`,
      });
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
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'dispute_evidence_reviewed',
          entityType: 'dispute',
          entityId: id,
          reason: notes,
        },
        transaction,
      );
      await this.notifyAdminActionParticipants(transaction, complaint.bookingId, id, {
        eventType: 'dispute_evidence_reviewed',
        title: 'Dispute evidence reviewed',
        body: 'Latache reviewed the evidence currently attached to the dispute.',
        eventKey: `evidence-review:${now.toISOString()}`,
      });
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


  private async proposeResolution(actor: User, id: string, dto: AdminDisputeActionDto) {
    const values = await this.resolutionValues(id, dto, false);
    const isRefund = REFUND_RESOLUTION_TYPES.has(values.actionType);
    if (isRefund) this.assertFinanceManage(actor);
    const proposed = await this.prisma.$transaction(async (transaction) => {
      const complaint = await this.lockComplaint(transaction, id);
      this.assertActive(complaint.status);
      const booking = await transaction.booking.findUniqueOrThrow({
        where: { id: complaint.bookingId },
      });
      let refundAmount = values.refundAmount;
      if (isRefund) {
        const settled =
          [PAYMENT_STATUS.Paid, PAYMENT_STATUS.PartiallyRefunded].includes(
            booking.paymentStatus as never,
          ) ||
          (booking.paymentSource === PAYMENT_SOURCE.Cash &&
            [PAYMENT_STATUS.CashConfirmed, PAYMENT_STATUS.PartiallyRefunded].includes(
              booking.paymentStatus as never,
            ));
        if (!settled) {
          throw new ConflictException('Refund proposals require a settled online/wallet payment or confirmed cash collection');
        }
        const remaining = await this.refundableAmount(booking.id, transaction);
        if (remaining <= 0) throw new ConflictException('This booking has no remaining refundable amount');
        refundAmount = values.actionType.startsWith('full_refund') ? remaining : refundAmount;
        if (!refundAmount || refundAmount <= 0) {
          throw new BadRequestException('refundAmount is required for partial refund proposals');
        }
        if (refundAmount > remaining + 0.0001) {
          throw new ConflictException(
            `Refund exceeds remaining refundable amount of ${booking.paymentCurrency} ${remaining.toFixed(2)}`,
          );
        }
      }
      const policy = await this.disputes.policy(transaction);
      const responseDueAt = dto.proposalResponseDueDate
        ? new Date(`${dto.proposalResponseDueDate}T23:59:59.999Z`)
        : new Date(Date.now() + policy.settlementResponseHours * 60 * 60 * 1000);
      if (Number.isNaN(responseDueAt.getTime()) || responseDueAt.getTime() <= Date.now()) {
        throw new BadRequestException('Settlement proposal response deadline must be in the future');
      }
      await transaction.disputeResolution.updateMany({
        where: { complaintId: id, status: 'proposed' },
        data: { status: 'superseded' },
      });
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
            status: 'proposed',
            proposedAt: new Date(),
            proposalResponseDueAt: responseDueAt,
            appliedAt: null,
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
            status: 'proposed',
            proposedAt: new Date(),
            proposalResponseDueAt: responseDueAt,
          },
        });
      }
      await transaction.taskComplaint.update({
        where: { id },
        data: {
          status: complaint.status === 'open' ? 'under_investigation' : complaint.status,
          assignedAdminId: complaint.assignedAdminId ?? actor.id,
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'dispute_settlement_proposed',
          entityType: 'dispute',
          entityId: id,
          reason: values.summary,
          metadata: {
            resolutionId: resolution.id,
            actionType: values.actionType,
            refundAmount,
            currency: refundAmount === null ? null : booking.paymentCurrency,
            responseDueAt: responseDueAt.toISOString(),
          },
        },
        transaction,
      );
      await this.disputes.notifyParticipants(transaction, id, booking, {
        eventType: 'dispute_settlement_proposed',
        title: 'Dispute settlement proposed',
        body: 'Latache proposed a settlement. Review the dispute and accept or reject the proposal before the response deadline.',
        eventKey: resolution.id,
        metadata: { resolutionId: resolution.id, responseDueAt: responseDueAt.toISOString() },
      });
      return resolution;
    });
    return { proposal: this.serializeResolution(proposed), dispute: await this.details(id) };
  }

  private async resolve(actor: User, id: string, dto: AdminDisputeActionDto) {
    const values = await this.resolutionValues(id, dto, false);
    const isRefund = REFUND_RESOLUTION_TYPES.has(values.actionType);
    if (isRefund) this.assertFinanceManage(actor);

    const prepared = await this.prisma.$transaction(async (transaction) => {
      const complaintRef = await transaction.taskComplaint.findUnique({
        where: { id },
        select: { bookingId: true },
      });
      if (!complaintRef) throw new NotFoundException('Dispute not found');
      await transaction.$queryRaw`SELECT "id" FROM "Bookings" WHERE "id" = ${complaintRef.bookingId} FOR UPDATE`;
      const complaint = await this.lockComplaint(transaction, id);
      this.assertActive(complaint.status);
      const booking = await transaction.booking.findUniqueOrThrow({
        where: { id: complaint.bookingId },
      });
      let refundAmount: number | null = null;
      const cashRefund =
        isRefund &&
        booking.paymentSource === PAYMENT_SOURCE.Cash &&
        [PAYMENT_STATUS.CashConfirmed, PAYMENT_STATUS.PartiallyRefunded].includes(
          booking.paymentStatus as never,
        );

      if (isRefund) {
        const pendingRefundResolution = await transaction.disputeResolution.findFirst({
          where: {
            complaintId: id,
            status: { in: ['processing', 'processing_manual_transfer'] },
            actionType: { in: [...REFUND_RESOLUTION_TYPES] },
          },
          select: { id: true },
        });
        if (pendingRefundResolution && pendingRefundResolution.id !== dto.resolutionId) {
          throw new ConflictException('A refund resolution is already processing for this dispute');
        }
        const settled =
          [PAYMENT_STATUS.Paid, PAYMENT_STATUS.PartiallyRefunded].includes(
            booking.paymentStatus as never,
          ) || cashRefund;
        if (!settled) {
          throw new ConflictException(
            'Refund outcomes require a settled online/wallet payment or confirmed cash collection',
          );
        }
        const remaining = await this.refundableAmount(booking.id, transaction);
        if (remaining <= 0) {
          throw new ConflictException('This booking has no remaining refundable amount');
        }
        const isFull = values.actionType.startsWith('full_refund');
        refundAmount = isFull ? remaining : values.refundAmount;
        if (!refundAmount || refundAmount <= 0) {
          throw new BadRequestException('refundAmount is required for partial refund outcomes');
        }
        if (refundAmount > remaining + 0.0001) {
          throw new ConflictException(
            `Refund exceeds remaining refundable amount of ${booking.paymentCurrency} ${remaining.toFixed(2)}`,
          );
        }
      }

      let resolution;
      if (dto.resolutionId) {
        const reusable = await transaction.disputeResolution.findFirst({
          where: {
            id: dto.resolutionId,
            complaintId: id,
            status: { in: ['draft', 'accepted'] },
          },
        });
        if (!reusable) {
          throw new NotFoundException('Resolution draft or accepted proposal not found');
        }
        resolution = await transaction.disputeResolution.update({
          where: { id: reusable.id },
          data: {
            actorId: actor.id,
            ...values,
            refundAmount,
            currency: refundAmount === null ? null : booking.paymentCurrency,
            status: isRefund ? (cashRefund ? 'processing_manual_transfer' : 'processing') : 'applied',
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
            status: isRefund ? (cashRefund ? 'processing_manual_transfer' : 'processing') : 'applied',
            appliedAt: isRefund ? null : new Date(),
          },
        });
      }

      if (cashRefund) {
        await transaction.disputeCashRefund.upsert({
          where: { resolutionId: resolution.id },
          create: {
            complaintId: id,
            resolutionId: resolution.id,
            customerId: booking.customerId,
            taskerId: booking.taskerId,
            amount: money(refundAmount),
            currency: booking.paymentCurrency,
            status: 'pending_manual_transfer',
          },
          update: {},
        });
        await transaction.taskComplaint.update({
          where: { id },
          data: {
            status: complaint.status === 'open' ? 'under_investigation' : complaint.status,
            assignedAdminId: complaint.assignedAdminId ?? actor.id,
          },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            action: 'dispute_cash_refund_required',
            entityType: 'dispute',
            entityId: id,
            reason: values.summary,
            metadata: {
              resolutionId: resolution.id,
              amount: refundAmount,
              currency: booking.paymentCurrency,
              execution: 'manual_transfer_required',
            },
          },
          transaction,
        );
        await this.disputes.notifyParticipants(transaction, id, booking, {
          eventType: 'dispute_cash_refund_pending',
          title: 'Cash refund requires transfer confirmation',
          body: `${booking.paymentCurrency} ${Number(refundAmount).toFixed(2)} must be returned through an auditable manual cash/bank transfer. Latache will not mark the refund complete until an authorized administrator confirms the transfer reference.`,
          eventKey: resolution.id,
          metadata: { resolutionId: resolution.id, amount: refundAmount, currency: booking.paymentCurrency },
        });
        return { resolution, booking, refundAmount, cashRefund: true };
      }

      if (!isRefund) {
        const dismissed = values.actionType === 'dismiss';
        const now = new Date();
        await transaction.taskComplaint.update({
          where: { id },
          data: {
            status: dismissed ? 'dismissed' : 'resolved',
            activeBookingKey: null,
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
        await transaction.disputeEvidenceRequest.updateMany({
          where: { complaintId: id, status: { in: ['pending', 'overdue'] } },
          data: { status: 'cancelled' },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            action: dismissed ? 'dispute_dismissed' : 'dispute_resolved',
            entityType: 'dispute',
            entityId: id,
            reason: values.summary,
            metadata: { actionType: values.actionType },
          },
          transaction,
        );
        await this.applyWarningStrikes(
          transaction,
          actor.id,
          resolution.id,
          values.actionType,
          values.warningTarget,
          booking,
          id,
          values.summary,
        );
        await this.disputes.notifyParticipants(transaction, id, booking, {
          eventType: 'booking_dispute_resolved',
          title: 'Booking dispute resolved',
          body: values.summary.slice(0, 500),
          eventKey: resolution.id,
          metadata: { resolutionId: resolution.id, actionType: values.actionType },
        });
      } else {
        await transaction.taskComplaint.update({
          where: { id },
          data: {
            status: complaint.status === 'open' ? 'under_investigation' : complaint.status,
            assignedAdminId: complaint.assignedAdminId ?? actor.id,
          },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            action: 'dispute_refund_submitted',
            entityType: 'dispute',
            entityId: id,
            reason: values.summary,
            metadata: {
              actionType: values.actionType,
              refundAmount,
              currency: booking.paymentCurrency,
            },
          },
          transaction,
        );
      }
      return { resolution, booking, refundAmount, cashRefund: false };
    });

    if (prepared.cashRefund) {
      return {
        cashRefund: {
          status: 'pending_manual_transfer',
          resolutionId: prepared.resolution.id,
          amount: prepared.refundAmount,
          currency: prepared.booking.paymentCurrency,
        },
        dispute: await this.details(id),
      };
    }

    if (isRefund) {
      if (prepared.refundAmount === null) {
        throw new ConflictException('A refund amount was not prepared for this resolution');
      }
      const refund = await this.payments.issueDisputeRefund({
        bookingId: prepared.booking.id,
        complaintId: id,
        resolutionId: prepared.resolution.id,
        actorId: actor.id,
        amount: prepared.refundAmount,
        summary: prepared.resolution.summary,
      });
      return { refund, dispute: await this.details(id) };
    }

    const paymentRelease = await this.payments.releaseDisputeHold(prepared.booking.id);
    return { paymentRelease, dispute: await this.details(id) };
  }

  private async confirmCashRefund(actor: User, id: string, dto: AdminDisputeActionDto) {
    this.assertFinanceManage(actor);
    const reference = dto.manualTransferReference?.trim();
    const notes = dto.confirmationNotes?.trim();
    if (!reference || reference.length < 3) {
      throw new BadRequestException('manualTransferReference is required');
    }
    if (!notes || notes.length < 5) {
      throw new BadRequestException('confirmationNotes is required');
    }
    const result = await this.payments.confirmManualCashDisputeRefund({
      complaintId: id,
      resolutionId: dto.resolutionId,
      actorId: actor.id,
      manualTransferReference: reference,
      confirmationNotes: notes,
    });
    return { cashRefund: result, dispute: await this.details(id) };
  }

  private async reopen(actor: User, id: string, dto: AdminDisputeActionDto) {
    const reason = dto.reason?.trim();
    if (!reason || reason.length < 5) {
      throw new BadRequestException('A meaningful reopen reason is required');
    }
    try {
      await this.prisma.$transaction(async (transaction) => {
        const complaintRef = await transaction.taskComplaint.findUnique({
          where: { id },
          select: { bookingId: true },
        });
        if (!complaintRef) throw new NotFoundException('Dispute not found');
        await transaction.$queryRaw`SELECT "id" FROM "Bookings" WHERE "id" = ${complaintRef.bookingId} FOR UPDATE`;
        const complaint = await this.lockComplaint(transaction, id);
        if (!['resolved', 'dismissed'].includes(complaint.status)) {
          throw new ConflictException('Only resolved or dismissed disputes can be reopened');
        }
        const booking = await transaction.booking.findUniqueOrThrow({ where: { id: complaint.bookingId } });
        const otherActive = await transaction.taskComplaint.findFirst({
          where: {
            bookingId: complaint.bookingId,
            id: { not: id },
            status: { in: [...ACTIVE_DISPUTE_STATUSES] },
          },
          select: { id: true },
        });
        if (otherActive) {
          throw new ConflictException({
            code: 'ACTIVE_DISPUTE_EXISTS',
            message: 'Another active dispute already exists for this booking.',
            disputeId: otherActive.id,
          });
        }
        const policy = await this.disputes.policy(transaction);
        const now = new Date();
        await transaction.taskComplaint.update({
          where: { id },
          data: {
            status: 'under_investigation',
            activeBookingKey: `booking:${complaint.bookingId}`,
            assignedAdminId: actor.id,
            slaDueAt: this.disputes.slaDeadline(now, policy),
            slaBreachedAt: null,
            resolvedAt: null,
            resolvedById: null,
            resolutionType: null,
            resolutionSummary: null,
            resolutionAmount: null,
            resolutionCurrency: null,
            withdrawnAt: null,
            withdrawnById: null,
          },
        });
        if (
          ![
            PAYMENT_STATUS.Paid,
            PAYMENT_STATUS.CashConfirmed,
            PAYMENT_STATUS.PartiallyRefunded,
            PAYMENT_STATUS.Refunded,
            PAYMENT_STATUS.Failed,
          ].includes(booking.paymentStatus as never)
        ) {
          await transaction.booking.update({
            where: { id: booking.id },
            data: { paymentStatus: PAYMENT_STATUS.OnHoldDispute },
          });
        }
        await this.payments.blockTaskerFinanceForDispute(
          booking.id,
          `Dispute ${id} was reopened`,
          transaction,
        );
        await this.audit.record(
          {
            actorId: actor.id,
            action: 'dispute_reopened',
            entityType: 'dispute',
            entityId: id,
            reason,
          },
          transaction,
        );
        await this.disputes.notifyParticipants(transaction, id, booking, {
          eventType: 'dispute_reopened',
          title: 'Booking dispute reopened',
          body: 'Latache reopened this dispute and financial clearance is paused while the case is investigated again.',
          eventKey: `admin-reopen:${now.toISOString()}`,
        });
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      const maybe = error as { code?: string };
      if (maybe?.code === 'P2002') {
        throw new ConflictException('Another active dispute already exists for this booking');
      }
      throw error;
    }
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
        where: { id: dto.resolutionId, complaintId: id, status: { in: ['draft', 'accepted'] } },
      });
      if (!existing) throw new NotFoundException('Resolution draft or accepted proposal not found');
      resolutionType ??= existing.actionType as AdminDisputeActionDto['resolutionType'];
      summary ??= existing.summary;
      refundAmount ??= existing.refundAmount === null ? null : Number(existing.refundAmount);
      warningTarget ??= existing.warningTarget as 'customer' | 'tasker' | 'both' | null;
      notifyParties = dto.notifyParties ?? existing.notifyParties;
    }

    if (!resolutionType) throw new BadRequestException('resolutionType is required');
    if (!summary || summary.length < 5)
      throw new BadRequestException('resolutionSummary is required');
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
      satisfactionAggregate,
      satisfiedResponses,
    ] = await Promise.all([
      this.prisma.taskComplaint.count({ where: { createdAt: { gte: today, lt: tomorrow } } }),
      this.prisma.taskComplaint.count({
        where: {
          status: { in: [...ACTIVE_DISPUTE_STATUSES] },
          awaitingResponseFrom: { not: null },
        },
      }),
      this.prisma.taskComplaint.count({ where: { status: { in: [...ACTIVE_DISPUTE_STATUSES] } } }),
      this.prisma.taskComplaint.count({ where: { status: 'under_investigation' } }),
      this.prisma.taskComplaint.count({
        where: {
          status: { in: [...ACTIVE_DISPUTE_STATUSES] },
          priority: { in: ['high', 'urgent'] },
        },
      }),
      this.prisma.taskComplaint.count({ where: { escalatedAt: { gte: today, lt: tomorrow } } }),
      this.prisma.taskComplaint.count({ where: { status: 'escalated' } }),
      this.prisma.taskComplaint.count({ where: { status: { in: ['resolved', 'dismissed', 'withdrawn'] } } }),
      this.prisma.taskComplaint.count({ where: { resolvedAt: { gte: weekAgo } } }),
      this.prisma.taskComplaint.count({
        where: { status: { in: [...ACTIVE_DISPUTE_STATUSES] }, priority: 'urgent' },
      }),
      this.prisma.disputeResolution.count({
        where: { status: 'applied', appliedAt: { gte: weekAgo } },
      }),
      this.prisma.disputeResolution.count({
        where: {
          status: 'applied',
          appliedAt: { gte: weekAgo },
          actionType: { contains: 'refund' },
        },
      }),
      this.prisma.disputeResolution.count({
        where: {
          status: 'applied',
          appliedAt: { gte: weekAgo },
          actionType: { contains: 'warning' },
        },
      }),
      this.prisma.disputeResolution.count({
        where: { status: 'applied', appliedAt: { gte: weekAgo }, actionType: 'dismiss' },
      }),
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
      this.prisma.disputeSatisfactionSurvey.aggregate({
        where: { complaint: { status: { in: ['resolved', 'dismissed', 'withdrawn'] } } },
        _avg: { rating: true },
        _count: { _all: true },
      }),
      this.prisma.disputeSatisfactionSurvey.count({
        where: {
          rating: { gte: 4 },
          complaint: { status: { in: ['resolved', 'dismissed', 'withdrawn'] } },
        },
      }),
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
          trackingAvailable: true,
          responses: satisfactionAggregate._count._all,
          averageRating:
            satisfactionAggregate._avg.rating === null
              ? null
              : Number(Number(satisfactionAggregate._avg.rating).toFixed(2)),
          satisfiedRatePercent:
            satisfactionAggregate._count._all === 0
              ? null
              : Number(((satisfiedResponses / satisfactionAggregate._count._all) * 100).toFixed(1)),
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
    const bookingSearch = search
      ? Number.parseInt(search.replace(/^(BKG-|B-)/i, ''), 10)
      : Number.NaN;
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
              {
                complaint: {
                  booking: { customer: { firstName: { contains: search, mode: 'insensitive' } } },
                },
              },
              {
                complaint: {
                  booking: { customer: { lastName: { contains: search, mode: 'insensitive' } } },
                },
              },
              {
                complaint: {
                  booking: { tasker: { firstName: { contains: search, mode: 'insensitive' } } },
                },
              },
              {
                complaint: {
                  booking: { tasker: { lastName: { contains: search, mode: 'insensitive' } } },
                },
              },
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
    const bookingSearch = search
      ? Number.parseInt(search.replace(/^(BKG-|B-)/i, ''), 10)
      : Number.NaN;
    const createdAt = this.dateRange(query.from, query.to);
    const base: Prisma.TaskComplaintWhereInput = {
      ...(createdAt ? { createdAt } : {}),
      ...(query.priority && query.priority !== 'all' ? { priority: query.priority } : {}),
      ...(query.assignedAdminId ? { assignedAdminId: query.assignedAdminId } : {}),
      ...(search
        ? {
            OR: [
              ...(displaySuffix
                ? [{ id: { endsWith: displaySuffix, mode: 'insensitive' as const } }]
                : []),
              ...(Number.isInteger(bookingSearch) && bookingSearch > 0
                ? [{ bookingId: bookingSearch }]
                : []),
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
        return { ...base, status: { in: ['resolved', 'dismissed', 'withdrawn'] } };
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

  private orderBy(
    sort: AdminDisputesQueryDto['sort'],
  ): Prisma.TaskComplaintOrderByWithRelationInput[] {
    if (sort === 'oldest') return [{ createdAt: 'asc' }];
    if (sort === 'amount_desc')
      return [{ booking: { totalChargedAmount: 'desc' } }, { createdAt: 'desc' }];
    if (sort === 'priority') return [{ priority: 'desc' }, { createdAt: 'desc' }];
    return [{ createdAt: 'desc' }];
  }

  private listItem(complaint: DisputeListRow) {
    const amount =
      complaint.booking.totalChargedAmount === null
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
        role: complaint.filedByRole,
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
      throw new ConflictException(
        'This dispute is already closed; reopen it before applying active-case actions',
      );
    }
  }

  private async assertAdministrator(id: number): Promise<void> {
    const admin = await this.prisma.user.findFirst({
      where: {
        id,
        role: { in: [UserRole.Admin, UserRole.SuperAdmin] },
        accountStatus: 'active',
        deletedAt: null,
      },
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
      throw new ForbiddenException(
        'Refund resolutions require finance.manage in addition to support.manage',
      );
    }
  }

  private async refundableAmount(
    bookingId: number,
    transaction?: Prisma.TransactionClient,
  ): Promise<number> {
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
    return Math.max(
      0,
      money(Number(booking.totalChargedAmount) - Number(refunds._sum.amount ?? 0)),
    );
  }

  private async applyWarningStrikes(
    transaction: Prisma.TransactionClient,
    actorId: number,
    resolutionId: string,
    actionType: string,
    warningTarget: string | null,
    booking: { customerId: number; taskerId: number },
    complaintId: string,
    summary: string,
  ): Promise<void> {
    if (!WARNING_RESOLUTION_TYPES.has(actionType) || !warningTarget) return;
    const targets: Array<{
      id: number;
      role: UserRole.Customer | UserRole.Tasker;
    }> =
      warningTarget === 'both'
        ? [{ id: booking.customerId, role: UserRole.Customer }, { id: booking.taskerId, role: UserRole.Tasker }]
        : warningTarget === 'customer'
          ? [{ id: booking.customerId, role: UserRole.Customer }]
          : [{ id: booking.taskerId, role: UserRole.Tasker }];
    for (const target of targets) {
      await this.disputes.applyWarningStrike({
        transaction,
        actorId,
        complaintId,
        resolutionId,
        targetUserId: target.id,
        targetRole: target.role,
        reason: summary,
      });
    }
  }

  private async notifyAdminActionParticipants(
    transaction: Prisma.TransactionClient,
    bookingId: number,
    complaintId: string,
    options: {
      eventType: string;
      title: string;
      body: string;
      eventKey: string;
      metadata?: Prisma.InputJsonObject;
    },
  ): Promise<void> {
    const booking = await transaction.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, customerId: true, taskerId: true },
    });
    if (!booking) return;
    await this.disputes.notifyParticipants(transaction, complaintId, booking, options);
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
    proposedAt?: Date | null;
    proposalResponseDueAt?: Date | null;
    appliedAt?: Date | null;
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
      proposedAt: resolution.proposedAt?.toISOString() ?? null,
      proposalResponseDueAt: resolution.proposalResponseDueAt?.toISOString() ?? null,
      appliedAt: resolution.appliedAt?.toISOString() ?? null,
      createdAt: resolution.createdAt.toISOString(),
      updatedAt: resolution.updatedAt.toISOString(),
    };
  }

  private availableActions(status: string, hasPendingCashRefund: boolean): string[] {
    if (status === 'resolved' || status === 'dismissed') return ['reopen'];
    if (status === 'withdrawn') return [];
    return [
      'start_investigation',
      'assign',
      'set_priority',
      'escalate',
      'request_evidence',
      'add_evidence',
      'review_evidence',
      'save_resolution_draft',
      'propose_resolution',
      'resolve',
      ...(hasPendingCashRefund ? ['confirm_cash_refund'] : []),
    ];
  }

  private timeline(complaint: DisputeTimelineSource, audit: DisputeAuditTimelineEvent[]) {
    const events: Array<Record<string, unknown> & { at: string }> = [
      {
        type: 'dispute_opened',
        at: complaint.createdAt.toISOString(),
        label: `Dispute opened by ${fullName(complaint.filedBy.firstName, complaint.filedBy.lastName)}`,
      },
    ];
    if (complaint.escalatedAt) {
      events.push({
        type: 'dispute_escalated',
        at: complaint.escalatedAt.toISOString(),
        label: complaint.escalationReason ?? 'Escalated',
      });
    }
    for (const evidence of complaint.evidences) {
      events.push({
        type: 'evidence_added',
        at: evidence.createdAt.toISOString(),
        label: evidence.name,
        evidenceId: evidence.id,
      });
    }
    for (const request of complaint.evidenceRequests) {
      events.push({
        type: 'evidence_requested',
        at: request.createdAt.toISOString(),
        label: request.message,
        requestId: request.id,
      });
    }
    for (const resolution of complaint.resolutions) {
      events.push({
        type: `resolution_${resolution.status}`,
        at: (resolution.appliedAt ?? resolution.createdAt).toISOString(),
        label: resolution.summary,
        resolutionId: resolution.id,
      });
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
    if ((from && !to) || (!from && to))
      throw new BadRequestException('from and to must be supplied together');
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
