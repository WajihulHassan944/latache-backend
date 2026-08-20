import { ConflictException, Injectable, Logger, PayloadTooLargeException } from '@nestjs/common';
import { Prisma, type User } from '../../generated/prisma/client';
import { UserRole } from '../../common/enums/user-role.enum';
import { PrismaService } from '../../database/prisma.service';
import { AdminAuditService } from '../admin-audit/admin-audit.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import type { DisputePolicy } from '../platform-settings/platform-settings.types';
import { UploadsService } from '../uploads/uploads.service';
import type { ConversationAttachmentReference } from '../uploads/uploads.types';

const ACTIVE_STATUSES = ['open', 'under_investigation', 'escalated'] as const;
const CLOSED_STATUSES = ['resolved', 'dismissed', 'withdrawn'] as const;
const HOUR_MS = 3_600_000;

interface DisputeParticipantBooking {
  id: number;
  customerId: number;
  taskerId: number;
}

interface NotifyOptions {
  eventType: string;
  title: string;
  body: string;
  eventKey: string;
  metadata?: Prisma.InputJsonObject;
  recipientIds?: number[];
}

@Injectable()
export class DisputeLifecycleService {
  private readonly logger = new Logger(DisputeLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly platformSettings: PlatformSettingsService,
    private readonly uploads: UploadsService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly audit: AdminAuditService,
  ) {}

  policy(transaction?: Prisma.TransactionClient): Promise<DisputePolicy> {
    return this.platformSettings.disputePolicy(transaction);
  }

  verifyEvidence(
    user: User,
    references: Array<{
      publicId: string;
      secureUrl: string;
      resourceType?: string;
      mimeType?: string;
      originalFileName?: string;
    }>,
  ): Promise<ConversationAttachmentReference[]> {
    return this.uploads.verifyDisputeAttachments(user, references);
  }

  async assertIncomingEvidenceCapacity(
    evidence: Array<{ bytes?: number }>,
    transaction?: Prisma.TransactionClient,
  ): Promise<void> {
    const policy = await this.policy(transaction);
    const bytes = evidence.reduce((total, item) => total + Number(item.bytes ?? 0), 0);
    if (evidence.length > policy.maxEvidenceItems) {
      throw new ConflictException({
        code: 'DISPUTE_EVIDENCE_ITEM_LIMIT',
        message: `A dispute can contain at most ${policy.maxEvidenceItems} evidence items.`,
      });
    }
    if (bytes > policy.maxEvidenceBytes) {
      throw new PayloadTooLargeException({
        code: 'DISPUTE_EVIDENCE_BYTE_LIMIT',
        message: `Dispute evidence exceeds the configured ${policy.maxEvidenceBytes} byte case limit.`,
      });
    }
  }

  async assertEvidenceCapacity(
    complaintId: string,
    incoming: Array<{ bytes?: number }>,
    transaction: Prisma.TransactionClient,
  ): Promise<void> {
    const policy = await this.policy(transaction);
    const [count, aggregate, normalizedInitialCount, complaint] = await Promise.all([
      transaction.disputeEvidence.count({ where: { complaintId } }),
      transaction.disputeEvidence.aggregate({
        where: { complaintId },
        _sum: { bytes: true },
      }),
      transaction.disputeEvidence.count({
        where: { complaintId, source: 'initial_complaint' },
      }),
      transaction.taskComplaint.findUnique({
        where: { id: complaintId },
        select: { attachments: true },
      }),
    ]);
    const legacyAttachments =
      normalizedInitialCount === 0 && Array.isArray(complaint?.attachments)
        ? complaint.attachments
        : [];
    const legacyBytes = legacyAttachments.reduce<number>((total, item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return total;
      const bytes = (item as Record<string, unknown>).bytes;
      return total + (typeof bytes === 'number' && Number.isFinite(bytes) ? bytes : 0);
    }, 0);
    const incomingBytes = incoming.reduce((total, item) => total + Number(item.bytes ?? 0), 0);
    const currentBytes = Number(aggregate._sum.bytes ?? 0) + legacyBytes;
    const currentCount = count + legacyAttachments.length;
    if (currentCount + incoming.length > policy.maxEvidenceItems) {
      throw new ConflictException({
        code: 'DISPUTE_EVIDENCE_ITEM_LIMIT',
        message: `A dispute can contain at most ${policy.maxEvidenceItems} evidence items.`,
      });
    }
    if (currentBytes + incomingBytes > policy.maxEvidenceBytes) {
      throw new PayloadTooLargeException({
        code: 'DISPUTE_EVIDENCE_BYTE_LIMIT',
        message: `Dispute evidence exceeds the configured ${policy.maxEvidenceBytes} byte case limit.`,
      });
    }
  }

