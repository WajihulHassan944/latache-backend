import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { normalizePagination } from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { ListNotificationsQueryDto } from './notifications.dto';
import { RealtimeOutboxService } from '../realtime/realtime-outbox.service';
import type { NotificationListView, NotificationView } from './notifications.types';
import { LocaleService } from '../localization/locale.service';
import { NotificationTemplateService } from './notification-template.service';

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
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeOutboxService,
    private readonly locales: LocaleService,
    private readonly templates: NotificationTemplateService,
  ) {}

  async create(
    userId: number,
    input: CreateNotificationInput,
    transaction?: Prisma.TransactionClient,
  ) {
    const client = transaction ?? this.prisma;
    const recipient = await client.user.findUnique({
      where: { id: userId },
      select: { preferredLanguage: true },
    });
    const locale = this.locales.resolve({
      preferredLanguage: recipient?.preferredLanguage,
    }).locale;
    const templateKey = input.templateKey ?? input.type;
    const notification = await client.taskNotification.create({
      data: {
        userId,
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
    await this.realtime.enqueueUser(
      userId,
      'notification:created',
      this.eventPayload(notification, locale),
      transaction,
    );
    return notification;
  }

  async list(
    userId: number,
    query: ListNotificationsQueryDto,
    locale: string,
  ): Promise<NotificationListView> {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    const where: Prisma.TaskNotificationWhereInput = {
      userId,
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
      this.prisma.taskNotification.count({ where: { userId, readAt: null } }),
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

  async unreadCount(userId: number): Promise<{ unreadCount: number }> {
    return {
      unreadCount: await this.prisma.taskNotification.count({
        where: { userId, readAt: null },
      }),
    };
  }

  async markRead(userId: number, id: string, locale: string): Promise<NotificationView> {
    return this.prisma.$transaction(async (transaction) => {
      const readAt = new Date();
      const result = await transaction.taskNotification.updateMany({
        where: { id, userId },
        data: { readAt },
      });
      if (result.count === 0) throw new NotFoundException('Notification not found');
      const notification = await transaction.taskNotification.findUniqueOrThrow({ where: { id } });
      await this.realtime.enqueueUser(
        userId,
        'notification:read',
        { id, readAt: readAt.toISOString() },
        transaction,
      );
      return this.serialize(notification, locale);
    });
  }

  async markAllRead(userId: number): Promise<{ updated: number }> {
    return this.prisma.$transaction(async (transaction) => {
      const readAt = new Date();
      const result = await transaction.taskNotification.updateMany({
        where: { userId, readAt: null },
        data: { readAt },
      });
      if (result.count > 0) {
        await this.realtime.enqueueUser(
          userId,
          'notifications:read_all',
          { updated: result.count, readAt: readAt.toISOString() },
          transaction,
        );
      }
      return { updated: result.count };
    });
  }

  private eventPayload(
    item: {
      id: string;
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
