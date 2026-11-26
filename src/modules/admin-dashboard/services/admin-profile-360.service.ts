import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import type { User } from '../../../generated/prisma/client';
import { UserRole } from '../../../common/enums/user-role.enum';
import { AdminAuditService } from '../../admin-audit/admin-audit.service';
import { EARNING_LEDGER_KIND } from '../../tasker-finance/tasker-finance.constants';

export type Profile360Role = 'customer' | 'tasker';

const name = (user: { firstName: string | null; lastName: string | null; email?: string | null } | null | undefined): string =>
  `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() || user?.email || '';
const num = (value: unknown): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const MESSAGES_PER_CONVERSATION = 80;
const MAX_CONVERSATIONS = 30;
const MAX_BOOKINGS = 200;

/**
 * Everything an administrator needs about one customer or Tasker on a single
 * page: identity, lifetime stats (including the Tasker's total earnings),
 * every booking, payments, reviews, an activity timeline and the full chat
 * history with the automatic booking cards.
 *
 * Reading chats needs `conversations.read` on top of the customer/tasker read
 * permission, and opening a profile is written to the admin audit log.
 */
@Injectable()
export class AdminProfile360Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  private can(actor: User, permission: string): boolean {
    return actor.role === UserRole.SuperAdmin || actor.permissions.includes(permission);
  }

  async get(actor: User, userId: number, role: Profile360Role) {
    if (!this.can(actor, role === 'tasker' ? 'taskers.read' : 'customers.read')) {
      throw new ForbiddenException(`Missing required permission: ${role === 'tasker' ? 'taskers.read' : 'customers.read'}`);
    }
    const canReadChats = this.can(actor, 'conversations.read');

    const user = await this.prisma.user.findFirst({
      where: { id: userId, roles: { has: role }, deletedAt: null },
      include: { customerProfile: true, taskerProfile: true },
    });
    if (!user) throw new NotFoundException(`${role === 'tasker' ? 'Tasker' : 'Customer'} not found`);

    const ownBookings = role === 'tasker' ? { taskerId: userId } : { customerId: userId };

    const [bookings, bookingCount, reviews, reviewAgg, disputeCount, ledgerEarnings, cashEarnings, customerSpend, completedCount, cancelledByTasker, audit] =
      await Promise.all([
        this.prisma.booking.findMany({
          where: ownBookings,
          orderBy: { createdAt: 'desc' },
          take: MAX_BOOKINGS,
          select: {
            id: true,
            status: true,
            bookingDate: true,
            startTime: true,
            createdAt: true,
            serviceAmount: true,
            platformFeeAmount: true,
            totalChargedAmount: true,
            paymentCurrency: true,
            paymentSource: true,
            paymentStatus: true,
            paidAt: true,
            service: { select: { name: true } },
            customer: { select: { firstName: true, lastName: true, email: true } },
            tasker: { select: { firstName: true, lastName: true, email: true } },
          },
        }),
        this.prisma.booking.count({ where: ownBookings }),
        this.prisma.review.findMany({
          where: { revieweeId: userId, moderationStatus: 'visible' },
          orderBy: { createdAt: 'desc' },
          take: 100,
          include: { reviewer: { select: { firstName: true, lastName: true, email: true, profilePicture: true } } },
        }),
        this.prisma.review.aggregate({ where: { revieweeId: userId, moderationStatus: 'visible' }, _avg: { rating: true }, _count: { _all: true } }),
        this.prisma.taskComplaint.count({ where: { OR: [{ filedById: userId }, { booking: ownBookings }] } }),
        role === 'tasker'
          ? this.prisma.taskerWalletLedgerEntry.aggregate({
              where: { taskerId: userId, kind: EARNING_LEDGER_KIND.EarningRelease, status: 'settled' },
              _sum: { amount: true },
            })
          : Promise.resolve(null),
        role === 'tasker'
          ? this.prisma.booking.aggregate({
              where: { taskerId: userId, status: 'completed', paymentStatus: 'cash_confirmed' },
              _sum: { serviceAmount: true, tipAmount: true },
            })
          : Promise.resolve(null),
        role === 'customer'
          ? this.prisma.booking.aggregate({ where: { customerId: userId, status: 'completed' }, _sum: { totalChargedAmount: true } })
          : Promise.resolve(null),
        this.prisma.booking.count({ where: { ...ownBookings, status: 'completed' } }),
        role === 'tasker'
          ? this.prisma.booking.count({ where: { taskerId: userId, status: 'cancelled', cancelledByRole: 'tasker' } })
          : Promise.resolve(0),
        this.prisma.adminAuditLog.findMany({ where: { targetUserId: userId }, orderBy: { createdAt: 'desc' }, take: 100 }),
      ]);

    const currency = bookings.find((b) => b.paymentCurrency)?.paymentCurrency ?? 'MAD';
    const totalAmount =
      role === 'tasker'
        ? num(ledgerEarnings?._sum.amount) + num(cashEarnings?._sum.serviceAmount) + num(cashEarnings?._sum.tipAmount)
        : num(customerSpend?._sum.totalChargedAmount);

    const profileStatus = role === 'tasker' ? user.taskerProfile?.status : user.customerProfile?.status;
    const status = profileStatus ?? user.accountStatus;

    // ---- conversations (admin chat oversight, needs conversations.read) ----
    let conversations: unknown[] = [];
    if (canReadChats) {
      const rows = await this.prisma.conversation.findMany({
        where: role === 'tasker' ? { taskerId: userId } : { customerId: userId },
        orderBy: { lastMessageAt: 'desc' },
        take: MAX_CONVERSATIONS,
        include: {
          customer: { select: { id: true, firstName: true, lastName: true, email: true, profilePicture: true } },
          tasker: { select: { id: true, firstName: true, lastName: true, email: true, profilePicture: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: MESSAGES_PER_CONVERSATION },
        },
      });
      const links = rows.length
        ? await this.prisma.booking.findMany({
            where: { conversationId: { in: rows.map((r) => r.id) } },
            orderBy: { id: 'desc' },
            select: { id: true, conversationId: true, service: { select: { name: true } } },
          })
        : [];
      conversations = rows.map((row) => {
        const other = role === 'tasker' ? row.customer : row.tasker;
        const latestBooking = links.find((l) => l.conversationId === row.id);
        const messages = [...row.messages].reverse().map((m) => {
          const sender = m.senderId === row.customerId ? row.customer : row.tasker;
          return {
            id: m.id,
            kind: m.kind === 'system' ? 'system' : 'text',
            senderId: String(m.senderId),
            senderName: name(sender),
            text: m.body ?? '',
            event: m.kind === 'system' ? m.event : null,
            createdAt: m.createdAt.toISOString(),
          };
        });
        const last = row.messages[0];
        return {
          id: row.id,
          bookingId: latestBooking ? String(latestBooking.id) : '',
          participantId: String(other.id),
          participantName: name(other),
          participantAvatar: other.profilePicture ?? '',
          service: latestBooking?.service.name ?? '',
          lastMessage: last?.body ?? (last ? 'Attachment' : ''),
          updatedAt: (row.lastMessageAt ?? row.updatedAt).toISOString(),
          messages,
        };
      });
      await this.audit.record({
        actorId: actor.id,
        targetUserId: userId,
        action: 'profile_360_chats_viewed',
        entityType: role,
        entityId: userId,
        metadata: { conversations: rows.length },
      });
    }
    await this.audit.record({ actorId: actor.id, targetUserId: userId, action: 'profile_360_viewed', entityType: role, entityId: userId });

    const activity = [
      ...audit.map((entry) => ({
        id: entry.id,
        title: entry.action.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
        description: entry.reason ?? `${entry.entityType} ${entry.entityId ?? ''}`.trim(),
        createdAt: entry.createdAt.toISOString(),
        category: /review/.test(entry.action) ? 'review' : /payment|refund|invoice|wallet|withdraw|deposit/.test(entry.action) ? 'payment' : /booking/.test(entry.action) ? 'booking' : /suspend|ban|deactivat|password|session|login/.test(entry.action) ? 'security' : 'account',
      })),
      { id: 'registered', title: 'Account created', description: 'The account was registered.', createdAt: user.createdAt.toISOString(), category: 'account' as const },
    ];

    return {
      profile: {
        id: String(user.id),
        role,
        name: name(user),
        avatarUrl: user.profilePicture ?? '',
        email: user.email ?? '',
        phone: `${user.phoneCountryCode ?? ''} ${user.phoneNumber ?? ''}`.trim(),
        city: user.serviceAreaCity ?? '',
        status,
        statusReason: (role === 'tasker' ? user.taskerProfile?.statusReason : user.customerProfile?.statusReason) ?? null,
        verified: user.isVerified,
        memberSince: user.createdAt.toISOString(),
        lastActiveAt: (user.lastSeenAt ?? user.lastLoginAt)?.toISOString() ?? null,
        stats: {
          bookings: bookingCount,
          totalAmount,
          currency,
          rating: reviewAgg._avg.rating === null ? null : Number(reviewAgg._avg.rating.toFixed(2)),
          reviewCount: reviewAgg._count._all,
          disputes: disputeCount,
        },
        ...(role === 'tasker'
          ? {
              performance: {
                completionRate: completedCount + cancelledByTasker > 0 ? Math.round((completedCount / (completedCount + cancelledByTasker)) * 100) : 100,
                acceptanceRate: bookingCount > 0 ? Math.round(((bookingCount - bookings.filter((b) => b.status === 'cancelled' && !b.paidAt).length) / bookingCount) * 100) : 100,
              },
            }
          : {}),
      },
      bookings: bookings.map((b) => ({
        id: String(b.id),
        service: b.service.name ?? '',
        counterpartName: name(role === 'tasker' ? b.customer : b.tasker),
        scheduledAt: `${b.bookingDate.toISOString().slice(0, 10)}T${b.startTime || '00:00'}:00`,
        amount: num(b.totalChargedAmount ?? b.serviceAmount),
        currency: b.paymentCurrency ?? currency,
        status: b.status,
      })),
      payments: bookings
        .filter((b) => b.paymentStatus && b.paymentStatus !== 'unpaid' && b.paymentStatus !== 'pending')
        .map((b) => ({
          id: `P-${b.id}`,
          bookingId: String(b.id),
          createdAt: (b.paidAt ?? b.createdAt).toISOString(),
          serviceAmount: num(b.serviceAmount),
          platformFee: num(b.platformFeeAmount),
          total: num(b.totalChargedAmount ?? num(b.serviceAmount) + num(b.platformFeeAmount)),
          currency: b.paymentCurrency ?? currency,
          method: b.paymentSource ?? 'card',
          status: /refund/.test(b.paymentStatus ?? '') ? 'refunded' : /fail/.test(b.paymentStatus ?? '') ? 'failed' : 'paid',
        })),
      conversations,
      chatsRestricted: !canReadChats,
      reviews: reviews.map((r) => ({
        id: r.id,
        authorName: name(r.reviewer),
        authorAvatar: r.reviewer.profilePicture ?? '',
        bookingId: String(r.bookingId),
        rating: r.rating,
        comment: r.comment ?? '',
        createdAt: r.createdAt.toISOString(),
      })),
      activity,
    };
  }
}
