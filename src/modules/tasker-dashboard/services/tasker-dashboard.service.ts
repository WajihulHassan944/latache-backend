import { Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '../../../common/enums/user-role.enum';
import { PrismaService } from '../../../database/prisma.service';
import type { DashboardOverviewView } from '../tasker-dashboard.contracts';
import { WALLET_ENTRY_KIND } from '../tasker-dashboard.constants';
import { ReviewsService } from '../../reviews/reviews.service';
import { TaskerTasksService } from './tasker-tasks.service';
import { TaskerWalletService } from './tasker-wallet.service';

@Injectable()
export class TaskerDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TaskerTasksService,
    private readonly reviews: ReviewsService,
    private readonly wallet: TaskerWalletService,
  ) {}

  async overview(taskerId: number): Promise<DashboardOverviewView> {
    const tasker = await this.prisma.user.findFirst({
      where: { id: taskerId, roles: { has: UserRole.Tasker }, deletedAt: null, taskerProfile: { isNot: null } },
      select: {
        id: true,
        firstName: true,
        profilePicture: true,
        onboardingStatus: true,
        accountStatus: true,
        taskerProfile: { select: { status: true } },
        isElite: true,
        completedTasks: true,
      },
    });
    if (!tasker) throw new NotFoundException('Tasker account not found');

    const year = new Date().getUTCFullYear();
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year + 1, 0, 1));

    const [
      wallet,
      completion,
      averageReceived,
      averageGiven,
      nextTask,
      recentTransactions,
      payoutMethodCount,
      skillCount,
      totalEarnings,
      yearEntries,
    ] = await Promise.all([
      this.wallet.summary(taskerId),
      this.tasks.completionMetrics(taskerId),
      this.reviews.averageReceived(taskerId, UserRole.Tasker),
      this.reviews.averageGiven(taskerId, UserRole.Tasker),
      this.tasks.next(taskerId),
      this.wallet.recentTransactions(taskerId, 5),
      this.prisma.taskerPayoutMethod.count({
        where: { taskerId, status: 'active', deletedAt: null },
      }),
      this.prisma.userService.count({ where: { userId: taskerId } }),
      this.prisma.taskerWalletLedgerEntry.aggregate({
        where: { taskerId, kind: WALLET_ENTRY_KIND.Earning, status: 'settled' },
        _sum: { amount: true },
      }),
      this.prisma.taskerWalletLedgerEntry.findMany({
        where: {
          taskerId,
          kind: WALLET_ENTRY_KIND.Earning,
          status: 'settled',
          createdAt: { gte: yearStart, lt: yearEnd },
        },
        select: { amount: true, createdAt: true },
      }),
    ]);

    const monthly = Array.from({ length: 12 }, (_, index) => ({
      month: `${year}-${String(index + 1).padStart(2, '0')}`,
      amount: 0,
      currency: wallet.availableBalance.currency,
    }));
    for (const entry of yearEntries) {
      const monthIndex = entry.createdAt.getUTCMonth();
      const month = monthly[monthIndex];
      if (month) {
        month.amount = Number((month.amount + Number(entry.amount)).toFixed(2));
      }
    }

    const setupSteps: DashboardOverviewView['setup']['steps'] = [
      { key: 'payout_method', completed: payoutMethodCount > 0 },
      {
        key: 'profile_picture',
        completed: Boolean(tasker.profilePicture?.trim()),
      },
      { key: 'skill', completed: skillCount > 0 },
    ];

    return {
      tasker: {
        id: String(tasker.id),
        firstName: tasker.firstName ?? '',
        profilePicture: tasker.profilePicture ?? '',
        onboardingStatus: tasker.onboardingStatus,
        accountStatus: tasker.taskerProfile?.status ?? tasker.accountStatus,
      },
      setup: {
        completed: setupSteps.filter((step) => step.completed).length,
        total: setupSteps.length,
        steps: setupSteps,
      },
      wallet,
      metrics: {
        totalEarnings: {
          amount: Number(totalEarnings._sum.amount ?? 0),
          currency: wallet.availableBalance.currency,
        },
        averageRatingReceived: averageReceived,
        averageRatingGiven: averageGiven,
        taskCompletionPercent: completion.taskCompletionPercent,
        completedTasks: completion.completedTasks,
      },
      nextTask,
      monthlyEarnings: monthly,
      elite: {
        isElite: tasker.isElite,
        completedTasks: tasker.completedTasks,
        progress: null,
        criteriaConfigured: false,
      },
      recentTransactions,
    };
  }
}
