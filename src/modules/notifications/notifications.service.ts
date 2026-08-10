import { Injectable, NotFoundException } from '@nestjs/common';
import { normalizePagination } from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { ListNotificationsQueryDto } from './notifications.dto';
import type { NotificationListView, NotificationView } from './notifications.types';

export interface CreateNotificationInput {
  category: 'messages' | 'tasks' | 'payments' | 'wallet' | 'system';
  type: string;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  create(
    userId: number,
    input: CreateNotificationInput,
    transaction?: Prisma.TransactionClient,
  ) {
    return (transaction ?? this.prisma).taskNotification.create({
      data: {
        userId,
        category: input.category,
        type: input.type,
        title: input.title,
        body: input.body,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata ?? Prisma.DbNull,
      },
    });
  }

  async list(
    userId: number,
    query: ListNotificationsQueryDto,
  ): Promise<NotificationListView> {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    const where: Prisma.TaskNotificationWhereInput = {
      userId,
      ...(query.category && query.category !== 'all'
        ? { category: query.category }
        : {}),
      ...(query.unread ? { readAt: null } : {}),
    };
    const [items, totalItems, unreadCount] = await Promise.all([
      this.prisma.taskNotification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.taskNotification.count({ where }),
      this.prisma.taskNotification.count({ where: { userId, readAt: null } }),
    ]);

    return {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      unreadCount,
      items: items.map((item) => this.serialize(item)),
    };
  }

  async unreadCount(userId: number): Promise<{ unreadCount: number }> {
    return {
      unreadCount: await this.prisma.taskNotification.count({
        where: { userId, readAt: null },
      }),
    };
  }

  async markRead(userId: number, id: string): Promise<NotificationView> {
    const result = await this.prisma.taskNotification.updateMany({
      where: { id, userId },
      data: { readAt: new Date() },
    });
    if (result.count === 0) throw new NotFoundException('Notification not found');

    return this.serialize(
      await this.prisma.taskNotification.findUniqueOrThrow({ where: { id } }),
    );
  }

  async markAllRead(userId: number): Promise<{ updated: number }> {
    const result = await this.prisma.taskNotification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  private serialize(item: {
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
  }): NotificationView {
    return {
      id: item.id,
      category: item.category,
      type: item.type,
      title: item.title,
      body: item.body,
      entityType: item.entityType,
      entityId: item.entityId,
      metadata: item.metadata,
      isRead: item.readAt !== null,
      readAt: item.readAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
    };
  }
}
