import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AccountStatus } from '../../../common/enums/account-status.enum';
import { UserRole } from '../../../common/enums/user-role.enum';
import { normalizePagination } from '../../../common/utils/pagination.util';
import { hasUserRole } from '../../../common/utils/user-role.util';
import { hasPrismaErrorCode } from '../../../database/prisma-error.util';
import { PrismaService } from '../../../database/prisma.service';
import {
  Prisma,
  type Referral,
  type ReferralReward,
  type User,
} from '../../../generated/prisma/client';
import { AdminAuditService } from '../../admin-audit/admin-audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PlatformSettingsService } from '../../platform-settings/platform-settings.service';
import type { ReferralPolicy } from '../../platform-settings/platform-settings.types';
import { RealtimeOutboxService } from '../../realtime/realtime-outbox.service';
import type {
  AdminReferralQueryDto,
  ReferralHistoryQueryDto,
  ReferralLeaderboardQueryDto,
} from '../dto/referrals.dto';
import {
  REFERRAL_ONLINE_PAYMENT_SOURCES,
  REFERRAL_PROGRAM,
  REFERRAL_REWARD_KIND,
  REFERRAL_REWARD_STATUS,
  REFERRAL_STATUS,
  REFERRAL_WALLET_ENTRY_KIND,
  type ReferralProgram,
} from '../referrals.constants';
import { calculateReferralDiscount } from '../referrals.utils';

const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const moneyString = (value: number): string => roundMoney(value).toFixed(2);
const DAY_MS = 24 * 60 * 60 * 1000;
const REFERRAL_CHARGEBACK_HOLD_STATUSES = [
  'warning_needs_response',
  'warning_under_review',
  'needs_response',
  'under_review',
  'lost',
] as const;

type PolicySnapshot = ReferralPolicy & { program: ReferralProgram };