  filingDeadline(anchor: Date | null | undefined, policy: DisputePolicy): Date | null {
    return anchor ? new Date(anchor.getTime() + policy.filingWindowHours * HOUR_MS) : null;
  }

  appealDeadline(closedAt: Date, policy: DisputePolicy): Date {
    return new Date(closedAt.getTime() + policy.appealWindowHours * HOUR_MS);
  }

  slaDeadline(from: Date, policy: DisputePolicy): Date {
    return new Date(from.getTime() + policy.caseSlaHours * HOUR_MS);
  }

  async selectAssignee(transaction: Prisma.TransactionClient): Promise<number | null> {
    const policy = await this.policy(transaction);
    if (!policy.autoAssignmentEnabled) return null;
    const admins = await transaction.user.findMany({
      where: {
        role: { in: [UserRole.Admin, UserRole.SuperAdmin] },
        accountStatus: 'active',
        deletedAt: null,
      },
      select: {
        id: true,
        role: true,
        permissions: true,
        inheritsRolePermissions: true,
        rbacRole: { select: { permissions: true, isActive: true, deletedAt: true } },
      },
      orderBy: { id: 'asc' },
    });
    const eligible = admins.filter((admin) => {
      if (admin.role === UserRole.SuperAdmin) return true;
      const direct = admin.permissions.includes('support.manage');
      const inherited =
        admin.inheritsRolePermissions &&
        admin.rbacRole?.isActive === true &&
        admin.rbacRole.deletedAt === null &&
        admin.rbacRole.permissions.includes('support.manage');
      return direct || inherited;
    });
    if (!eligible.length) return null;
    const loads = await Promise.all(
      eligible.map(async (admin) => ({
        id: admin.id,
        count: await transaction.taskComplaint.count({
          where: { assignedAdminId: admin.id, status: { in: [...ACTIVE_STATUSES] } },
        }),
      })),
    );
    loads.sort((a, b) => a.count - b.count || a.id - b.id);
    return loads[0]?.id ?? null;
  }

  async notifyParticipants(
    transaction: Prisma.TransactionClient,
    complaintId: string,
    booking: DisputeParticipantBooking,
    options: NotifyOptions,
  ): Promise<void> {
    const recipientIds = options.recipientIds ?? [booking.customerId, booking.taskerId];
    for (const recipientId of [...new Set(recipientIds)]) {
      await this.notifyUser(transaction, complaintId, recipientId, options);
    }
  }

