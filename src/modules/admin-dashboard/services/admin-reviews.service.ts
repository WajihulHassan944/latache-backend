import { Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '../../../common/enums/user-role.enum';
import { normalizePagination } from '../../../common/utils/pagination.util';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma, type User } from '../../../generated/prisma/client';
import { recalculateRoleRating } from '../../reviews/review-rating.util';
import { AdminAuditService } from '../../admin-audit/admin-audit.service';
import { AdminReviewModerationDto, AdminReviewsQueryDto } from '../dto/admin-reviews.dto';

const REVIEW_INCLUDE = {
  booking: {
    select: { id: true, status: true, service: { select: { id: true, name: true, slug: true } } },
  },
  reviewer: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      profilePicture: true,
    },
  },
  reviewee: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      profilePicture: true,
    },
  },
  moderatedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
} as const;

type AdminReviewRow = Prisma.ReviewGetPayload<{ include: typeof REVIEW_INCLUDE }>;

@Injectable()
export class AdminReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  async list(query: AdminReviewsQueryDto) {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    const search = query.search?.trim();
    const where: Prisma.ReviewWhereInput = {
      ...(query.status && query.status !== 'all' ? { moderationStatus: query.status } : {}),
      ...(query.reviewerId ? { reviewerId: query.reviewerId } : {}),
      ...(query.revieweeId ? { revieweeId: query.revieweeId } : {}),
      ...(query.rating ? { rating: query.rating } : {}),
      ...(search
        ? {
            OR: [
              { comment: { contains: search, mode: 'insensitive' } },
              { reviewer: { email: { contains: search, mode: 'insensitive' } } },
              { reviewee: { email: { contains: search, mode: 'insensitive' } } },
              { reviewer: { firstName: { contains: search, mode: 'insensitive' } } },
              { reviewee: { firstName: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, totalItems, visible, hidden] = await Promise.all([
      this.prisma.review.findMany({
        where,
        include: REVIEW_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.review.count({ where }),
      this.prisma.review.count({ where: { moderationStatus: 'visible' } }),
      this.prisma.review.count({ where: { moderationStatus: 'hidden' } }),
    ]);
    return {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      summary: { visible, hidden, total: visible + hidden },
      items: rows.map((row) => this.view(row)),
    };
  }

  async moderate(actor: User, reviewId: string, dto: AdminReviewModerationDto) {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Reviews" WHERE "id" = ${reviewId} FOR UPDATE`;
      const review = await transaction.review.findUnique({ where: { id: reviewId } });
      if (!review) throw new NotFoundException('Review not found');

      const status = dto.action === 'hide' ? 'hidden' : 'visible';
      const updated = await transaction.review.update({
        where: { id: reviewId },
        data: {
          moderationStatus: status,
          moderationReason: dto.action === 'hide' ? dto.reason?.trim() || null : null,
          moderatedAt: new Date(),
          moderatedById: actor.id,
        },
        include: REVIEW_INCLUDE,
      });
      await recalculateRoleRating(
        transaction,
        review.revieweeId,
        review.revieweeRole as UserRole.Customer | UserRole.Tasker,
      );
      await this.audit.record(
        {
          actorId: actor.id,
          targetUserId: review.revieweeId,
          action: dto.action === 'hide' ? 'review_hidden' : 'review_restored',
          entityType: 'review',
          entityId: reviewId,
          reason: dto.reason,
          metadata: {
            reviewerId: review.reviewerId,
            revieweeId: review.revieweeId,
            rating: review.rating,
          },
        },
        transaction,
      );
      return this.view(updated);
    });
  }

  private view(row: AdminReviewRow) {
    const person = (user: AdminReviewRow['reviewer'], role: string) => ({
      id: String(user.id),
      name: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(),
      email: user.email,
      role,
      avatar: user.profilePicture ?? '',
    });
    return {
      id: row.id,
      booking: {
        id: String(row.booking.id),
        status: row.booking.status,
        service: {
          id: String(row.booking.service.id),
          name: row.booking.service.name,
          slug: row.booking.service.slug,
        },
      },
      reviewer: person(row.reviewer, row.reviewerRole),
      reviewee: person(row.reviewee, row.revieweeRole),
      rating: row.rating,
      comment: row.comment ?? '',
      moderation: {
        status: row.moderationStatus,
        reason: row.moderationReason,
        moderatedAt: row.moderatedAt?.toISOString() ?? null,
        moderatedBy: row.moderatedBy
          ? {
              id: String(row.moderatedBy.id),
              name: `${row.moderatedBy.firstName ?? ''} ${row.moderatedBy.lastName ?? ''}`.trim(),
              email: row.moderatedBy.email,
            }
          : null,
      },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
