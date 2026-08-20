import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '../../common/enums/user-role.enum';
import { normalizePagination } from '../../common/utils/pagination.util';
import { hasPrismaErrorCode } from '../../database/prisma-error.util';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type User } from '../../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateReviewDto, ListReviewsQueryDto, UpdateReviewDto } from './reviews.dto';
import { recalculateRoleRating } from './review-rating.util';
import type { ReviewListView, ReviewPersonView, ReviewView } from './reviews.types';

const REVIEW_INCLUDE = {
  reviewer: {
    select: { id: true, firstName: true, lastName: true, profilePicture: true },
  },
  reviewee: {
    select: { id: true, firstName: true, lastName: true, profilePicture: true },
  },
} satisfies Prisma.ReviewInclude;

type ReviewRow = Prisma.ReviewGetPayload<{ include: typeof REVIEW_INCLUDE }>;

type MarketplaceUser = Pick<User, 'id' | 'role'>;

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(
    userId: number,
    role: UserRole.Customer | UserRole.Tasker,
    query: ListReviewsQueryDto,
  ): Promise<ReviewListView> {
    const view = query.view ?? 'received';
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 20);
    const where: Prisma.ReviewWhereInput = {
      moderationStatus: 'visible',
      ...(view === 'received'
        ? { revieweeId: userId, revieweeRole: role }
        : { reviewerId: userId, reviewerRole: role }),
      ...(query.rating ? { rating: query.rating } : {}),
    };
    const [rows, totalItems, aggregate] = await Promise.all([
      this.prisma.review.findMany({
        where,
        include: REVIEW_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.review.count({ where }),
      this.prisma.review.aggregate({ where, _avg: { rating: true } }),
    ]);
    return {
      view,
      averageRating: Number(aggregate._avg.rating ?? 0),
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      items: rows.map((row) => this.serialize(row, userId, role)),
    };
  }

  async create(user: MarketplaceUser, bookingId: number, dto: CreateReviewDto): Promise<ReviewView> {
    const role = this.marketplaceRole(user.role);
    const booking = await this.prisma.booking.findFirst({
      where: {
        id: bookingId,
        status: 'completed',
        ...(role === UserRole.Customer ? { customerId: user.id } : { taskerId: user.id }),
      },
      select: { id: true, customerId: true, taskerId: true },
    });
    if (!booking) {
      throw new NotFoundException('Completed booking not found or not available to the active role');
    }
    const revieweeId = role === UserRole.Customer ? booking.taskerId : booking.customerId;
    const revieweeRole = role === UserRole.Customer ? UserRole.Tasker : UserRole.Customer;
    try {
      const created = await this.prisma.$transaction(async (transaction) => {
        const review = await transaction.review.create({
          data: {
            bookingId,
            reviewerId: user.id,
            reviewerRole: role,
            revieweeId,
            revieweeRole,
            rating: dto.rating,
            comment: dto.comment?.trim() || null,
          },
          include: REVIEW_INCLUDE,
        });
        await recalculateRoleRating(transaction, revieweeId, revieweeRole);
        await this.notifications.create(
          revieweeId,
          {
            category: 'system',
            type: 'review_received',
            title: 'New review received',
            body: `You received a ${dto.rating}-star review as a ${revieweeRole}.`,
            entityType: 'review',
            entityId: review.id,
            metadata: {
              bookingId: String(bookingId),
              rating: dto.rating,
              recipientRole: revieweeRole,
            },
          },
          transaction,
        );
        return review;
      });
      return this.serialize(created, user.id, role);
    } catch (error) {
      if (hasPrismaErrorCode(error, 'P2002')) {
        throw new ConflictException('You have already reviewed this booking');
      }
      throw error;
    }
  }

  async update(user: MarketplaceUser, reviewId: string, dto: UpdateReviewDto): Promise<ReviewView> {
    const role = this.marketplaceRole(user.role);
    const existing = await this.prisma.review.findFirst({
      where: { id: reviewId, reviewerId: user.id, reviewerRole: role },
    });
    if (!existing) throw new NotFoundException('Review not found');

    const updated = await this.prisma.$transaction(async (transaction) => {
      const review = await transaction.review.update({
        where: { id: reviewId },
        data: { rating: dto.rating, comment: dto.comment?.trim() || null },
        include: REVIEW_INCLUDE,
      });
      await recalculateRoleRating(
        transaction,
        existing.revieweeId,
        existing.revieweeRole as UserRole.Customer | UserRole.Tasker,
      );
      return review;
    });
    return this.serialize(updated, user.id, role);
  }

  async delete(user: MarketplaceUser, reviewId: string): Promise<{ deleted: true; id: string }> {
    const role = this.marketplaceRole(user.role);
    const existing = await this.prisma.review.findFirst({
      where: { id: reviewId, reviewerId: user.id, reviewerRole: role },
    });
    if (!existing) throw new NotFoundException('Review not found');

    await this.prisma.$transaction(async (transaction) => {
      await transaction.review.delete({ where: { id: reviewId } });
      await recalculateRoleRating(
        transaction,
        existing.revieweeId,
        existing.revieweeRole as UserRole.Customer | UserRole.Tasker,
      );
    });
    return { deleted: true, id: reviewId };
  }

  async averageReceived(
    userId: number,
    role: UserRole.Customer | UserRole.Tasker,
  ): Promise<number> {
    const result = await this.prisma.review.aggregate({
      where: { revieweeId: userId, revieweeRole: role, moderationStatus: 'visible' },
      _avg: { rating: true },
    });
    return Number(result._avg.rating ?? 0);
  }

  async averageGiven(userId: number, role: UserRole.Customer | UserRole.Tasker): Promise<number> {
    const result = await this.prisma.review.aggregate({
      where: { reviewerId: userId, reviewerRole: role, moderationStatus: 'visible' },
      _avg: { rating: true },
    });
    return Number(result._avg.rating ?? 0);
  }

  private serialize(
    review: ReviewRow,
    viewerId: number,
    viewerRole: UserRole.Customer | UserRole.Tasker,
  ): ReviewView {
    return {
      id: review.id,
      bookingId: String(review.bookingId),
      rating: review.rating,
      comment: review.comment ?? '',
      author: this.person(review.reviewer, review.reviewerRole),
      recipient: this.person(review.reviewee, review.revieweeRole),
      canEdit: review.reviewerId === viewerId && review.reviewerRole === viewerRole,
      canDelete: review.reviewerId === viewerId && review.reviewerRole === viewerRole,
      createdAt: review.createdAt.toISOString(),
      updatedAt: review.updatedAt.toISOString(),
    };
  }

  private person(
    user: { id: number; firstName: string | null; lastName: string | null; profilePicture: string | null },
    role: string,
  ): ReviewPersonView {
    return {
      id: String(user.id),
      name: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(),
      avatar: user.profilePicture ?? '',
      role,
    };
  }

  private marketplaceRole(role: string): UserRole.Customer | UserRole.Tasker {
    if (role === UserRole.Customer || role === UserRole.Tasker) return role;
    throw new NotFoundException('Marketplace review context is unavailable');
  }
}