  async notifyUser(
    transaction: Prisma.TransactionClient,
    complaintId: string,
    recipientId: number,
    options: NotifyOptions,
  ): Promise<void> {
    await this.notifications.create(
      recipientId,
      {
        category: 'tasks',
        type: options.eventType,
        title: options.title,
        body: options.body.slice(0, 500),
        entityType: 'dispute',
        entityId: complaintId,
        metadata: options.metadata,
      },
      transaction,
    );
    const policy = await this.policy(transaction);
    if (policy.emailNotificationsEnabled) {
      await transaction.disputeDelivery.upsert({
        where: {
          idempotencyKey: `dispute:${complaintId}:${options.eventType}:${options.eventKey}:${recipientId}:email`,
        },
        create: {
          complaintId,
          recipientId,
          channel: 'email',
          eventType: options.eventType,
          subject: options.title.slice(0, 255),
          body: options.body.slice(0, 5000),
          idempotencyKey: `dispute:${complaintId}:${options.eventType}:${options.eventKey}:${recipientId}:email`,
        },
        update: {},
      });
    }
    if (policy.mobilePushEnabled) {
      // The platform settings service refuses this flag until an APNs/FCM provider exists.
      // This durable row makes the blocked state explicit without fabricating a delivery.
      await transaction.disputeDelivery.upsert({
        where: {
          idempotencyKey: `dispute:${complaintId}:${options.eventType}:${options.eventKey}:${recipientId}:push`,
        },
        create: {
          complaintId,
          recipientId,
          channel: 'mobile_push',
          eventType: options.eventType,
          subject: options.title.slice(0, 255),
          body: options.body.slice(0, 5000),
          status: 'blocked_unconfigured',
          failureReason: 'APNS_FCM_PROVIDER_NOT_CONFIGURED',
          idempotencyKey: `dispute:${complaintId}:${options.eventType}:${options.eventKey}:${recipientId}:push`,
        },
        update: {},
      });
    }
  }

