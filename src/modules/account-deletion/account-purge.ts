import { Prisma } from '../../generated/prisma/client';
import { UserRole } from '../../common/enums/user-role.enum';

type Tx = Prisma.TransactionClient;
type MarketplaceRole = UserRole.Customer | UserRole.Tasker;

export interface PurgeSummary {
  bookings: number;
  conversations: number;
  paymentTransactions: number;
  disputes: number;
  reviews: number;
  referrals: number;
  referralRewards: number;
  customerLedgerEntries: number;
  taskerLedgerEntries: number;
  platformLedgerEntries: number;
  taskerEarnings: number;
  withdrawals: number;
  /** Other users whose wallet / payable balances were rebalanced because shared ledger rows were removed. */
  counterpartiesRebalanced: number[];
}

export interface PurgeResult {
  summary: PurgeSummary;
  /** Raw JSON/string values holding Cloudinary references, for the caller's storage cleanup. */
  assetSources: unknown[];
}

/**
 * Force-purge everything a marketplace role owns so the account can be hard-deleted.
 *
 * Unlike the safe delete (which refuses on any history), this removes the role's bookings
 * and everything hanging off them: payments, wallet/platform ledgers, earnings, disputes,
 * reviews, conversations, calls, referrals and withdrawals.
 *
 * Bookings are shared with a counterparty (the other Customer/Tasker). When their ledger rows
 * are removed, the deltas those rows applied are reversed on the counterparty's wallet /
 * platform account, so every remaining balance still equals the sum of its remaining ledger.
 *
 * No provider (Stripe) calls are made: authorized-but-uncaptured intents are left to expire.
 * Must run inside the caller's transaction, after the user row is locked.
 */
