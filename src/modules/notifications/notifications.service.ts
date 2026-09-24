import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { UserRole } from '../../common/enums/user-role.enum';
import { normalizePagination } from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type TaskNotification } from '../../generated/prisma/client';
import { ListNotificationsQueryDto } from './notifications.dto';
import { RealtimeOutboxService } from '../realtime/realtime-outbox.service';
import type { NotificationListView, NotificationView } from './notifications.types';
import { LocaleService } from '../localization/locale.service';
import { NotificationTemplateService } from './notification-template.service';
import { FcmService } from '../fcm/fcm.service';
import { MailService } from '../mail/mail.service';

/**
 * Notification `type`s that are also worth an email — booking/task lifecycle and
 * payment events a customer or tasker may miss if their phone is idle, mirroring
 * what booking platforms typically email for (confirmation, reminders, cancellation,
 * reschedule, receipts, completion). Chatty operational pings (en route, arrived,
 * OTP codes, etc.) stay push/in-app only. Dispute events already have their own
 * dedicated email pipeline (see DisputeLifecycleService) and are excluded here to
 * avoid double-emailing the same event.
 */
const EMAIL_NOTIFIED_TYPES = new Set<string>([
  'booking_requested',
  'task_confirmed',
  'booking_payment_required',
  'booking_cancelled_by_customer',
  'booking_cancelled_by_admin',
  'task_cancelled_by_tasker',
  'booking_rescheduled',
  'booking_reassigned',
  'reschedule_proposal_created',
  'reschedule_proposal_accepted',
  'reschedule_proposal_rejected',
  'booking_payment_succeeded',
  'booking_wallet_payment_succeeded',
  'booking_payment_failed',
  'task_completed_by_customer',
  'task_completion_verified',
  'booking_expired_no_response',
  'booking_reminder_24h',
  'booking_reminder_1h',
  'review_request',
  'booking_payment_captured',
  'booking_payment_expired',
  'booking_payment_refunded',
  'custom_time_request_created',
  'custom_time_request_accepted',
  'custom_time_request_rejected',
  'custom_time_request_expired',
  'custom_time_request_cancelled',
  'tasker_plan_purchased',
  'tasker_plan_activated',
  'tasker_plan_rejected',
  'tasker_plan_renewal_failed',
  'tasker_plan_expired',
  'tasker_plan_cancelled',
  'tasker_plan_terminated',
  'platform_payable_settlement_completed',
  'platform_payable_settlement_rejected',
]);