  async applyWarningStrike(params: {
    transaction: Prisma.TransactionClient;
    actorId: number;
    complaintId: string;
    resolutionId: string;
    targetUserId: number;
    targetRole: UserRole.Customer | UserRole.Tasker;
    reason: string;
  }): Promise<void> {
    const { transaction } = params;
    const idempotencyKey = `dispute:${params.complaintId}:resolution:${params.resolutionId}:warning:${params.targetUserId}:${params.targetRole}`;
    const existing = await transaction.disciplinaryAction.findUnique({ where: { idempotencyKey } });
    if (existing) return;
    await transaction.$queryRaw`SELECT "id" FROM "Users" WHERE "id" = ${params.targetUserId} FOR UPDATE`;

    const profile =
      params.targetRole === UserRole.Customer
        ? await transaction.customerProfile.findUnique({ where: { userId: params.targetUserId } })
        : await transaction.taskerProfile.findUnique({ where: { userId: params.targetUserId } });
    if (!profile) {
      throw new ConflictException(`The ${params.targetRole} profile no longer exists for this dispute participant`);
    }

    const policy = await this.policy(transaction);
    const points = policy.strikePointsPerWarning;
    const newPoints = profile.disputeStrikePoints + points;
    const thresholdReached = newPoints >= policy.suspendAtStrikePoints;
    const nextState = thresholdReached
      ? policy.automaticModerationEnabled
        ? 'suspended'
        : 'at_risk'
      : 'warned';
    await transaction.disciplinaryAction.create({
      data: {
        complaintId: params.complaintId,
        userId: params.targetUserId,
        actorId: params.actorId,
        targetRole: params.targetRole,
        kind: 'dispute_warning',
        points,
        stateBefore: profile.disciplinaryState,
        stateAfter: nextState,
        reason: params.reason.slice(0, 2000),
        idempotencyKey,
      },
    });

    const profileData = {
      disputeStrikePoints: newPoints,
      disciplinaryState: nextState,
      lastDisciplinaryActionAt: new Date(),
      ...(thresholdReached && policy.automaticModerationEnabled
        ? { status: 'suspended', suspendedAt: new Date(), statusReason: 'Automatic dispute discipline threshold reached' }
        : {}),
    };
    if (params.targetRole === UserRole.Customer) {
      await transaction.customerProfile.update({ where: { userId: params.targetUserId }, data: profileData });
    } else {
      await transaction.taskerProfile.update({ where: { userId: params.targetUserId }, data: profileData });
    }

    const [customerProfile, taskerProfile] = await Promise.all([
      transaction.customerProfile.findUnique({ where: { userId: params.targetUserId } }),
      transaction.taskerProfile.findUnique({ where: { userId: params.targetUserId } }),
    ]);
    const states = [customerProfile?.disciplinaryState, taskerProfile?.disciplinaryState].filter(Boolean);
    const aggregateState = states.includes('suspended')
      ? 'suspended'
      : states.includes('at_risk')
        ? 'at_risk'
        : states.includes('warned')
          ? 'warned'
          : 'clear';
    await transaction.user.update({
      where: { id: params.targetUserId },
      data: {
        disputeStrikePoints:
          (customerProfile?.disputeStrikePoints ?? 0) + (taskerProfile?.disputeStrikePoints ?? 0),
        disciplinaryState: aggregateState,
        lastDisciplinaryActionAt: new Date(),
      },
    });
    if (thresholdReached && policy.automaticModerationEnabled) {
      await transaction.refreshToken.updateMany({
        where: { userId: params.targetUserId, activeRole: params.targetRole, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await this.audit.record(
      {
        actorId: params.actorId,
        targetUserId: params.targetUserId,
        action:
          thresholdReached && policy.automaticModerationEnabled
            ? 'dispute_discipline_auto_suspended'
            : 'dispute_warning_strike_recorded',
        entityType: 'dispute',
        entityId: params.complaintId,
        reason: params.reason,
        metadata: {
          targetRole: params.targetRole,
          pointsAdded: points,
          strikePoints: newPoints,
          stateBefore: profile.disciplinaryState,
          stateAfter: nextState,
          automaticModerationEnabled: policy.automaticModerationEnabled,
        },
      },
      transaction,
    );
  }

  async runMaintenance(): Promise<Record<string, number>> {
    const evidenceReminders = await this.processEvidenceReminders();
    const evidenceOverdue = await this.processEvidenceOverdue();
    const evidenceExpired = await this.processEvidenceExpiry();
    const settlementProposalsExpired = await this.processSettlementProposalExpiries();
    const slaEscalations = await this.processSlaEscalations();
    const emails = await this.processEmailDeliveries();
    return {
      evidenceReminders,
      evidenceOverdue,
      evidenceExpired,
      settlementProposalsExpired,
      slaEscalations,
      emails,
    };
  }

  private async processEvidenceReminders(): Promise<number> {
    const policy = await this.policy();
    const now = new Date();
    const horizon = new Date(now.getTime() + policy.evidenceReminderHoursBeforeDue * HOUR_MS);
    const candidates = await this.prisma.disputeEvidenceRequest.findMany({
      where: {
        status: 'pending',
        dueAt: { gt: now, lte: horizon },
        reminderSentAt: null,
      },
      select: { id: true },
      take: 100,
      orderBy: { dueAt: 'asc' },
    });
    let processed = 0;
    for (const candidate of candidates) {
      const changed = await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT "id" FROM "DisputeEvidenceRequests" WHERE "id" = ${candidate.id} FOR UPDATE`;
        const request = await transaction.disputeEvidenceRequest.findUnique({
          where: { id: candidate.id },
          include: { complaint: { include: { booking: true } } },
        });
        if (!request || request.status !== 'pending' || request.reminderSentAt || !request.dueAt) {
          return false;
        }
        const moment = new Date();
        if (request.dueAt <= moment) return false;
        await transaction.disputeEvidenceRequest.update({
          where: { id: request.id },
          data: { reminderSentAt: moment },
        });
        const recipientIds =
          request.requestedFrom === 'both'
            ? [request.complaint.booking.customerId, request.complaint.booking.taskerId]
            : [
                request.requestedFrom === 'customer'
                  ? request.complaint.booking.customerId
                  : request.complaint.booking.taskerId,
              ];
        for (const recipientId of recipientIds) {
          await this.notifyUser(transaction, request.complaintId, recipientId, {
            eventType: 'dispute_evidence_reminder',
            title: 'Evidence deadline reminder',
            body: 'The deadline for requested dispute evidence is approaching.',
            eventKey: `${request.id}:${recipientId}`,
            metadata: { evidenceRequestId: request.id, dueAt: request.dueAt.toISOString() },
          });
        }
        return true;
      });
      if (changed) processed += 1;
    }
    return processed;
  }

  private async processEvidenceOverdue(): Promise<number> {
    const now = new Date();
    const candidates = await this.prisma.disputeEvidenceRequest.findMany({
      where: { status: 'pending', dueAt: { lte: now } },
      select: { id: true },
      take: 100,
      orderBy: { dueAt: 'asc' },
    });
    let processed = 0;
    for (const candidate of candidates) {
      const changed = await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT "id" FROM "DisputeEvidenceRequests" WHERE "id" = ${candidate.id} FOR UPDATE`;
        const request = await transaction.disputeEvidenceRequest.findUnique({
          where: { id: candidate.id },
          include: { complaint: { include: { booking: true } } },
        });
        if (!request || request.status !== 'pending' || !request.dueAt || request.dueAt > new Date()) {
          return false;
        }
        const overdueAt = new Date();
        await transaction.disputeEvidenceRequest.update({
          where: { id: request.id },
          data: { status: 'overdue', overdueAt },
        });
        await transaction.taskComplaint.update({
          where: { id: request.complaintId },
          data: { evidenceReviewStatus: 'needs_more_evidence' },
        });
        const recipientIds =
          request.requestedFrom === 'both'
            ? [request.complaint.booking.customerId, request.complaint.booking.taskerId]
            : [
                request.requestedFrom === 'customer'
                  ? request.complaint.booking.customerId
                  : request.complaint.booking.taskerId,
              ];
        for (const recipientId of recipientIds) {
          await this.notifyUser(transaction, request.complaintId, recipientId, {
            eventType: 'dispute_evidence_overdue',
            title: 'Evidence deadline missed',
            body: 'The requested evidence deadline has passed. Submit it before the request expires.',
            eventKey: `${request.id}:${recipientId}`,
            metadata: { evidenceRequestId: request.id, dueAt: request.dueAt.toISOString() },
          });
        }
        if (request.complaint.assignedAdminId) {
          await this.notifyUser(transaction, request.complaintId, request.complaint.assignedAdminId, {
            eventType: 'dispute_evidence_overdue',
            title: 'Assigned dispute evidence is overdue',
            body: 'A participant missed an evidence deadline on an assigned dispute.',
            eventKey: `admin:${request.id}`,
            metadata: { evidenceRequestId: request.id, dueAt: request.dueAt.toISOString() },
          });
        }
        return true;
      });
      if (changed) processed += 1;
    }
    return processed;
  }

  private async processEvidenceExpiry(): Promise<number> {
    const policy = await this.policy();
    const cutoff = new Date(Date.now() - policy.evidenceOverdueEscalationHours * HOUR_MS);
    const candidates = await this.prisma.disputeEvidenceRequest.findMany({
      where: { status: 'overdue', dueAt: { lte: cutoff }, expiredAt: null },
      select: { id: true },
      take: 100,
      orderBy: { dueAt: 'asc' },
    });
    let processed = 0;
    for (const candidate of candidates) {
      const changed = await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT "id" FROM "DisputeEvidenceRequests" WHERE "id" = ${candidate.id} FOR UPDATE`;
        const request = await transaction.disputeEvidenceRequest.findUnique({
          where: { id: candidate.id },
          include: { complaint: { include: { booking: true } } },
        });
        if (!request || request.status !== 'overdue' || request.expiredAt || !request.dueAt) {
          return false;
        }
        const expirationCutoff = new Date(
          Date.now() - policy.evidenceOverdueEscalationHours * HOUR_MS,
        );
        if (request.dueAt > expirationCutoff) return false;
        const expiredAt = new Date();
        await transaction.disputeEvidenceRequest.update({
          where: { id: request.id },
          data: { status: 'expired', expiredAt },
        });
        if (ACTIVE_STATUSES.includes(request.complaint.status as never)) {
          await transaction.taskComplaint.update({
            where: { id: request.complaintId },
            data: {
              status: 'escalated',
              priority: request.complaint.priority === 'normal' ? 'high' : request.complaint.priority,
              escalatedAt: request.complaint.escalatedAt ?? expiredAt,
              escalationReason:
                request.complaint.escalationReason ?? 'Requested evidence deadline expired',
              evidenceReviewStatus: 'overdue',
            },
          });
          await this.notifyParticipants(
            transaction,
            request.complaintId,
            request.complaint.booking,
            {
              eventType: 'dispute_evidence_expired',
              title: 'Evidence request expired',
              body: 'A requested evidence deadline expired and the dispute was escalated for review.',
              eventKey: request.id,
              metadata: { evidenceRequestId: request.id },
            },
          );
          if (request.complaint.assignedAdminId) {
            await this.notifyUser(
              transaction,
              request.complaintId,
              request.complaint.assignedAdminId,
              {
                eventType: 'dispute_evidence_expired',
                title: 'Assigned dispute evidence expired',
                body: 'An evidence request expired and the assigned dispute was escalated.',
                eventKey: `admin:${request.id}`,
                metadata: { evidenceRequestId: request.id },
              },
            );
          }
        }
        return true;
      });
      if (changed) processed += 1;
    }
    return processed;
  }

  private async processSettlementProposalExpiries(): Promise<number> {
    const now = new Date();
    const candidates = await this.prisma.disputeResolution.findMany({
      where: {
        status: 'proposed',
        proposalResponseDueAt: { lte: now },
      },
      select: {
        id: true,
        complaintId: true,
        complaint: { select: { bookingId: true } },
      },
      take: 100,
      orderBy: { proposalResponseDueAt: 'asc' },
    });
    let processed = 0;
    for (const candidate of candidates) {
      const changed = await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT "id" FROM "Bookings" WHERE "id" = ${candidate.complaint.bookingId} FOR UPDATE`;
        await transaction.$queryRaw`SELECT "id" FROM "TaskComplaints" WHERE "id" = ${candidate.complaintId} FOR UPDATE`;
        await transaction.$queryRaw`SELECT "id" FROM "DisputeResolutions" WHERE "id" = ${candidate.id} FOR UPDATE`;
        const resolution = await transaction.disputeResolution.findUnique({
          where: { id: candidate.id },
          include: { complaint: { include: { booking: true } } },
        });
        const expiredAt = new Date();
        if (
          !resolution ||
          resolution.status !== 'proposed' ||
          !resolution.proposalResponseDueAt ||
          resolution.proposalResponseDueAt > expiredAt
        ) {
          return false;
        }
        await transaction.disputeResolution.update({
          where: { id: resolution.id },
          data: { status: 'expired' },
        });
        if (ACTIVE_STATUSES.includes(resolution.complaint.status as never)) {
          await this.notifyParticipants(
            transaction,
            resolution.complaintId,
            resolution.complaint.booking,
            {
              eventType: 'dispute_settlement_proposal_expired',
              title: 'Settlement proposal expired',
              body: 'The response deadline for the proposed dispute settlement passed without full acceptance. The dispute remains under review.',
              eventKey: resolution.id,
              metadata: {
                resolutionId: resolution.id,
                responseDueAt: resolution.proposalResponseDueAt.toISOString(),
              },
            },
          );
          if (resolution.complaint.assignedAdminId) {
            await this.notifyUser(
              transaction,
              resolution.complaintId,
              resolution.complaint.assignedAdminId,
              {
                eventType: 'dispute_settlement_proposal_expired',
                title: 'Assigned settlement proposal expired',
                body: 'A proposed settlement expired without full participant acceptance and requires continued review.',
                eventKey: `admin:${resolution.id}`,
                metadata: { resolutionId: resolution.id },
              },
            );
          }
        }
        await this.audit.record(
          {
            action: 'dispute_settlement_proposal_expired',
            entityType: 'dispute',
            entityId: resolution.complaintId,
            reason: 'Settlement proposal response deadline elapsed',
            metadata: {
              resolutionId: resolution.id,
              responseDueAt: resolution.proposalResponseDueAt.toISOString(),
            },
          },
          transaction,
        );
        return true;
      });
      if (changed) processed += 1;
    }
    return processed;
  }

