import { UserRole } from '../../common/enums/user-role.enum';
import type { Prisma } from '../../generated/prisma/client';

export async function recalculateRoleRating(
  transaction: Prisma.TransactionClient,
  userId: number,
  role: UserRole.Customer | UserRole.Tasker,
): Promise<void> {
  const aggregate = await transaction.review.aggregate({
    where: { revieweeId: userId, revieweeRole: role, moderationStatus: 'visible' },
    _avg: { rating: true },
    _count: { _all: true },
  });
  const rating = Number(aggregate._avg.rating ?? 0).toFixed(1);
  const reviewsCount = aggregate._count._all;

  if (role === UserRole.Tasker) {
    await transaction.taskerProfile.update({
      where: { userId },
      data: { rating, reviewsCount },
    });
  } else {
    await transaction.customerProfile.update({
      where: { userId },
      data: { rating, reviewsCount },
    });
  }

  // User.rating/reviewsCount remain a backwards-compatible summary for older
  // Tasker discovery/Elite consumers. For a dual-role identity, Tasker rating
  // is authoritative there; Customer rating remains on CustomerProfile.
  const user = await transaction.user.findUnique({
    where: { id: userId },
    select: { roles: true },
  });
  if (!user) return;
  const legacyRole = user.roles.includes(UserRole.Tasker) ? UserRole.Tasker : UserRole.Customer;
  const profile =
    legacyRole === UserRole.Tasker
      ? await transaction.taskerProfile.findUnique({
          where: { userId },
          select: { rating: true, reviewsCount: true },
        })
      : await transaction.customerProfile.findUnique({
          where: { userId },
          select: { rating: true, reviewsCount: true },
        });
  if (!profile) return;
  await transaction.user.update({
    where: { id: userId },
    data: { rating: profile.rating, reviewsCount: profile.reviewsCount },
  });
}
