import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '../../common/enums/user-role.enum';
import { dateOnlyFromDate } from '../../common/utils/date.util';
import { PrismaService } from '../../database/prisma.service';
import { ReviewsService } from '../reviews/reviews.service';

@Injectable()
export class CustomerDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reviews: ReviewsService,
    private readonly config: ConfigService,
  ) {}

  async overview(customerId: number) {
    const customer = await this.prisma.user.findFirst({
      where: { id: customerId, role: UserRole.Customer, deletedAt: null },
      select: { id: true, firstName: true, profilePicture: true, accountStatus: true },
    });
    if (!customer) throw new NotFoundException('Customer account not found');

    const now = new Date();
    const year = now.getUTCFullYear();
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
    const activeStatuses = ['pending', 'confirmed', 'en_route', 'arrived', 'in_progress'];

    const [
      activeTasks,
      completedTasks,
      cancelledTasks,
      nextTask,
      favoriteCount,
      averageRatingGiven,
      recentBookings,
      spendRows,
      walletRecord,
    ] = await Promise.all([
      this.prisma.booking.count({ where: { customerId, status: { in: activeStatuses } } }),
      this.prisma.booking.count({ where: { customerId, status: 'completed' } }),
      this.prisma.booking.count({ where: { customerId, status: 'cancelled' } }),
      this.prisma.booking.findFirst({
        where: {
          customerId,
          status: { in: ['pending', 'confirmed', 'en_route', 'arrived'] },
          bookingDate: {
            gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
          },
        },
        include: {
          tasker: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              profilePicture: true,
              rating: true,
            },
          },
          service: { select: { id: true, name: true, slug: true, icon: true } },
        },
        orderBy: [{ bookingDate: 'asc' }, { startTime: 'asc' }],
      }),
      this.prisma.favoriteTasker.count({ where: { customerId } }),
      this.reviews.averageGiven(customerId),
      this.prisma.booking.findMany({
        where: { customerId },
        include: {
          tasker: { select: { id: true, firstName: true, lastName: true, profilePicture: true } },
          service: { select: { id: true, name: true, slug: true, icon: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      }),
      this.prisma.paymentTransaction.findMany({
        where: {
          customerId,
          kind: 'booking_charge',
          status: 'succeeded',
          createdAt: { gte: yearStart, lt: yearEnd },
        },
        select: { amount: true, currency: true, createdAt: true },
      }),
      this.prisma.customerWallet.findUnique({ where: { customerId } }),
    ]);

    const finalized = completedTasks + cancelledTasks;
    const monthlySpend = Array.from({ length: 12 }, (_, index) => ({
      month: `${year}-${String(index + 1).padStart(2, '0')}`,
      amount: 0,
      currency: spendRows[0]?.currency ?? 'USD',
    }));
    for (const row of spendRows) {
      const item = monthlySpend[row.createdAt.getUTCMonth()];
      if (item) item.amount = Number((item.amount + Number(row.amount)).toFixed(2));
    }

    const bookingSummary = (booking: typeof nextTask) =>
      booking
        ? {
            id: String(booking.id),
            status: booking.status,
            date: dateOnlyFromDate(booking.bookingDate),
            startTime: booking.startTime,
            endTime: booking.endTime,
            service: booking.service,
            tasker: {
              id: String(booking.tasker.id),
              name: `${booking.tasker.firstName ?? ''} ${booking.tasker.lastName ?? ''}`.trim(),
              profilePicture: booking.tasker.profilePicture ?? '',
              ...('rating' in booking.tasker ? { rating: Number(booking.tasker.rating) } : {}),
            },
            paymentStatus: booking.paymentStatus,
          }
        : null;

    return {
      customer: {
        id: String(customer.id),
        firstName: customer.firstName ?? '',
        profilePicture: customer.profilePicture ?? '',
        accountStatus: customer.accountStatus,
      },
      wallet: {
        availableBalance: Number(walletRecord?.availableBalance ?? 0),
        currency:
          walletRecord?.currency ??
          this.config.get<string>('payments.currency', 'USD').toUpperCase(),
      },
      metrics: {
        activeTasks,
        completedTasks,
        favoriteTaskers: favoriteCount,
        averageRatingGiven,
        taskCompletionPercent:
          finalized === 0 ? 0 : Number(((completedTasks / finalized) * 100).toFixed(1)),
      },
      nextTask: bookingSummary(nextTask),
      recentBookings: recentBookings.map((booking) => ({
        id: String(booking.id),
        status: booking.status,
        date: dateOnlyFromDate(booking.bookingDate),
        startTime: booking.startTime,
        service: booking.service,
        tasker: {
          id: String(booking.tasker.id),
          name: `${booking.tasker.firstName ?? ''} ${booking.tasker.lastName ?? ''}`.trim(),
          profilePicture: booking.tasker.profilePicture ?? '',
        },
        paymentStatus: booking.paymentStatus,
      })),
      monthlySpend,
    };
  }
}