  private async processSlaEscalations(): Promise<number> {
    const now = new Date();
    const candidates = await this.prisma.taskComplaint.findMany({
      where: {
        status: { in: [...ACTIVE_STATUSES] },
        slaDueAt: { lte: now },
        slaBreachedAt: null,
      },
      select: { id: true },
      take: 100,
      orderBy: { slaDueAt: 'asc' },
    });
    let processed = 0;
    for (const candidate of candidates) {
      const changed = await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT "id" FROM "TaskComplaints" WHERE "id" = ${candidate.id} FOR UPDATE`;
        const complaint = await transaction.taskComplaint.findUnique({
          where: { id: candidate.id },
          include: { booking: true },
        });
        const breachedAt = new Date();
        if (
          !complaint ||
          !ACTIVE_STATUSES.includes(complaint.status as never) ||
          complaint.slaBreachedAt ||
          !complaint.slaDueAt ||
          complaint.slaDueAt > breachedAt
        ) {
          return false;
        }
        await transaction.taskComplaint.update({
          where: { id: complaint.id },
          data: {
            status: 'escalated',
            priority: complaint.priority === 'normal' ? 'high' : complaint.priority,
            slaBreachedAt: breachedAt,
            escalatedAt: complaint.escalatedAt ?? breachedAt,
            escalationReason: complaint.escalationReason ?? 'Dispute review SLA exceeded',
          },
        });
        await this.notifyParticipants(transaction, complaint.id, complaint.booking, {
          eventType: 'dispute_sla_breached',
          title: 'Dispute review escalated',
          body: 'The dispute exceeded its review SLA and was escalated for priority handling.',
          eventKey: `sla:${complaint.slaDueAt.toISOString()}`,
        });
        if (complaint.assignedAdminId) {
          await this.notifyUser(transaction, complaint.id, complaint.assignedAdminId, {
            eventType: 'dispute_sla_breached',
            title: 'Assigned dispute exceeded SLA',
            body: 'An assigned dispute exceeded its review SLA and requires attention.',
            eventKey: `admin-sla:${complaint.slaDueAt.toISOString()}`,
          });
        }
        return true;
      });
      if (changed) processed += 1;
    }
    return processed;
  }

  private async processEmailDeliveries(): Promise<number> {
    const staleSendingBefore = new Date(Date.now() - 10 * 60 * 1000);
    const rows = await this.prisma.disputeDelivery.findMany({
      where: {
        channel: 'email',
        attempts: { lt: 5 },
        OR: [
          { status: { in: ['pending', 'failed'] } },
          { status: 'sending', lastAttemptAt: { lte: staleSendingBefore } },
        ],
      },
      include: {
        recipient: {
          select: { email: true, firstName: true, lastName: true, preferredLanguage: true },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    let sent = 0;
    for (const row of rows) {
      const claimed = await this.prisma.disputeDelivery.updateMany({
        where: {
          id: row.id,
          attempts: row.attempts,
          OR: [
            { status: { in: ['pending', 'failed'] } },
            { status: 'sending', lastAttemptAt: { lte: staleSendingBefore } },
          ],
        },
        data: { status: 'sending', attempts: { increment: 1 }, lastAttemptAt: new Date() },
      });
      if (!claimed.count) continue;
      try {
        await this.mail.sendDisputeLifecycleEmail({
          to: row.recipient.email,
          name: [row.recipient.firstName, row.recipient.lastName].filter(Boolean).join(' '),
          disputeId: row.complaintId,
          eventType: row.eventType,
          detail: row.body,
          locale: row.recipient.preferredLanguage ?? undefined,
        });
        await this.prisma.disputeDelivery.update({
          where: { id: row.id },
          data: { status: 'sent', sentAt: new Date(), failureReason: null },
        });
        sent += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.prisma.disputeDelivery.update({
          where: { id: row.id },
          data: { status: 'failed', failureReason: message.slice(0, 1000) },
        });
        this.logger.warn(`Dispute email delivery ${row.id} failed: ${message.slice(0, 300)}`);
      }
    }
    return sent;
  }

  isActive(status: string): boolean {
    return ACTIVE_STATUSES.includes(status as never);
  }

  isClosed(status: string): boolean {
    return CLOSED_STATUSES.includes(status as never);
  }
}