export interface CreateNotificationInput {
  category: 'messages' | 'tasks' | 'payments' | 'wallet' | 'system';
  type: string;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
  templateKey?: string;
  templateParams?: Prisma.InputJsonValue;
  audienceRole?: UserRole;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeOutboxService,
    private readonly locales: LocaleService,
    private readonly templates: NotificationTemplateService,
    private readonly fcm: FcmService,
    private readonly mail: MailService,
  ) {}

  async create(
    userId: number,
    input: CreateNotificationInput,
    transaction?: Prisma.TransactionClient,
  ): Promise<TaskNotification> {
    if (!transaction) {
      return this.prisma.$transaction((atomicTransaction) =>
        this.create(userId, input, atomicTransaction),
      );
    }
    const client = transaction;
    const recipient = await client.user.findUnique({
      where: { id: userId },
      select: { preferredLanguage: true, roles: true, email: true },
    });
    const locale = this.locales.resolve({
      preferredLanguage: recipient?.preferredLanguage,
    }).locale;
    const templateKey = input.templateKey ?? input.type;
    const audienceRole = await this.resolveAudienceRole(client, userId, input, recipient?.roles ?? []);
    const notification = await client.taskNotification.create({
      data: {
        userId,
        audienceRole,
        category: input.category,
        type: input.type,
        // Retain canonical English as the durable fallback. REST/realtime render
        // from templateKey for the recipient locale without losing this source.
        title: input.title,
        body: input.body,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata ?? Prisma.DbNull,
        templateKey,
        templateParams: input.templateParams ?? input.metadata ?? Prisma.DbNull,
        renderedLocale: this.locales.defaultLocale,
      },
    });
    const payload = this.eventPayload(notification, locale);
    if (audienceRole) {
      await this.realtime.enqueueUserRole(
        userId,
        audienceRole,
        'notification:created',
        payload,
        client,
      );
    } else {
      await this.realtime.enqueueUser(
        userId,
        'notification:created',
        payload,
        client,
      );
    }
    await this.fcm.enqueueNotification(
      userId,
      notification.id,
      String(payload.title),
      String(payload.body),
      audienceRole,
      client,
    );
    if (EMAIL_NOTIFIED_TYPES.has(input.type) && recipient?.email) {
      await client.emailNotificationDelivery.create({
        data: { notificationId: notification.id, userId },
      });
    }
    return notification;
  }

  /**
   * Drains the email outbox written by `create()` above. Runs off the request
   * path on a poll interval (see PerformanceJobsService), the same pattern used
   * for FCM push and dispute lifecycle email delivery, so a slow/unavailable
   * mail provider never blocks or fails the booking action that triggered it.
   */
  async processEmailDeliveries(): Promise<number> {
    const staleSendingBefore = new Date(Date.now() - 10 * 60 * 1000);
    const rows = await this.prisma.emailNotificationDelivery.findMany({
      where: {
        attempts: { lt: 5 },
        OR: [
          { status: { in: ['pending', 'failed'] }, nextAttemptAt: { lte: new Date() } },
          { status: 'sending', lockedAt: { lte: staleSendingBefore } },
        ],
      },
      include: {
        user: { select: { email: true, firstName: true, lastName: true, preferredLanguage: true } },
        notification: {
          select: { id: true, title: true, body: true, templateKey: true, entityType: true, entityId: true },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    let sent = 0;
    for (const row of rows) {
      const claimed = await this.prisma.emailNotificationDelivery.updateMany({
        where: { id: row.id, attempts: row.attempts },
        data: { status: 'sending', attempts: { increment: 1 }, lockedAt: new Date() },
      });
      if (!claimed.count) continue;
      try {
        if (!row.user.email) throw new Error('RECIPIENT_HAS_NO_EMAIL');
        const locale = row.user.preferredLanguage ?? undefined;
        const rendered = this.templates.render(row.notification.templateKey, this.locales.resolve({
          preferredLanguage: row.user.preferredLanguage,
        }).locale, row.notification);
        await this.mail.sendBookingLifecycleEmail({
          to: row.user.email,
          name: [row.user.firstName, row.user.lastName].filter(Boolean).join(' '),
          entityType: row.notification.entityType,
          entityId: row.notification.entityId,
          title: rendered.title,
          body: rendered.body,
          locale,
        });
        await this.prisma.emailNotificationDelivery.update({
          where: { id: row.id },
          data: { status: 'sent', sentAt: new Date(), lastError: null },
        });
        sent += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.prisma.emailNotificationDelivery.update({
          where: { id: row.id },
          data: {
            status: 'failed',
            lastError: message.slice(0, 1000),
            nextAttemptAt: new Date(Date.now() + Math.min(2 ** row.attempts, 60) * 60_000),
          },
        });
        this.logger.warn(`Notification email delivery ${row.id} failed: ${message.slice(0, 300)}`);
      }
    }
    return sent;
  }

  async list(
    userId: number,
    query: ListNotificationsQueryDto,
    locale: string,
    activeRole: UserRole,
  ): Promise<NotificationListView> {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    const where: Prisma.TaskNotificationWhereInput = {
      userId,
      OR: [{ audienceRole: null }, { audienceRole: activeRole }],
      ...(query.category && query.category !== 'all' ? { category: query.category } : {}),
      ...(query.unread ? { readAt: null } : {}),
    };
    if (query.cursor) {
      const cursorOwned = await this.prisma.taskNotification.count({
        where: { ...where, id: query.cursor },
      });
      if (cursorOwned === 0) throw new BadRequestException('Notification cursor is invalid');
    }
    const [items, totalItems, unreadCount] = await Promise.all([
      this.prisma.taskNotification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : { skip: offset }),
        take: query.cursor ? limit + 1 : limit,
      }),
      this.prisma.taskNotification.count({ where }),
      this.prisma.taskNotification.count({
        where: { userId, readAt: null, OR: [{ audienceRole: null }, { audienceRole: activeRole }] },
      }),
    ]);
    const hasMore = query.cursor ? items.length > limit : offset + items.length < totalItems;
    const pageItems = items.slice(0, limit);

    return {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      unreadCount,
      nextCursor: hasMore ? (pageItems.at(-1)?.id ?? null) : null,
      hasMore,
      items: pageItems.map((item) => this.serialize(item, locale)),
    };
  }

  async unreadCount(userId: number, activeRole: UserRole): Promise<{ unreadCount: number }> {
    return {
      unreadCount: await this.prisma.taskNotification.count({
        where: { userId, readAt: null, OR: [{ audienceRole: null }, { audienceRole: activeRole }] },
      }),
    };
  }

  async markRead(userId: number, id: string, locale: string, activeRole: UserRole): Promise<NotificationView> {
    return this.prisma.$transaction(async (transaction) => {
      const readAt = new Date();
      const result = await transaction.taskNotification.updateMany({
        where: { id, userId, OR: [{ audienceRole: null }, { audienceRole: activeRole }] },
        data: { readAt },
      });
      if (result.count === 0) throw new NotFoundException('Notification not found');
      const notification = await transaction.taskNotification.findUniqueOrThrow({ where: { id } });
      await this.realtime.enqueueUserRole(
        userId,
        activeRole,
        'notification:read',
        { id, readAt: readAt.toISOString() },
        transaction,
      );
      return this.serialize(notification, locale);
    });
  }

  async markAllRead(userId: number, activeRole: UserRole): Promise<{ updated: number }> {
    return this.prisma.$transaction(async (transaction) => {
      const readAt = new Date();
      const result = await transaction.taskNotification.updateMany({
        where: { userId, readAt: null, OR: [{ audienceRole: null }, { audienceRole: activeRole }] },
        data: { readAt },
      });
      if (result.count > 0) {
        await this.realtime.enqueueUserRole(
          userId,
          activeRole,
          'notifications:read_all',
          { updated: result.count, readAt: readAt.toISOString() },
          transaction,
        );
      }
      return { updated: result.count };
    });
  }

  private async resolveAudienceRole(
    client: Prisma.TransactionClient,
    userId: number,
    input: CreateNotificationInput,
    roles: string[],
  ): Promise<UserRole | null> {
    if (input.audienceRole) return input.audienceRole;
    const enabled = roles.filter((role): role is UserRole =>
      Object.values(UserRole).includes(role as UserRole),
    );
    if (enabled.length === 1) return enabled[0] ?? null;
    if (!enabled.includes(UserRole.Customer) || !enabled.includes(UserRole.Tasker)) return null;

    const entityId = input.entityId;
    if (input.entityType === 'booking' && entityId && /^\d+$/.test(entityId)) {
      const booking = await client.booking.findUnique({
        where: { id: Number(entityId) },
        select: { customerId: true, taskerId: true },
      });
      if (booking?.customerId === userId) return UserRole.Customer;
      if (booking?.taskerId === userId) return UserRole.Tasker;
    }
    if (input.entityType === 'conversation' && entityId) {
      const conversation = await client.conversation.findUnique({
        where: { id: entityId },
        select: { customerId: true, taskerId: true },
      });
      if (conversation?.customerId === userId) return UserRole.Customer;
      if (conversation?.taskerId === userId) return UserRole.Tasker;
    }
    if (input.entityType === 'dispute' && entityId) {
      const complaint = await client.taskComplaint.findUnique({
        where: { id: entityId },
        select: { booking: { select: { customerId: true, taskerId: true } } },
      });
      if (complaint?.booking.customerId === userId) return UserRole.Customer;
      if (complaint?.booking.taskerId === userId) return UserRole.Tasker;
    }
    if (input.entityType === 'review' && entityId) {
      const review = await client.review.findUnique({
        where: { id: entityId },
        select: { reviewerId: true, reviewerRole: true, revieweeId: true, revieweeRole: true },
      });
      if (review?.revieweeId === userId) return review.revieweeRole as UserRole;
      if (review?.reviewerId === userId) return review.reviewerRole as UserRole;
    }
    if (input.entityType === 'support_ticket' && entityId && /^\d+$/.test(entityId)) {
      const ticket = await client.supportTicket.findUnique({
        where: { id: Number(entityId) },
        select: { userId: true, requesterRole: true },
      });
      if (ticket?.userId === userId) return ticket.requesterRole as UserRole;
    }
    if (input.entityType === 'referral_reward' && entityId) {
      const reward = await client.referralReward.findUnique({
        where: { id: entityId },
        select: { recipientId: true, recipientRole: true },
      });
      if (reward?.recipientId === userId) return reward.recipientRole as UserRole;
    }
    if (input.entityType === 'referral' && entityId) {
      const referral = await client.referral.findUnique({
        where: { id: entityId },
        select: { referrerId: true, referredUserId: true, program: true },
      });
      if (referral && (referral.referrerId === userId || referral.referredUserId === userId)) {
        return referral.program === 'tasker' ? UserRole.Tasker : UserRole.Customer;
      }
    }
    if (input.entityType === 'stripe_chargeback' && entityId) {
      const chargeback = await client.stripeChargeback.findUnique({
        where: { id: entityId },
        select: { booking: { select: { customerId: true, taskerId: true } } },
      });
      if (chargeback?.booking?.customerId === userId) return UserRole.Customer;
      if (chargeback?.booking?.taskerId === userId) return UserRole.Tasker;
    }
    if (['elite_badge', 'elite_membership_request', 'elite_tier', 'elite_tier_transition', 'tasker', 'tasker_earning', 'tasker_platform_account', 'platform_receivable', 'withdrawal'].includes(input.entityType ?? '')) {
      return UserRole.Tasker;
    }
    if (['customer', 'customer_wallet', 'payment_transaction'].includes(input.entityType ?? '')) {
      return UserRole.Customer;
    }
    return null;
  }

  private eventPayload(
    item: {
      id: string;
      audienceRole?: string | null;
      category: string;
      type: string;
      title: string;
      body: string;
      entityType: string | null;
      entityId: string | null;
      metadata: unknown;
      readAt: Date | null;
      createdAt: Date;
      templateKey?: string | null;
      templateParams?: unknown;
      renderedLocale?: string | null;
    },
    locale: string,
  ): Prisma.InputJsonObject {
    const rendered = this.templates.render(item.templateKey, locale, item);
    return {
      id: item.id,
      audienceRole: item.audienceRole ?? null,
      category: item.category,
      type: item.type,
      title: rendered.title,
      body: rendered.body,
      entityType: item.entityType,
      entityId: item.entityId,
      metadata: (item.metadata ?? null) as Prisma.InputJsonValue,
      isRead: item.readAt !== null,
      readAt: item.readAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
      templateKey: item.templateKey ?? item.type,
      templateParams: (item.templateParams ?? null) as Prisma.InputJsonValue,
      renderedLocale: rendered.locale,
      translationFallback: rendered.fallback,
    };
  }

  private serialize(
    item: {
      id: string;
      audienceRole?: string | null;
      category: string;
      type: string;
      title: string;
      body: string;
      entityType: string | null;
      entityId: string | null;
      metadata: unknown;
      readAt: Date | null;
      createdAt: Date;
      templateKey?: string | null;
      templateParams?: unknown;
      renderedLocale?: string | null;
    },
    locale: string,
  ): NotificationView {
    const rendered = this.templates.render(item.templateKey, locale, item);
    return {
      id: item.id,
      audienceRole: item.audienceRole ?? null,
      category: item.category,
      type: item.type,
      title: rendered.title,
      body: rendered.body,
      entityType: item.entityType,
      entityId: item.entityId,
      metadata: item.metadata,
      isRead: item.readAt !== null,
      readAt: item.readAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
      templateKey: item.templateKey ?? item.type,
      templateParams: item.templateParams ?? null,
      renderedLocale: rendered.locale,
      translationFallback: rendered.fallback,
    };
  }
}
