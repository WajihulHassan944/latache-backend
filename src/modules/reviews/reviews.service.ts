import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { normalizePagination } from '../../common/utils/pagination.util';
import { hasPrismaErrorCode } from '../../database/prisma-error.util';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { CreateReviewDto, ListReviewsQueryDto, UpdateReviewDto } from './reviews.dto';
import type { ReviewListView, ReviewPersonView, ReviewView } from './reviews.types';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: number, query: ListReviewsQueryDto): Promise<ReviewListView> {
    const view = query.view ?? 'received';
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 20);
    const where: Prisma.ReviewWhereInput = {
      ...(view === 'received' ? { revieweeId: userId } : { reviewerId: userId }),
      ...(query.rating ? { rating: query.rating } : {}),
    };
    const [rows, totalItems, aggregate] = await Promise.all([
      this.prisma.review.findMany({
        where,
        include: {
          reviewer: {
            select: { id: true, firstName: true, lastName: true, profilePicture: true, role: true },
          },
          reviewee: {
            select: { id: true, firstName: true, lastName: true, profilePicture: true, role: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.review.count({ where }),
      this.prisma.review.aggregate({
        where: view === 'received' ? { revieweeId: userId } : { reviewerId: userId },
        _avg: { rating: true },
      }),
    ]);
    return {
      view,
      averageRating: Number(aggregate._avg.rating ?? 0),
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      items: rows.map((row) => this.serialize(row, userId)),
    };
  }

  async create(userId: number, bookingId: number, dto: CreateReviewDto): Promise<ReviewView> {
    const booking = await this.prisma.booking.findFirst({
      where: {
        id: bookingId,
        status: 'completed',
        OR: [{ customerId: userId }, { taskerId: userId }],
      },
      select: { id: true, customerId: true, taskerId: true },
    });
    if (!booking) {
      throw new NotFoundException('Completed booking not found or not available to this user');
    }
    const revieweeId = booking.customerId === userId ? booking.taskerId : booking.customerId;
    try {
      const created = await this.prisma.$transaction(async (transaction) => {
        const review = await transaction.review.create({
          data: {
            bookingId,
            reviewerId: userId,
            revieweeId,
            rating: dto.rating,
            comment: dto.comment?.trim() || null,
          },
          include: {
            reviewer: {
              select: { id: true, firstName: true, lastName: true, profilePicture: true, role: true },
            },
            reviewee: {
              select: { id: true, firstName: true, lastName: true, profilePicture: true, role: true },
            },
          },
        });
        await this.recalculateUserRating(revieweeId, transaction);
        return review;
      });
      return this.serialize(created, userId);
    } catch (error) {
      if (hasPrismaErrorCode(error, 'P2002')) {
        throw new ConflictException('You have already reviewed this booking');
      }
      throw error;
    }
  }

  async update(userId: number, reviewId: string, dto: UpdateReviewDto): Promise<ReviewView> {
    const existing = await this.prisma.review.findFirst({
      where: { id: reviewId, reviewerId: userId },
    });
    if (!existing) throw new NotFoundException('Review not found');

    const updated = await this.prisma.$transaction(async (transaction) => {
      const review = await transaction.review.update({
        where: { id: reviewId },
        data: { rating: dto.rating, comment: dto.comment?.trim() || null },
        include: {
          reviewer: {
            select: { id: true, firstName: true, lastName: true, profilePicture: true, role: true },
          },
          reviewee: {
            select: { id: true, firstName: true, lastName: true, profilePicture: true, role: true },
          },
        },
      });
      await this.recalculateUserRating(existing.revieweeId, transaction);
      return review;
    });
    return this.serialize(updated, userId);
  }

  async delete(userId: number, reviewId: string): Promise<{ deleted: true; id: string }> {
    const existing = await this.prisma.review.findFirst({
      where: { id: reviewId, reviewerId: userId },
    });
    if (!existing) throw new NotFoundException('Review not found');

    await this.prisma.$transaction(async (transaction) => {
      await transaction.review.delete({ where: { id: reviewId } });
      await this.recalculateUserRating(existing.revieweeId, transaction);
    });
    return { deleted: true, id: reviewId };
  }

  async averageReceived(userId: number): Promise<number> {
    const result = await this.prisma.review.aggregate({
      where: { revieweeId: userId },
      _avg: { rating: true },
    });
    return Number(result._avg.rating ?? 0);
  }

  async averageGiven(userId: number): Promise<number> {
    const result = await this.prisma.review.aggregate({
      where: { reviewerId: userId },
      _avg: { rating: true },
    });
    return Number(result._avg.rating ?? 0);
  }

  private async recalculateUserRating(
    userId: number,
    transaction: Prisma.TransactionClient,
  ): Promise<void> {
    const aggregate = await transaction.review.aggregate({
      where: { revieweeId: userId },
      _avg: { rating: true },
      _count: { _all: true },
    });
    await transaction.user.update({
      where: { id: userId },
      data: {
        rating: Number(aggregate._avg.rating ?? 0).toFixed(1),
        reviewsCount: aggregate._count._all,
      },
    });
  }

  private serialize(
    review: {
      id: string;
      bookingId: number;
      rating: number;
      comment: string | null;
      reviewerId: number;
      revieweeId: number;
      createdAt: Date;
      updatedAt: Date;
      reviewer: {
        id: number;
        firstName: string | null;
        lastName: string | null;
        profilePicture: string | null;
        role: string;
      };
      reviewee: {
        id: number;
        firstName: string | null;
        lastName: string | null;
        profilePicture: string | null;
        role: string;
      };
    },
    viewerId: number,
  ): ReviewView {
    return {
      id: review.id,
      bookingId: String(review.bookingId),
      rating: review.rating,
      comment: review.comment ?? '',
      author: this.person(review.reviewer),
      recipient: this.person(review.reviewee),
      canEdit: review.reviewerId === viewerId,
      canDelete: review.reviewerId === viewerId,
      createdAt: review.createdAt.toISOString(),
      updatedAt: review.updatedAt.toISOString(),
    };
  }

  private person(user: {
    id: number;
    firstName: string | null;
    lastName: string | null;
    profilePicture: string | null;
    role: string;
  }): ReviewPersonView {
    return {
      id: String(user.id),
      name: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(),
      avatar: user.profilePicture ?? '',
      role: user.role,
    };
  }
}