@Injectable()
export class ReferralsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeOutboxService,
    private readonly audit: AdminAuditService,
  ) {}

  async me(user: User) {
    const program = this.programForRole(user.role);
    const [policy, code, received, invitedCount, qualifiedCount, rewardTotals] = await Promise.all([
      this.settings.referralPolicy(),
      this.ensureReferralCode(user),
      this.prisma.referral.findUnique({
        where: { referredUserId_program: { referredUserId: user.id, program } },
        include: { referrer: { select: { id: true, firstName: true, lastName: true } } },
      }),
      this.prisma.referral.count({ where: { referrerId: user.id, program } }),
      this.prisma.referral.count({
        where: { referrerId: user.id, program, status: { in: ['qualified', 'rewarded'] } },
      }),
      this.prisma.referralReward.aggregate({
        where: { recipientId: user.id, recipientRole: user.role },
        _sum: { settledAmount: true, reversedAmount: true },
      }),
    ]);
    return {
      program,
      enabled: this.isProgramEnabled(policy, program),
      code,
      policy: this.publicPolicy(policy, program),
      receivedReferral: received
        ? {
            ...this.serializeReferral(received),
            referrerDisplayName: this.maskedName(received.referrer),
          }
        : null,
      summary: {
        invitedCount,
        qualifiedCount,
        settledRewards: roundMoney(Number(rewardTotals._sum.settledAmount ?? 0)),
        reversedRewards: roundMoney(Number(rewardTotals._sum.reversedAmount ?? 0)),
        currency: policy.currency,
      },
    };
  }

  async claim(user: User, rawCode: string) {
    const code = rawCode.trim().toUpperCase();
    const program = this.programForRole(user.role);
    return this.prisma.$transaction(async (transaction) => {
      const referrer = await transaction.user.findUnique({ where: { referralCode: code } });
      if (!referrer) throw new NotFoundException('Referral code not found');
      await transaction.$queryRaw`
        SELECT "id" FROM "Users"
        WHERE "id" IN (${Prisma.join([user.id, referrer.id])})
        ORDER BY "id" FOR UPDATE
      `;
      const referred = await transaction.user.findUniqueOrThrow({ where: { id: user.id } });

      const existing = await transaction.referral.findUnique({
        where: { referredUserId_program: { referredUserId: user.id, program } },
      });
      if (existing) {
        if (existing.referrerId === referrer.id && existing.codeSnapshot === code) {
          return this.serializeReferral(existing);
        }
        throw new ConflictException('This account already has a referral attribution');
      }
      if (referrer.id === referred.id) {
        throw new BadRequestException('A referral code cannot be claimed by its owner');
      }
      if (!hasUserRole(referrer, user.role as UserRole) || !hasUserRole(referred, user.role as UserRole)) {
        throw new BadRequestException('Referral codes can only be claimed within the same active role');
      }
      const referrerRoleProfileActive =
        program === REFERRAL_PROGRAM.Customer
          ? (await transaction.customerProfile.findUnique({ where: { userId: referrer.id } }))?.status === 'active'
          : (await transaction.taskerProfile.findUnique({ where: { userId: referrer.id } }))?.status === 'active';
      if (
        !referrer.isVerified ||
        referrer.deletedAt ||
        referrer.accountStatus !== AccountStatus.Active ||
        !referrerRoleProfileActive
      ) {
        throw new ConflictException('The referral code owner is not eligible for referrals');
      }

      const policy = await this.settings.referralPolicy(transaction);
      if (!this.isProgramEnabled(policy, program)) {
        throw new ConflictException('This referral program is currently disabled');
      }
      if (!policy.uniqueCodesEnabled) {
        throw new ConflictException('Unique referral codes are not enabled');
      }
      await this.assertNewParticipantEligibility(transaction, referred.id, program);

      const maxReferrals =
        program === REFERRAL_PROGRAM.Customer
          ? policy.maxClientReferrals
          : policy.maxTaskerReferrals;
      if (maxReferrals > 0) {
        const active = await transaction.referral.count({
          where: {
            referrerId: referrer.id,
            program,
            status: { in: ['claimed', 'qualified', 'rewarded'] },
          },
        });
        if (active >= maxReferrals) {
          throw new ConflictException('The referral code has reached its configured limit');
        }
      }

      const now = new Date();
      const snapshot: PolicySnapshot = { ...policy, program };
      const referral = await transaction.referral.create({
        data: {
          referrerId: referrer.id,
          referredUserId: referred.id,
          program,
          codeSnapshot: code,
          policyVersion: policy.version,
          policySnapshot: snapshot as unknown as Prisma.InputJsonValue,
          expiresAt: new Date(now.getTime() + policy.referralExpiryDays * DAY_MS),
        },
      });
      await this.notifications.create(
        referrer.id,
        {
          category: 'system',
          type: 'referral_claimed',
          title: 'Your referral code was claimed',
          body: 'A new participant used your referral code. Rewards remain pending until a qualifying paid booking settles.',
          entityType: 'referral',
          entityId: referral.id,
        },
        transaction,
      );
      await this.enqueueReferralUpdate(transaction, referral, [referrer.id, referred.id]);
      return this.serializeReferral(referral);
    });
  }

  async history(user: User, query: ReferralHistoryQueryDto) {
    const program = this.programForRole(user.role);
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    if ((query.view ?? 'invites') === 'rewards') {
      const [rows, totalItems] = await Promise.all([
        this.prisma.referralReward.findMany({
          where: { recipientId: user.id, recipientRole: user.role },
          include: { referral: { select: { program: true, referredUserId: true } } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: offset,
          take: limit,
        }),
        this.prisma.referralReward.count({ where: { recipientId: user.id } }),
      ]);
      return {
        view: 'rewards',
        page,
        limit,
        totalItems,
        totalPages: Math.ceil(totalItems / limit),
        items: rows.map((row) => this.serializeReward(row)),
      };
    }
    const [rows, totalItems] = await Promise.all([
      this.prisma.referral.findMany({
        where: { referrerId: user.id, program },
        include: {
          referredUser: { select: { id: true, firstName: true, lastName: true, roles: true } },
          rewards: { where: { recipientId: user.id, recipientRole: user.role }, orderBy: { createdAt: 'asc' } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: limit,
      }),
      this.prisma.referral.count({ where: { referrerId: user.id, program } }),
    ]);
    return {
      view: 'invites',
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      items: rows.map((row) => ({
        ...this.serializeReferral(row),
        referredUser: {
          id: String(row.referredUser.id),
          displayName: this.maskedName(row.referredUser),
          role: row.program === REFERRAL_PROGRAM.Customer ? UserRole.Customer : UserRole.Tasker,
        },
        rewards: row.rewards.map((reward) => this.serializeReward(reward)),
      })),
    };
  }

  async leaderboard(user: User, query: ReferralLeaderboardQueryDto) {
    const defaultProgram = this.programForRole(user.role);
    const program = query.program ?? defaultProgram;
    const policy = await this.settings.referralPolicy();
    if (!policy.leaderboardEnabled || !this.isProgramEnabled(policy, program)) {
      throw new NotFoundException('Referral leaderboard is not enabled');
    }
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const rows = await this.prisma.$queryRaw<
      Array<{ referrerId: number; successfulCount: bigint }>
    >`
      SELECT "referrerId", COUNT(*)::bigint AS "successfulCount"
      FROM "Referrals"
      WHERE "program" = ${program}
        AND "status" IN ('qualified', 'rewarded')
      GROUP BY "referrerId"
      ORDER BY COUNT(*) DESC, "referrerId" ASC
      LIMIT ${limit}
    `;
    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((row) => row.referrerId) } },
      select: { id: true, firstName: true, lastName: true },
    });
    const byId = new Map(users.map((item) => [item.id, item]));
    return {
      program,
      items: rows.map((row, index) => ({
        rank: index + 1,
        displayName: this.maskedName(byId.get(row.referrerId)),
        isCurrentUser: row.referrerId === user.id,
        successfulReferrals: Number(row.successfulCount),
      })),
    };
  }

  async adminList(query: AdminReferralQueryDto) {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    const where: Prisma.ReferralWhereInput = {
      ...(query.program ? { program: query.program } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.referrerId ? { referrerId: query.referrerId } : {}),
      ...(query.referredUserId ? { referredUserId: query.referredUserId } : {}),
    };
    const [rows, totalItems] = await Promise.all([
      this.prisma.referral.findMany({
        where,
        include: {
          referrer: { select: { id: true, firstName: true, lastName: true, email: true } },
          referredUser: { select: { id: true, firstName: true, lastName: true, email: true } },
          rewards: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: limit,
      }),
      this.prisma.referral.count({ where }),
    ]);
    return {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      items: rows.map((row) => ({
        ...this.serializeReferral(row),
        referrer: row.referrer,
        referredUser: row.referredUser,
        rewards: row.rewards.map((reward) => this.serializeReward(reward)),
      })),
    };
  }

  async adminDetail(id: string) {
    const referral = await this.prisma.referral.findUnique({
      where: { id },
      include: {
        referrer: true,
        referredUser: true,
        qualifyingBooking: true,
        rewards: {
          include: { customerLedger: true, taskerLedger: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!referral) throw new NotFoundException('Referral not found');
    return {
      ...this.serializeReferral(referral),
      codeSnapshot: referral.codeSnapshot,
      policyVersion: referral.policyVersion,
      policySnapshot: referral.policySnapshot,
      revokedById: referral.revokedById ? String(referral.revokedById) : null,
      referrer: this.adminUser(referral.referrer),
      referredUser: this.adminUser(referral.referredUser),
      qualifyingBooking: referral.qualifyingBooking
        ? {
            id: String(referral.qualifyingBooking.id),
            status: referral.qualifyingBooking.status,
            paymentStatus: referral.qualifyingBooking.paymentStatus,
            paymentSource: referral.qualifyingBooking.paymentSource,
            totalChargedAmount: Number(referral.qualifyingBooking.totalChargedAmount ?? 0),
            currency: referral.qualifyingBooking.paymentCurrency,
            paidAt: referral.qualifyingBooking.paidAt?.toISOString() ?? null,
          }
        : null,
      rewards: referral.rewards.map((reward) => ({
        ...this.serializeReward(reward),
        customerLedger: reward.customerLedger,
        taskerLedger: reward.taskerLedger,
      })),
    };
  }

  async revoke(actor: User, id: string, reason: string) {
    return this.prisma.$transaction(async (transaction) => {
      const referral = await this.lockReferral(transaction, id);
      if (!referral) throw new NotFoundException('Referral not found');
      if (referral.status !== REFERRAL_STATUS.Revoked) {
        await this.revokeLockedReferral(transaction, referral, reason, actor.id);
        await this.audit.record(
          {
            actorId: actor.id,
            targetUserId: referral.referredUserId,
            action: 'referral_revoked',
            entityType: 'referral',
            entityId: referral.id,
            reason,
            metadata: { referrerId: referral.referrerId, program: referral.program },
          },
          transaction,
        );
      }
      return this.serializeReferral(
        await transaction.referral.findUniqueOrThrow({ where: { id } }),
      );
    });
  }

  async reserveCustomerDiscount(input: {
    bookingId: number;
    customerId: number;
    serviceAmount: number;
    totalBeforeDiscount: number;
    currency: string;
  }): Promise<{ amount: number; percent: number }> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "Bookings" WHERE "id" = ${input.bookingId} FOR UPDATE
      `;
      const booking = await transaction.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
      });
      if (
        booking.customerId !== input.customerId ||
        !REFERRAL_ONLINE_PAYMENT_SOURCES.includes(booking.paymentSource as never)
      ) {
        return { amount: 0, percent: 0 };
      }
      if (Number(booking.referralDiscountAmount) > 0) {
        return {
          amount: Number(booking.referralDiscountAmount),
          percent: Number(booking.referralDiscountPercent),
        };
      }
      const locked = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Referrals"
        WHERE "referredUserId" = ${input.customerId} AND "program" = 'customer'
        FOR UPDATE
      `;
      const lockedReferral = locked[0];
      if (!lockedReferral) return { amount: 0, percent: 0 };
      const referral = await transaction.referral.findUniqueOrThrow({
        where: { id: lockedReferral.id },
      });
      if (referral.status !== REFERRAL_STATUS.Claimed) return { amount: 0, percent: 0 };
      if (referral.expiresAt <= new Date()) {
        await this.expireLockedReferral(transaction, referral);
        return { amount: 0, percent: 0 };
      }
      const priorDiscount = await transaction.referralReward.findFirst({
        where: { referralId: referral.id, kind: REFERRAL_REWARD_KIND.ReferredCustomerDiscount },
        include: { booking: { select: { id: true, status: true } } },
      });
      if (priorDiscount?.bookingId === booking.id && priorDiscount.status === REFERRAL_REWARD_STATUS.Pending) {
        return {
          amount: Number(priorDiscount.amount),
          percent: Number(booking.referralDiscountPercent),
        };
      }

      const snapshot = this.snapshot(referral);
      const percent = Number(snapshot.referredClientDiscountPercent ?? 0);
      if (percent <= 0 || snapshot.currency !== input.currency.toUpperCase()) {
        return { amount: 0, percent: 0 };
      }
      const amount = calculateReferralDiscount({
        serviceAmount: input.serviceAmount,
        totalBeforeDiscount: input.totalBeforeDiscount,
        percent,
        maximumDiscountAmount: Number(snapshot.referredClientDiscountMaxAmount ?? 0),
        minimumCustomerChargeAmount: Number(snapshot.minimumCustomerChargeAmount ?? 0),
        minimumQualifyingBookingAmount: Number(snapshot.minimumQualifyingBookingAmount ?? 0),
      });
      if (amount <= 0) return { amount: 0, percent: 0 };

      if (priorDiscount) {
        const reusable =
          priorDiscount.status === REFERRAL_REWARD_STATUS.Cancelled ||
          (priorDiscount.status === REFERRAL_REWARD_STATUS.Pending &&
            priorDiscount.booking.status === 'cancelled');
        if (!reusable) return { amount: 0, percent: 0 };
        await transaction.referralReward.update({
          where: { id: priorDiscount.id },
          data: {
            bookingId: booking.id,
            status: REFERRAL_REWARD_STATUS.Pending,
            amount: moneyString(amount),
            settledAmount: '0.00',
            reversedAmount: '0.00',
            walletCreditAmount: '0.00',
            currency: input.currency.toUpperCase(),
            policySnapshot: referral.policySnapshot as Prisma.InputJsonValue,
            availableAt: new Date(),
            settledAt: null,
            reversedAt: null,
            cancellationReason: null,
          },
        });
      } else {
        await transaction.referralReward.create({
          data: {
            referralId: referral.id,
            recipientId: input.customerId,
            bookingId: booking.id,
            recipientRole: UserRole.Customer,
            kind: REFERRAL_REWARD_KIND.ReferredCustomerDiscount,
            amount: moneyString(amount),
            currency: input.currency.toUpperCase(),
            policySnapshot: referral.policySnapshot as Prisma.InputJsonValue,
            idempotencyKey: `referral:${referral.id}:customer-discount`,
            availableAt: new Date(),
          },
        });
      }
      await transaction.booking.update({
        where: { id: booking.id },
        data: {
          referralDiscountAmount: moneyString(amount),
          referralDiscountPercent: percent.toFixed(4),
        },
      });
      return { amount, percent };
    });
  }

  async releaseCustomerDiscountReservation(
    transaction: Prisma.TransactionClient,
    bookingId: number,
    reason: string,
  ): Promise<boolean> {
    const candidate = await transaction.referralReward.findFirst({
      where: {
        bookingId,
        kind: REFERRAL_REWARD_KIND.ReferredCustomerDiscount,
        status: REFERRAL_REWARD_STATUS.Pending,
      },
      select: { id: true, referralId: true },
    });
    if (!candidate) return false;

    await transaction.$queryRaw`SELECT "id" FROM "Referrals" WHERE "id" = ${candidate.referralId} FOR UPDATE`;
    await transaction.$queryRaw`SELECT "id" FROM "ReferralRewards" WHERE "id" = ${candidate.id} FOR UPDATE`;
    const reward = await transaction.referralReward.findUnique({
      where: { id: candidate.id },
      include: { referral: true },
    });
    if (!reward || reward.status !== REFERRAL_REWARD_STATUS.Pending || reward.bookingId !== bookingId) {
      return false;
    }

    const cancellationReason = reason.trim().slice(0, 1000) || 'Booking cancelled before referral qualification';
    const cancelled = await transaction.referralReward.update({
      where: { id: reward.id },
      data: {
        status: REFERRAL_REWARD_STATUS.Cancelled,
        cancellationReason,
      },
    });
    await transaction.booking.update({
      where: { id: bookingId },
      data: { referralDiscountAmount: '0.00', referralDiscountPercent: '0.0000' },
    });
    await this.realtime.enqueueUser(
      reward.recipientId,
      'referral:updated',
      { referralId: reward.referralId, reward: this.serializeReward(cancelled) },
      transaction,
    );
    await this.enqueueReferralUpdate(transaction, reward.referral, [
      reward.referral.referrerId,
      reward.referral.referredUserId,
    ]);
    return true;
  }

  async handleBookingChargeback(
    transaction: Prisma.TransactionClient,
    bookingId: number,
    stripeStatus: string,
  ): Promise<void> {
    if (stripeStatus !== 'lost') return;
    const referrals = await transaction.referral.findMany({
      where: {
        qualifyingBookingId: bookingId,
        status: { in: [REFERRAL_STATUS.Qualified, REFERRAL_STATUS.Rewarded] },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    for (const row of referrals) {
      const locked = await this.lockReferral(transaction, row.id);
      if (!locked || locked.status === REFERRAL_STATUS.Revoked) continue;
      const reason = 'Qualifying booking was lost to a Stripe chargeback';
      await this.revokeLockedReferral(transaction, locked, reason, null);
      await this.audit.record(
        {
          targetUserId: locked.referredUserId,
          action: 'referral_revoked_after_stripe_chargeback',
          entityType: 'referral',
          entityId: locked.id,
          reason,
          metadata: { bookingId, stripeStatus },
        },
        transaction,
      );
    }
  }

  async qualifyPaidBooking(
    transaction: Prisma.TransactionClient,
    bookingId: number,
  ): Promise<void> {
    const booking = await transaction.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (
      booking.paymentStatus !== 'paid' ||
      !booking.paidAt ||
      !REFERRAL_ONLINE_PAYMENT_SOURCES.includes(booking.paymentSource as never)
    ) {
      return;
    }
    const lockRows = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Referrals"
      WHERE "referredUserId" IN (${Prisma.join([booking.customerId, booking.taskerId])})
        AND "status" = 'claimed'
      ORDER BY "id" FOR UPDATE
    `;
    for (const row of lockRows) {
      const referral = await transaction.referral.findUniqueOrThrow({ where: { id: row.id } });
      const expectedUserId =
        referral.program === REFERRAL_PROGRAM.Customer ? booking.customerId : booking.taskerId;
      if (referral.referredUserId !== expectedUserId) continue;
      const snapshot = this.snapshot(referral);
      if (snapshot.currency !== booking.paymentCurrency.toUpperCase()) continue;
      const discount = await transaction.referralReward.findFirst({
        where: {
          referralId: referral.id,
          kind: REFERRAL_REWARD_KIND.ReferredCustomerDiscount,
        },
      });
      if (referral.expiresAt <= booking.paidAt && discount?.bookingId !== booking.id) {
        await this.expireLockedReferral(transaction, referral);
        continue;
      }
      if (discount && discount.bookingId !== booking.id) continue;
      if (
        Number(booking.totalChargedAmount ?? 0) + 0.005 <
        snapshot.minimumQualifyingBookingAmount
      ) {
        continue;
      }

      const availableAt = new Date(
        booking.paidAt.getTime() + snapshot.rewardClearanceDays * DAY_MS,
      );
      if (referral.program === REFERRAL_PROGRAM.Customer) {
        if (discount) {
          await transaction.referralReward.update({
            where: { id: discount.id },
            data: {
              status: REFERRAL_REWARD_STATUS.Settled,
              settledAmount: discount.amount,
              settledAt: booking.paidAt,
            },
          });
        }
        await this.createPendingReward(transaction, {
          referral,
          recipientId: referral.referrerId,
          recipientRole: UserRole.Customer,
          bookingId,
          kind: REFERRAL_REWARD_KIND.CustomerReferrerCredit,
          amount: snapshot.clientReferralBonus,
          currency: snapshot.currency,
          availableAt,
        });
      } else {
        await this.createPendingReward(transaction, {
          referral,
          recipientId: referral.referrerId,
          recipientRole: UserRole.Tasker,
          bookingId,
          kind: REFERRAL_REWARD_KIND.TaskerReferrerCredit,
          amount: snapshot.taskerReferralBonus,
          currency: snapshot.currency,
          availableAt,
        });
        await this.createPendingReward(transaction, {
          referral,
          recipientId: referral.referredUserId,
          recipientRole: UserRole.Tasker,
          bookingId,
          kind: REFERRAL_REWARD_KIND.ReferredTaskerCredit,
          amount: snapshot.referredTaskerBonus,
          currency: snapshot.currency,
          availableAt,
        });
      }
      const qualified = await transaction.referral.update({
        where: { id: referral.id },
        data: {
          status: REFERRAL_STATUS.Qualified,
          qualifyingBookingId: booking.id,
          qualifiedAt: booking.paidAt,
        },
      });
      await this.notifications.create(
        referral.referrerId,
        {
          category: 'wallet',
          type: 'referral_qualified',
          title: 'Referral qualified',
          body: 'A referred participant completed a qualifying paid booking. Any configured wallet reward is now in its clearance period.',
          entityType: 'referral',
          entityId: referral.id,
        },
        transaction,
      );
      await this.enqueueReferralUpdate(transaction, qualified, [
        referral.referrerId,
        referral.referredUserId,
      ]);

      const immediate = await transaction.referralReward.findMany({
        where: {
          referralId: referral.id,
          status: REFERRAL_REWARD_STATUS.Pending,
          availableAt: { lte: new Date() },
        },
        select: { id: true },
      });
      for (const reward of immediate) await this.releaseReward(transaction, reward.id, new Date());
      await this.refreshReferralRewardedStatus(transaction, referral.id);
    }
  }

  async handleBookingRefund(
    transaction: Prisma.TransactionClient,
    bookingId: number,
  ): Promise<void> {
    const booking = await transaction.booking.findUniqueOrThrow({ where: { id: bookingId } });
    const referrals = await transaction.referral.findMany({
      where: {
        qualifyingBookingId: bookingId,
        status: { in: [REFERRAL_STATUS.Qualified, REFERRAL_STATUS.Rewarded] },
      },
    });
    if (referrals.length === 0) return;
    const refunds = await transaction.paymentTransaction.aggregate({
      where: { bookingId, kind: 'refund', status: 'succeeded' },
      _sum: { amount: true },
    });
    const remaining = roundMoney(
      Math.max(0, Number(booking.totalChargedAmount ?? 0) - Number(refunds._sum.amount ?? 0)),
    );
    for (const referral of referrals) {
      const snapshot = this.snapshot(referral);
      const noLongerEligible =
        remaining <= 0.005 || remaining + 0.005 < snapshot.minimumQualifyingBookingAmount;
      if (!noLongerEligible) continue;
      const locked = await this.lockReferral(transaction, referral.id);
      if (!locked || locked.status === REFERRAL_STATUS.Revoked) continue;
      const reason =
        'Qualifying booking no longer satisfies referral policy after a settled refund';
      await this.revokeLockedReferral(transaction, locked, reason, null);
      await this.audit.record(
        {
          targetUserId: locked.referredUserId,
          action: 'referral_revoked_after_refund',
          entityType: 'referral',
          entityId: locked.id,
          reason,
          metadata: { bookingId, remainingPaidAmount: remaining },
        },
        transaction,
      );
    }
  }

  async releaseMatureRewards(now = new Date(), batchSize = 100): Promise<number> {
    const candidates = await this.prisma.referralReward.findMany({
      where: { status: REFERRAL_REWARD_STATUS.Pending, availableAt: { lte: now } },
      select: { id: true },
      orderBy: [{ availableAt: 'asc' }, { id: 'asc' }],
      take: batchSize,
    });
    let released = 0;
    for (const candidate of candidates) {
      const didRelease = await this.prisma.$transaction((transaction) =>
        this.releaseReward(transaction, candidate.id, now),
      );
      if (didRelease) released += 1;
    }
    return released;
  }

  async expireStaleReferrals(now = new Date(), batchSize = 100): Promise<number> {
    const candidates = await this.prisma.referral.findMany({
      where: { status: REFERRAL_STATUS.Claimed, expiresAt: { lte: now } },
      select: { id: true },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: batchSize,
    });
    let expired = 0;
    for (const candidate of candidates) {
      const changed = await this.prisma.$transaction(async (transaction) => {
        const referral = await this.lockReferral(transaction, candidate.id);
        if (!referral || referral.status !== REFERRAL_STATUS.Claimed || referral.expiresAt > now) {
          return false;
        }
        return this.expireLockedReferral(transaction, referral);
      });
      if (changed) expired += 1;
    }
    return expired;
  }

  private async releaseReward(
    transaction: Prisma.TransactionClient,
    rewardId: string,
    now: Date,
  ): Promise<boolean> {
    const candidate = await transaction.referralReward.findUnique({
      where: { id: rewardId },
      select: { referralId: true, bookingId: true },
    });
    if (!candidate) return false;
    await transaction.$queryRaw`
      SELECT "id" FROM "Bookings" WHERE "id" = ${candidate.bookingId} FOR UPDATE
    `;
    await transaction.$queryRaw`
      SELECT "id" FROM "Referrals" WHERE "id" = ${candidate.referralId} FOR UPDATE
    `;
    const locked = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "ReferralRewards" WHERE "id" = ${rewardId} FOR UPDATE
    `;
    if (locked.length === 0) return false;
    const reward = await transaction.referralReward.findUniqueOrThrow({
      where: { id: rewardId },
      include: { referral: true, booking: true },
    });
    if (
      reward.status !== REFERRAL_REWARD_STATUS.Pending ||
      reward.availableAt > now ||
      reward.referral.status === REFERRAL_STATUS.Revoked
    ) {
      return false;
    }
    const [disputes, providerDisputes] = await Promise.all([
      transaction.taskComplaint.count({
        where: {
          bookingId: reward.bookingId,
          status: { in: ['open', 'under_investigation', 'escalated'] },
        },
      }),
      transaction.stripeChargeback.count({
        where: {
          bookingId: reward.bookingId,
          status: { in: [...REFERRAL_CHARGEBACK_HOLD_STATUSES] },
        },
      }),
    ]);
    if (disputes > 0 || providerDisputes > 0) return false;
    const snapshot = this.snapshot(reward.referral);
    const refunds = await transaction.paymentTransaction.aggregate({
      where: { bookingId: reward.bookingId, kind: 'refund', status: 'succeeded' },
      _sum: { amount: true },
    });
    const remaining = roundMoney(
      Math.max(
        0,
        Number(reward.booking.totalChargedAmount ?? 0) - Number(refunds._sum.amount ?? 0),
      ),
    );
    if (remaining <= 0.005 || remaining + 0.005 < snapshot.minimumQualifyingBookingAmount) {
      const reason = 'Qualifying payment was refunded before reward release';
      await this.revokeLockedReferral(transaction, reward.referral, reason, null);
      await this.audit.record(
        {
          targetUserId: reward.referral.referredUserId,
          action: 'referral_revoked_before_reward_release',
          entityType: 'referral',
          entityId: reward.referral.id,
          reason,
          metadata: { bookingId: reward.bookingId, remainingPaidAmount: remaining },
        },
        transaction,
      );
      return false;
    }
    if (reward.recipientRole === UserRole.Customer) {
      await this.creditCustomerReward(transaction, reward);
    } else if (reward.recipientRole === UserRole.Tasker) {
      await this.creditTaskerReward(transaction, reward);
    } else {
      throw new ConflictException('Referral reward recipient role is invalid');
    }
    const updated = await transaction.referralReward.update({
      where: { id: reward.id },
      data: {
        status: REFERRAL_REWARD_STATUS.Settled,
        settledAmount: reward.amount,
        walletCreditAmount: reward.amount,
        settledAt: now,
      },
    });
    await this.notifications.create(
      reward.recipientId,
      {
        category: 'wallet',
        type: 'referral_reward_available',
        title: 'Referral reward available',
        body: `${reward.currency} ${Number(reward.amount).toFixed(2)} was added to your wallet after referral clearance.`,
        entityType: 'referral_reward',
        entityId: reward.id,
      },
      transaction,
    );
    await this.realtime.enqueueUser(
      reward.recipientId,
      'referral:updated',
      { referralId: reward.referralId, reward: this.serializeReward(updated) },
      transaction,
    );
    await this.refreshReferralRewardedStatus(transaction, reward.referralId);
    return true;
  }

  private async creditCustomerReward(
    transaction: Prisma.TransactionClient,
    reward: ReferralReward,
  ): Promise<void> {
    await transaction.customerWallet.upsert({
      where: { customerId: reward.recipientId },
      create: { customerId: reward.recipientId, currency: reward.currency },
      update: {},
    });
    await transaction.$queryRaw`
      SELECT "customerId" FROM "CustomerWallets"
      WHERE "customerId" = ${reward.recipientId} FOR UPDATE
    `;
    const wallet = await transaction.customerWallet.findUniqueOrThrow({
      where: { customerId: reward.recipientId },
    });
    if (wallet.currency !== reward.currency)
      throw new ConflictException('Wallet currency mismatch');
    const idempotencyKey = `referral:${reward.id}:credit`;
    const existing = await transaction.customerWalletLedgerEntry.findUnique({
      where: { idempotencyKey },
    });
    if (existing) return;
    await transaction.customerWallet.update({
      where: { customerId: reward.recipientId },
      data: { availableBalance: { increment: reward.amount } },
    });
    await transaction.customerWalletLedgerEntry.create({
      data: {
        customerId: reward.recipientId,
        bookingId: reward.bookingId,
        referralRewardId: reward.id,
        kind: REFERRAL_WALLET_ENTRY_KIND.Reward,
        status: 'settled',
        amount: reward.amount,
        balanceDelta: reward.amount,
        currency: reward.currency,
        description: `Referral reward for booking #${reward.bookingId}`,
        providerReference: `referral:${reward.id}`,
        idempotencyKey,
      },
    });
  }

  private async creditTaskerReward(
    transaction: Prisma.TransactionClient,
    reward: ReferralReward,
  ): Promise<void> {
    await transaction.taskerWallet.upsert({
      where: { taskerId: reward.recipientId },
      create: { taskerId: reward.recipientId, currency: reward.currency },
      update: {},
    });
    await transaction.$queryRaw`
      SELECT "taskerId" FROM "TaskerWallets"
      WHERE "taskerId" = ${reward.recipientId} FOR UPDATE
    `;
    const wallet = await transaction.taskerWallet.findUniqueOrThrow({
      where: { taskerId: reward.recipientId },
    });
    if (wallet.currency !== reward.currency)
      throw new ConflictException('Wallet currency mismatch');
    const idempotencyKey = `referral:${reward.id}:credit`;
    const existing = await transaction.taskerWalletLedgerEntry.findUnique({
      where: { idempotencyKey },
    });
    if (existing) return;
    await transaction.taskerWallet.update({
      where: { taskerId: reward.recipientId },
      data: { availableBalance: { increment: reward.amount } },
    });
    await transaction.taskerWalletLedgerEntry.create({
      data: {
        taskerId: reward.recipientId,
        bookingId: reward.bookingId,
        referralRewardId: reward.id,
        kind: REFERRAL_WALLET_ENTRY_KIND.Reward,
        status: 'settled',
        amount: reward.amount,
        availableDelta: reward.amount,
        pendingDelta: '0.00',
        currency: reward.currency,
        description: `Referral reward for booking #${reward.bookingId}`,
        externalReference: `referral:${reward.id}`,
        idempotencyKey,
      },
    });
  }

  private async revokeLockedReferral(
    transaction: Prisma.TransactionClient,
    referral: Referral,
    reason: string,
    actorId: number | null,
  ): Promise<void> {
    const rewards = await transaction.referralReward.findMany({
      where: { referralId: referral.id },
      orderBy: { id: 'asc' },
    });
    for (const reward of rewards) {
      await transaction.$queryRaw`
        SELECT "id" FROM "ReferralRewards" WHERE "id" = ${reward.id} FOR UPDATE
      `;
      if (reward.status === REFERRAL_REWARD_STATUS.Pending) {
        await transaction.referralReward.update({
          where: { id: reward.id },
          data: { status: REFERRAL_REWARD_STATUS.Cancelled, cancellationReason: reason },
        });
        continue;
      }
      if (
        reward.status !== REFERRAL_REWARD_STATUS.Settled ||
        Number(reward.reversedAmount) >= Number(reward.settledAmount) - 0.005
      ) {
        continue;
      }
      const walletAmount = Number(reward.walletCreditAmount);
      if (walletAmount > 0) {
        if (reward.recipientRole === UserRole.Customer) {
          await this.reverseCustomerReward(transaction, reward, walletAmount);
        } else if (reward.recipientRole === UserRole.Tasker) {
          await this.reverseTaskerReward(transaction, reward, walletAmount);
        }
      }
      await transaction.referralReward.update({
        where: { id: reward.id },
        data: {
          status: REFERRAL_REWARD_STATUS.Reversed,
          reversedAmount: reward.settledAmount,
          reversedAt: new Date(),
          cancellationReason: reason,
        },
      });
      await this.notifications.create(
        reward.recipientId,
        {
          category: 'wallet',
          type: 'referral_revoked',
          title: 'Referral reward reversed',
          body: 'A referral reward was reversed after the referral became ineligible. The immutable wallet ledger records the adjustment.',
          entityType: 'referral',
          entityId: referral.id,
          metadata: { rewardId: reward.id, actorId },
        },
        transaction,
      );
    }
    const revoked = await transaction.referral.update({
      where: { id: referral.id },
      data: {
        status: REFERRAL_STATUS.Revoked,
        revokedAt: new Date(),
        revokedById: actorId,
        revocationReason: reason,
      },
    });
    await this.enqueueReferralUpdate(transaction, revoked, [
      referral.referrerId,
      referral.referredUserId,
    ]);
  }

  private async reverseCustomerReward(
    transaction: Prisma.TransactionClient,
    reward: ReferralReward,
    amount: number,
  ): Promise<void> {
    await transaction.$queryRaw`
      SELECT "customerId" FROM "CustomerWallets"
      WHERE "customerId" = ${reward.recipientId} FOR UPDATE
    `;
    const key = `referral:${reward.id}:reversal`;
    if (
      await transaction.customerWalletLedgerEntry.findUnique({ where: { idempotencyKey: key } })
    ) {
      return;
    }
    await transaction.customerWallet.update({
      where: { customerId: reward.recipientId },
      data: { availableBalance: { decrement: moneyString(amount) } },
    });
    await transaction.customerWalletLedgerEntry.create({
      data: {
        customerId: reward.recipientId,
        bookingId: reward.bookingId,
        referralRewardId: reward.id,
        kind: REFERRAL_WALLET_ENTRY_KIND.Reversal,
        status: 'settled',
        amount: moneyString(amount),
        balanceDelta: moneyString(-amount),
        currency: reward.currency,
        description: `Referral reward reversal for booking #${reward.bookingId}`,
        providerReference: `referral-reversal:${reward.id}`,
        idempotencyKey: key,
      },
    });
  }

  private async reverseTaskerReward(
    transaction: Prisma.TransactionClient,
    reward: ReferralReward,
    amount: number,
  ): Promise<void> {
    await transaction.$queryRaw`
      SELECT "taskerId" FROM "TaskerWallets"
      WHERE "taskerId" = ${reward.recipientId} FOR UPDATE
    `;
    const key = `referral:${reward.id}:reversal`;
    if (await transaction.taskerWalletLedgerEntry.findUnique({ where: { idempotencyKey: key } })) {
      return;
    }
    await transaction.taskerWallet.update({
      where: { taskerId: reward.recipientId },
      data: { availableBalance: { decrement: moneyString(amount) } },
    });
    await transaction.taskerWalletLedgerEntry.create({
      data: {
        taskerId: reward.recipientId,
        bookingId: reward.bookingId,
        referralRewardId: reward.id,
        kind: REFERRAL_WALLET_ENTRY_KIND.Reversal,
        status: 'settled',
        amount: moneyString(amount),
        availableDelta: moneyString(-amount),
        pendingDelta: '0.00',
        currency: reward.currency,
        description: `Referral reward reversal for booking #${reward.bookingId}`,
        externalReference: `referral-reversal:${reward.id}`,
        idempotencyKey: key,
      },
    });
  }

  private async createPendingReward(
    transaction: Prisma.TransactionClient,
    input: {
      referral: Referral;
      recipientId: number;
      recipientRole: UserRole.Customer | UserRole.Tasker;
      bookingId: number;
      kind: string;
      amount: number;
      currency: string;
      availableAt: Date;
    },
  ): Promise<void> {
    if (input.amount <= 0) return;
    const existing = await transaction.referralReward.findFirst({
      where: {
        referralId: input.referral.id,
        recipientId: input.recipientId,
        kind: input.kind,
      },
    });
    if (existing) return;
    await transaction.referralReward.create({
      data: {
        referralId: input.referral.id,
        recipientId: input.recipientId,
        bookingId: input.bookingId,
        recipientRole: input.recipientRole,
        kind: input.kind,
        amount: moneyString(input.amount),
        currency: input.currency,
        policySnapshot: input.referral.policySnapshot as Prisma.InputJsonValue,
        idempotencyKey: `referral:${input.referral.id}:${input.kind}:${input.recipientId}`,
        availableAt: input.availableAt,
      },
    });
  }

  private async refreshReferralRewardedStatus(
    transaction: Prisma.TransactionClient,
    referralId: string,
  ): Promise<void> {
    const referral = await transaction.referral.findUniqueOrThrow({ where: { id: referralId } });
    if (referral.status !== REFERRAL_STATUS.Qualified) return;
    const [pending, rewards] = await Promise.all([
      transaction.referralReward.count({
        where: { referralId, status: REFERRAL_REWARD_STATUS.Pending },
      }),
      transaction.referralReward.count({ where: { referralId } }),
    ]);
    if (pending === 0 && rewards > 0) {
      await transaction.referral.update({
        where: { id: referralId },
        data: { status: REFERRAL_STATUS.Rewarded, rewardedAt: new Date() },
      });
    }
  }

  private async expireLockedReferral(
    transaction: Prisma.TransactionClient,
    referral: Referral,
  ): Promise<boolean> {
    const reservedDiscounts = await transaction.referralReward.findMany({
      where: {
        referralId: referral.id,
        kind: REFERRAL_REWARD_KIND.ReferredCustomerDiscount,
        status: REFERRAL_REWARD_STATUS.Pending,
      },
      include: { booking: { select: { id: true, status: true } } },
    });
    const activeReservation = reservedDiscounts.find((reward) => reward.booking.status !== 'cancelled');
    if (activeReservation) return false;
    for (const reward of reservedDiscounts) {
      await transaction.referralReward.update({
        where: { id: reward.id },
        data: {
          status: REFERRAL_REWARD_STATUS.Cancelled,
          cancellationReason: 'Booking cancelled before referral qualification',
        },
      });
      await transaction.booking.update({
        where: { id: reward.bookingId },
        data: { referralDiscountAmount: '0.00', referralDiscountPercent: '0.0000' },
      });
    }
    const updated = await transaction.referral.update({
      where: { id: referral.id },
      data: { status: REFERRAL_STATUS.Expired },
    });
    await this.notifications.create(
      referral.referredUserId,
      {
        category: 'system',
        type: 'referral_expired',
        title: 'Referral expired',
        body: 'The referral qualification window ended before an eligible paid booking settled.',
        entityType: 'referral',
        entityId: referral.id,
      },
      transaction,
    );
    await this.enqueueReferralUpdate(transaction, updated, [
      referral.referrerId,
      referral.referredUserId,
    ]);
    return true;
  }

  private async assertNewParticipantEligibility(
    transaction: Prisma.TransactionClient,
    userId: number,
    program: ReferralProgram,
  ): Promise<void> {
    const count = await transaction.booking.count({
      where: {
        ...(program === REFERRAL_PROGRAM.Customer ? { customerId: userId } : { taskerId: userId }),
        paymentStatus: {
          in: ['paid', 'partially_refunded', 'refunded', 'cash_confirmed'],
        },
      },
    });
    if (count > 0) {
      throw new ConflictException(
        'Referral codes must be claimed before the first settled booking',
      );
    }
  }

  private async ensureReferralCode(user: User): Promise<string> {
    this.programForRole(user.role);
    const existing = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { referralCode: true },
    });
    if (existing?.referralCode) return existing.referralCode;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = `LT${user.role === UserRole.Customer ? 'C' : 'T'}${randomBytes(8)
        .toString('hex')
        .toUpperCase()}`;
      try {
        const updated = await this.prisma.user.updateMany({
          where: { id: user.id, referralCode: null },
          data: { referralCode: code },
        });
        if (updated.count === 1) return code;
        const raced = await this.prisma.user.findUniqueOrThrow({
          where: { id: user.id },
          select: { referralCode: true },
        });
        if (raced.referralCode) return raced.referralCode;
      } catch (error) {
        if (!hasPrismaErrorCode(error, 'P2002')) throw error;
      }
    }
    throw new ConflictException('Could not allocate a unique referral code');
  }

  private async lockReferral(
    transaction: Prisma.TransactionClient,
    id: string,
  ): Promise<Referral | null> {
    const locked = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Referrals" WHERE "id" = ${id} FOR UPDATE
    `;
    return locked.length ? transaction.referral.findUnique({ where: { id } }) : null;
  }

  private snapshot(referral: Pick<Referral, 'policySnapshot'>): PolicySnapshot {
    return referral.policySnapshot as unknown as PolicySnapshot;
  }

  private programForRole(role: string): ReferralProgram {
    if (role === UserRole.Customer) return REFERRAL_PROGRAM.Customer;
    if (role === UserRole.Tasker) return REFERRAL_PROGRAM.Tasker;
    throw new ForbiddenException('Referral programs are available to customers and taskers only');
  }

  private isProgramEnabled(policy: ReferralPolicy, program: ReferralProgram): boolean {
    return program === REFERRAL_PROGRAM.Customer
      ? policy.clientReferralEnabled
      : policy.taskerReferralEnabled;
  }

  private publicPolicy(policy: ReferralPolicy, program: ReferralProgram) {
    return {
      referralExpiryDays: policy.referralExpiryDays,
      rewardClearanceDays: policy.rewardClearanceDays,
      minimumQualifyingBookingAmount: policy.minimumQualifyingBookingAmount,
      maximumReferrals:
        program === REFERRAL_PROGRAM.Customer
          ? policy.maxClientReferrals
          : policy.maxTaskerReferrals,
      referrerBonus:
        program === REFERRAL_PROGRAM.Customer
          ? policy.clientReferralBonus
          : policy.taskerReferralBonus,
      referredBonus:
        program === REFERRAL_PROGRAM.Customer
          ? { discountPercent: policy.referredClientDiscountPercent }
          : { walletAmount: policy.referredTaskerBonus },
      currency: policy.currency,
    };
  }

  private serializeReferral(referral: Referral & { referrer?: unknown; referredUser?: unknown }) {
    return {
      id: referral.id,
      program: referral.program,
      status: referral.status,
      referrerId: String(referral.referrerId),
      referredUserId: String(referral.referredUserId),
      qualifyingBookingId: referral.qualifyingBookingId
        ? String(referral.qualifyingBookingId)
        : null,
      expiresAt: referral.expiresAt.toISOString(),
      qualifiedAt: referral.qualifiedAt?.toISOString() ?? null,
      rewardedAt: referral.rewardedAt?.toISOString() ?? null,
      revokedAt: referral.revokedAt?.toISOString() ?? null,
      revocationReason: referral.revocationReason,
      createdAt: referral.createdAt.toISOString(),
      updatedAt: referral.updatedAt.toISOString(),
    };
  }

  private serializeReward(reward: ReferralReward) {
    return {
      id: reward.id,
      referralId: reward.referralId,
      bookingId: String(reward.bookingId),
      recipientId: String(reward.recipientId),
      recipientRole: reward.recipientRole,
      kind: reward.kind,
      status: reward.status,
      amount: { amount: Number(reward.amount), currency: reward.currency },
      settledAmount: Number(reward.settledAmount),
      reversedAmount: Number(reward.reversedAmount),
      availableAt: reward.availableAt.toISOString(),
      settledAt: reward.settledAt?.toISOString() ?? null,
      reversedAt: reward.reversedAt?.toISOString() ?? null,
      cancellationReason: reward.cancellationReason,
      createdAt: reward.createdAt.toISOString(),
    };
  }

  private async enqueueReferralUpdate(
    transaction: Prisma.TransactionClient,
    referral: Referral,
    userIds: number[],
  ): Promise<void> {
    for (const userId of [...new Set(userIds)]) {
      await this.realtime.enqueueUser(
        userId,
        'referral:updated',
        { referral: this.serializeReferral(referral) },
        transaction,
      );
    }
  }

  private maskedName(user?: { firstName: string | null; lastName: string | null }): string {
    if (!user) return 'Participant';
    const first = user.firstName?.trim() || 'Participant';
    const lastInitial = user.lastName?.trim().slice(0, 1).toUpperCase();
    return lastInitial ? `${first} ${lastInitial}.` : first;
  }

  private adminUser(user: User) {
    return {
      id: String(user.id),
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      accountStatus: user.accountStatus,
      isVerified: user.isVerified,
    };
  }
}