export async function purgeMarketplaceRoleData(
  tx: Tx,
  userId: number,
  role: MarketplaceRole,
): Promise<PurgeResult> {
  const isCustomer = role === UserRole.Customer;
  const rebalanced = new Set<number>();
  const assetSources: unknown[] = [];

  const bookingWhere: Prisma.BookingWhereInput = isCustomer
    ? { customerId: userId }
    : { taskerId: userId };
  const bookingRows = await tx.booking.findMany({
    where: bookingWhere,
    select: { id: true, attachments: true },
  });
  const bookingIds = bookingRows.map((row) => row.id);
  assetSources.push(...bookingRows.map((row) => row.attachments));

  const conversationRows = await tx.conversation.findMany({
    where: isCustomer ? { customerId: userId } : { taskerId: userId },
    select: { id: true },
  });
  const conversationIds = conversationRows.map((row) => row.id);

  const inBookings = bookingIds.length ? { in: bookingIds } : { in: [-1] };

  // ---- Assets referenced by records that are about to disappear ----
  // Sequential on purpose: one transaction = one connection, which can't run queries in parallel.
  const proofs = await tx.bookingWorkProof.findMany({
    where: { bookingId: inBookings },
    select: { publicId: true, secureUrl: true },
  });
  const evidence = await tx.disputeEvidence.findMany({
    where: { complaint: { bookingId: inBookings } },
    select: { publicId: true, secureUrl: true },
  });
  const messageAttachments = await tx.taskMessage.findMany({
    where: {
      OR: [
        { bookingId: inBookings },
        ...(conversationIds.length ? [{ conversationId: { in: conversationIds } }] : []),
      ],
      attachments: { not: Prisma.DbNull },
    },
    select: { attachments: true },
  });
  assetSources.push(
    proofs,
    evidence,
    messageAttachments.map((row) => row.attachments),
  );

  // ---- Referrals (role program) and rewards tied to these bookings or this role ----
  const roleProgram = isCustomer ? 'customer' : 'tasker';
  const referrals = await tx.referral.findMany({
    where: { program: roleProgram, OR: [{ referrerId: userId }, { referredUserId: userId }] },
    select: { id: true },
  });
  const referralIds = referrals.map((row) => row.id);
  const rewards = await tx.referralReward.findMany({
    where: {
      OR: [
        { bookingId: inBookings },
        { recipientId: userId, recipientRole: role },
        ...(referralIds.length ? [{ referralId: { in: referralIds } }] : []),
      ],
    },
    select: { id: true },
  });
  const rewardIds = rewards.map((row) => row.id);

  // ---- Earnings / receivables on these bookings (or owned by this Tasker) ----
  const earnings = await tx.taskerEarning.findMany({
    where: isCustomer
      ? { bookingId: inBookings }
      : { OR: [{ bookingId: inBookings }, { taskerId: userId }] },
    select: { id: true },
  });
  const earningIds = earnings.map((row) => row.id);
  const receivables = await tx.taskerPlatformReceivable.findMany({
    where: isCustomer
      ? { bookingId: inBookings }
      : { OR: [{ bookingId: inBookings }, { taskerId: userId }] },
    select: { id: true },
  });
  const receivableIds = receivables.map((row) => row.id);

  // ---- Ledgers (reverse deltas on whoever's balance they moved) ----
  const customerLedgerWhere: Prisma.CustomerWalletLedgerEntryWhereInput = {
    OR: [
      { bookingId: inBookings },
      ...(rewardIds.length ? [{ referralRewardId: { in: rewardIds } }] : []),
      ...(isCustomer ? [{ customerId: userId }] : []),
    ],
  };
  const taskerLedgerWhere: Prisma.TaskerWalletLedgerEntryWhereInput = {
    OR: [
      { bookingId: inBookings },
      ...(earningIds.length ? [{ earningId: { in: earningIds } }] : []),
      ...(rewardIds.length ? [{ referralRewardId: { in: rewardIds } }] : []),
      ...(isCustomer ? [] : [{ taskerId: userId }]),
    ],
  };
  const platformLedgerWhere: Prisma.TaskerPlatformLedgerEntryWhereInput = {
    OR: [
      { bookingId: inBookings },
      ...(earningIds.length ? [{ earningId: { in: earningIds } }] : []),
      ...(receivableIds.length ? [{ receivableId: { in: receivableIds } }] : []),
      ...(isCustomer ? [] : [{ taskerId: userId }]),
    ],
  };

  const customerDeltas = await tx.customerWalletLedgerEntry.groupBy({
    by: ['customerId'],
    where: customerLedgerWhere,
    _sum: { balanceDelta: true },
  });
  for (const row of customerDeltas) {
    const delta = row._sum.balanceDelta ?? new Prisma.Decimal(0);
    if (!delta.isZero()) {
      await tx.customerWallet.updateMany({
        where: { customerId: row.customerId },
        data: { availableBalance: { decrement: delta } },
      });
      if (row.customerId !== userId) rebalanced.add(row.customerId);
    }
  }
  const customerLedgerDeleted = await tx.customerWalletLedgerEntry.deleteMany({
    where: customerLedgerWhere,
  });

  const taskerDeltas = await tx.taskerWalletLedgerEntry.groupBy({
    by: ['taskerId'],
    where: taskerLedgerWhere,
    _sum: { availableDelta: true, pendingDelta: true },
  });
  for (const row of taskerDeltas) {
    const available = row._sum.availableDelta ?? new Prisma.Decimal(0);
    const pending = row._sum.pendingDelta ?? new Prisma.Decimal(0);
    if (!available.isZero() || !pending.isZero()) {
      await tx.taskerWallet.updateMany({
        where: { taskerId: row.taskerId },
        data: {
          availableBalance: { decrement: available },
          pendingBalance: { decrement: pending },
        },
      });
      if (row.taskerId !== userId) rebalanced.add(row.taskerId);
    }
  }
  const taskerLedgerDeleted = await tx.taskerWalletLedgerEntry.deleteMany({
    where: taskerLedgerWhere,
  });

  const platformDeltas = await tx.taskerPlatformLedgerEntry.groupBy({
    by: ['taskerId'],
    where: platformLedgerWhere,
    _sum: { payableDelta: true },
  });
  for (const row of platformDeltas) {
    const delta = row._sum.payableDelta ?? new Prisma.Decimal(0);
    if (!delta.isZero()) {
      await tx.taskerPlatformAccount.updateMany({
        where: { taskerId: row.taskerId },
        data: { outstandingPayable: { decrement: delta } },
      });
      if (row.taskerId !== userId) rebalanced.add(row.taskerId);
    }
  }
  const platformLedgerDeleted = await tx.taskerPlatformLedgerEntry.deleteMany({
    where: platformLedgerWhere,
  });

  // ---- Rows that the ledgers referenced ----
  const rewardsDeleted = rewardIds.length
    ? await tx.referralReward.deleteMany({ where: { id: { in: rewardIds } } })
    : { count: 0 };
  // Referrals belonging to someone else that merely qualified via one of these bookings stay,
  // they just lose the (now deleted) booking pointer.
  await tx.referral.updateMany({
    where: { qualifyingBookingId: inBookings, id: { notIn: referralIds } },
    data: { qualifyingBookingId: null },
  });
  const referralsDeleted = referralIds.length
    ? await tx.referral.deleteMany({ where: { id: { in: referralIds } } })
    : { count: 0 };

  if (receivableIds.length) {
    await tx.taskerPlatformReceivable.deleteMany({ where: { id: { in: receivableIds } } });
  }
  const earningsDeleted = earningIds.length
    ? await tx.taskerEarning.deleteMany({ where: { id: { in: earningIds } } })
    : { count: 0 };

  // ---- Booking-scoped records with RESTRICT foreign keys ----
  const paymentsDeleted = await tx.paymentTransaction.deleteMany({
    where: isCustomer
      ? { OR: [{ bookingId: inBookings }, { customerId: userId }] }
      : { bookingId: inBookings },
  });
  await tx.disputeCashRefund.deleteMany({ where: { complaint: { bookingId: inBookings } } });
  const disputesDeleted = await tx.taskComplaint.deleteMany({ where: { bookingId: inBookings } });
  await tx.stripeChargeback.deleteMany({ where: { bookingId: inBookings } });
  await tx.bookingWorkProof.deleteMany({ where: { bookingId: inBookings } });
  const reviewsDeleted = await tx.review.deleteMany({ where: { bookingId: inBookings } });
  await tx.conversationCall.deleteMany({ where: { bookingId: inBookings } });

  // Messages have RESTRICT on senderId; removing the conversations cascades them.
  const bookingsDeleted = await tx.booking.deleteMany({ where: { id: inBookings } });
  const conversationsDeleted = conversationIds.length
    ? await tx.conversation.deleteMany({ where: { id: { in: conversationIds } } })
    : { count: 0 };

  // ---- Role-owned money/profile rows not tied to a booking ----
  let withdrawals = 0;
  if (isCustomer) {
    withdrawals = (await tx.customerWithdrawal.deleteMany({ where: { customerId: userId } })).count;
    await tx.customerWallet.deleteMany({ where: { customerId: userId } });
    await tx.favoriteTasker.deleteMany({ where: { customerId: userId } });
    await tx.customerAddress.deleteMany({ where: { customerId: userId } });
    await tx.customTimeRequest.deleteMany({ where: { customerId: userId } });
  } else {
    withdrawals = (await tx.taskerWithdrawal.deleteMany({ where: { taskerId: userId } })).count;
    await tx.taskerPayoutMethod.deleteMany({ where: { taskerId: userId } });
    await tx.taskerPlatformSettlement.deleteMany({ where: { taskerId: userId } });
    await tx.taskerPlatformAccount.deleteMany({ where: { taskerId: userId } });
    await tx.taskerWallet.deleteMany({ where: { taskerId: userId } });
    await tx.taskerSubscription.deleteMany({ where: { taskerId: userId } });
    await tx.customTimeRequest.deleteMany({ where: { taskerId: userId } });
    await tx.favoriteTasker.deleteMany({ where: { taskerId: userId } });
    await tx.eliteTaskerBadge.deleteMany({ where: { taskerId: userId } });
    await tx.eliteEvaluation.deleteMany({ where: { taskerId: userId } });
    await tx.eliteTierTransition.deleteMany({ where: { taskerId: userId } });
    await tx.eliteMembershipRequest.deleteMany({ where: { taskerId: userId } });
  }
  // Discipline history about this person (complaint links were already nulled/removed).
  await tx.disciplinaryAction.deleteMany({ where: { userId } });

  return {
    summary: {
      bookings: bookingsDeleted.count,
      conversations: conversationsDeleted.count,
      paymentTransactions: paymentsDeleted.count,
      disputes: disputesDeleted.count,
      reviews: reviewsDeleted.count,
      referrals: referralsDeleted.count,
      referralRewards: rewardsDeleted.count,
      customerLedgerEntries: customerLedgerDeleted.count,
      taskerLedgerEntries: taskerLedgerDeleted.count,
      platformLedgerEntries: platformLedgerDeleted.count,
      taskerEarnings: earningsDeleted.count,
      withdrawals,
      counterpartiesRebalanced: [...rebalanced].sort((a, b) => a - b),
    },
    assetSources,
  };
}
