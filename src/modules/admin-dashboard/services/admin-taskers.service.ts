import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type User } from '../../../generated/prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AccountStatus } from '../../../common/enums/account-status.enum';
import { UserRole } from '../../../common/enums/user-role.enum';
import { AdminAuditService } from '../../admin-audit/admin-audit.service';
import { AuthSessionsRepository } from '../../auth/repositories/auth-sessions.repository';
import { NotificationsService } from '../../notifications/notifications.service';
import type {
  AdminUserModerationDto,
  ListAdminTaskersDto,
  TaskerVerificationActionDto,
} from '../dto';
import { fullName, money, pagination } from '../admin-dashboard.utils';
import { AccountDeletionService } from '../../account-deletion/account-deletion.service';

@Injectable()
export class AdminTaskersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AuthSessionsRepository,
    private readonly notifications: NotificationsService,
    private readonly audit: AdminAuditService,
    private readonly accountDeletion: AccountDeletionService,
  ) {}

  permanentlyDelete(actor: User, taskerId: number, reason: string) {
    return this.accountDeletion.permanentlyDelete(actor, taskerId, UserRole.Tasker, reason);
  }

  async list(query: ListAdminTaskersDto) {
    return this.listInternal(query, false);
  }

  async pendingVerification(query: ListAdminTaskersDto) {
    return this.listInternal(query, true);
  }

  private async listInternal(query: ListAdminTaskersDto, pendingOnly: boolean) {
    const { page, limit, skip } = pagination(query.page, query.limit);
    const search = query.search?.trim();
    const where: Prisma.UserWhereInput = {
      roles: { has: UserRole.Tasker },
      deletedAt: null,
      ...(pendingOnly
        ? {
            taskerProfile: { is: { status: 'pending_approval' } },
            onboardingStatus: query.onboardingStatus
              ? query.onboardingStatus
              : { in: ['submitted', 'pending_review'] },
          }
        : {
            ...(query.status ? { taskerProfile: { is: { status: query.status } } } : { taskerProfile: { isNot: null } }),
            ...(query.onboardingStatus ? { onboardingStatus: query.onboardingStatus } : {}),
          }),
      ...(query.isElite === undefined ? {} : { isElite: query.isElite }),
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { phoneNumber: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const orderBy: Prisma.UserOrderByWithRelationInput[] =
      query.sort === 'oldest'
        ? [{ createdAt: 'asc' }]
        : query.sort === 'rating_desc'
          ? [{ rating: 'desc' }, { createdAt: 'desc' }]
          : query.sort === 'completed_desc'
            ? [{ completedTasks: 'desc' }, { createdAt: 'desc' }]
            : [{ createdAt: 'desc' }];

    const [taskers, totalItems] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phoneCountryCode: true,
          phoneNumber: true,
          profilePicture: true,
          accountStatus: true,
          onboardingStatus: true,
          taskerProfile: { select: { status: true, rating: true, reviewsCount: true } },
          isVerified: true,
          isDocVerified: true,
          isElite: true,
          rating: true,
          reviewsCount: true,
          completedTasks: true,
          yearsOfExperience: true,
          serviceAreaCity: true,
          serviceAreaArea: true,
          submittedAt: true,
          createdAt: true,
          _count: { select: { userServices: true, bookingsAsTasker: true } },
        },
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    const ids = taskers.map((tasker) => tasker.id);
    const earningRows = ids.length
      ? await this.prisma.taskerWalletLedgerEntry.groupBy({
          by: ['taskerId'],
          where: { taskerId: { in: ids }, kind: 'earning', status: 'settled' },
          _sum: { amount: true },
        })
      : [];
    const earnings = new Map(earningRows.map((row) => [row.taskerId, money(row._sum.amount)]));

    return {
      items: taskers.map((tasker) => ({
        id: String(tasker.id),
        taskerId: `TSK-${String(tasker.id).padStart(5, '0')}`,
        name: fullName(tasker.firstName, tasker.lastName),
        email: tasker.email,
        phone: `${tasker.phoneCountryCode ?? ''}${tasker.phoneNumber ?? ''}`,
        profilePicture: tasker.profilePicture ?? '',
        accountStatus: tasker.taskerProfile?.status ?? tasker.accountStatus,
        onboardingStatus: tasker.onboardingStatus,
        isVerified: tasker.isVerified,
        isDocVerified: tasker.isDocVerified,
        isElite: tasker.isElite,
        rating: Number(tasker.taskerProfile?.rating ?? tasker.rating),
        reviewsCount: tasker.taskerProfile?.reviewsCount ?? tasker.reviewsCount,
        completedTasks: tasker.completedTasks,
        bookingsCount: tasker._count.bookingsAsTasker,
        serviceCount: tasker._count.userServices,
        totalSettledEarnings: earnings.get(tasker.id) ?? 0,
        yearsOfExperience: tasker.yearsOfExperience,
        location: [tasker.serviceAreaArea, tasker.serviceAreaCity].filter(Boolean).join(', '),
        submittedAt: tasker.submittedAt?.toISOString() ?? null,
        joinedAt: tasker.createdAt.toISOString(),
      })),
      pagination: { page, limit, totalItems, totalPages: Math.ceil(totalItems / limit) },
    };
  }

  async details(taskerId: number) {
    const tasker = await this.prisma.user.findFirst({
      where: { id: taskerId, roles: { has: UserRole.Tasker }, deletedAt: null },
      include: {
        taskerProfile: true,
        userServices: { include: { service: true }, orderBy: { createdAt: 'asc' } },
        availability: { orderBy: [{ date: 'asc' }, { startTime: 'asc' }], take: 100 },
      },
    });
    if (!tasker) throw new NotFoundException('Tasker not found');

    const [earnings, payouts, bookingStatus, complaints, auditRows] = await Promise.all([
      this.prisma.taskerWalletLedgerEntry.aggregate({
        where: { taskerId, kind: 'earning', status: 'settled' },
        _sum: { amount: true },
      }),
      this.prisma.taskerWithdrawal.aggregate({
        where: { taskerId, status: 'paid' },
        _sum: { amount: true },
      }),
      this.prisma.booking.groupBy({ by: ['status'], where: { taskerId }, _count: { _all: true } }),
      this.prisma.taskComplaint.count({
        where: { booking: { taskerId }, status: { notIn: ['resolved', 'closed'] } },
      }),
      this.prisma.adminAuditLog.findMany({
        where: { targetUserId: taskerId },
        include: { actor: { select: { id: true, firstName: true, lastName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    return {
      tasker: {
        id: String(tasker.id),
        taskerId: `TSK-${String(tasker.id).padStart(5, '0')}`,
        firstName: tasker.firstName ?? '',
        lastName: tasker.lastName ?? '',
        name: fullName(tasker.firstName, tasker.lastName),
        email: tasker.email,
        phoneCountryCode: tasker.phoneCountryCode ?? '',
        phoneNumber: tasker.phoneNumber ?? '',
        profilePicture: tasker.profilePicture ?? '',
        bio: tasker.bio ?? '',
        accountStatus: tasker.taskerProfile?.status ?? tasker.accountStatus,
        onboardingStatus: tasker.onboardingStatus,
        isVerified: tasker.isVerified,
        isDocVerified: tasker.isDocVerified,
        isElite: tasker.isElite,
        rating: Number(tasker.taskerProfile?.rating ?? tasker.rating),
        reviewsCount: tasker.taskerProfile?.reviewsCount ?? tasker.reviewsCount,
        completedTasks: tasker.completedTasks,
        yearsOfExperience: tasker.yearsOfExperience,
        submittedAt: tasker.submittedAt?.toISOString() ?? null,
        joinedAt: tasker.createdAt.toISOString(),
      },
      identity: {
        idType: tasker.idType,
        document: tasker.identityDocument,
        providerChecks: {
          backgroundCheck: null,
          insuranceVerification: null,
        },
        providerChecksReason:
          'No background-check or insurance-verification provider is integrated, so these values are intentionally null.',
      },
      serviceArea: {
        label: tasker.serviceAreaLabel,
        lat: tasker.serviceAreaLat === null ? null : Number(tasker.serviceAreaLat),
        lng: tasker.serviceAreaLng === null ? null : Number(tasker.serviceAreaLng),
        radiusKm: tasker.serviceAreaRadiusKm === null ? null : Number(tasker.serviceAreaRadiusKm),
        city: tasker.serviceAreaCity,
        area: tasker.serviceAreaArea,
      },
      services: tasker.userServices.map((item) => ({
        id: String(item.service.id),
        name: item.service.name ?? '',
        slug: item.service.slug ?? '',
        hourlyRate: money(item.hourlyRate),
      })),
      availability: tasker.availability.map((slot) => ({
        id: String(slot.id),
        date: slot.date.toISOString().slice(0, 10),
        startTime: slot.startTime,
        endTime: slot.endTime,
        isBooked: slot.isBooked,
      })),
      verificationChecks: this.verificationChecks(
        tasker,
        tasker.userServices.length,
        tasker.availability.length,
      ),
      metrics: {
        totalSettledEarnings: money(earnings._sum.amount),
        totalPaidWithdrawals: money(payouts._sum.amount),
        activeDisputes: complaints,
        bookingsByStatus: bookingStatus.map((row) => ({
          status: row.status,
          count: row._count._all,
        })),
      },
      moderationHistory: auditRows.map((row) => ({
        id: row.id,
        action: row.action,
        reason: row.reason,
        metadata: row.metadata,
        actor: row.actor
          ? {
              id: String(row.actor.id),
              name: fullName(row.actor.firstName, row.actor.lastName),
              email: row.actor.email,
            }
          : null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async verify(actor: User, taskerId: number, dto: TaskerVerificationActionDto) {
    const tasker = await this.prisma.user.findFirst({
      where: { id: taskerId, roles: { has: UserRole.Tasker }, deletedAt: null },
      include: {
        taskerProfile: true,
        _count: { select: { userServices: true, availability: true } },
      },
    });
    if (!tasker) throw new NotFoundException('Tasker not found');

    const isAwaitingVerification =
      tasker.taskerProfile?.status === 'pending_approval' &&
      ['submitted', 'pending_review'].includes(tasker.onboardingStatus ?? '');
    if (!isAwaitingVerification) {
      throw new ConflictException('Tasker is not currently awaiting administrator verification');
    }

    if (dto.action === 'approve') {
      const checks = this.verificationChecks(
        tasker,
        tasker._count.userServices,
        tasker._count.availability,
      );
      const blocking = Object.entries(checks)
        .filter(([, value]) => value === false)
        .map(([key]) => key);
      if (blocking.length > 0) {
        throw new ConflictException(
          `Tasker cannot be approved until these checks pass: ${blocking.join(', ')}`,
        );
      }
    } else if (!dto.reasonCode || !dto.reason?.trim()) {
      throw new BadRequestException('reasonCode and reason are required when rejecting a tasker');
    }

    const result = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.user.update({
        where: { id: taskerId },
        data:
          dto.action === 'approve'
            ? { onboardingStatus: 'approved', isDocVerified: true }
            : { onboardingStatus: 'rejected', isDocVerified: false },
      });
      const profile = await transaction.taskerProfile.update({
        where: { userId: taskerId },
        data:
          dto.action === 'approve'
            ? { status: 'active', approvedAt: new Date(), rejectedAt: null, statusReason: null }
            : { status: 'rejected', rejectedAt: new Date(), approvedAt: null, statusReason: dto.reason?.trim() ?? dto.reasonCode ?? 'rejected' },
      });

      if (dto.action === 'reject') {
        await this.sessions.revokeRole(taskerId, UserRole.Tasker, transaction);
      }
      await this.audit.record(
        {
          actorId: actor.id,
          targetUserId: taskerId,
          action: dto.action === 'approve' ? 'tasker_approved' : 'tasker_rejected',
          entityType: 'tasker',
          entityId: taskerId,
          reason: dto.reason,
          metadata: {
            reasonCode: dto.reasonCode ?? null,
            previousAccountStatus: tasker.taskerProfile?.status ?? tasker.accountStatus,
            previousOnboardingStatus: tasker.onboardingStatus,
            nextAccountStatus: profile.status,
            nextOnboardingStatus: updated.onboardingStatus,
          },
        },
        transaction,
      );
      await this.notifications.create(
        taskerId,
        {
          category: 'system',
          type:
            dto.action === 'approve'
              ? 'tasker_application_approved'
              : 'tasker_application_rejected',
          title:
            dto.action === 'approve'
              ? 'Tasker application approved'
              : 'Tasker application rejected',
          body:
            dto.action === 'approve'
              ? 'Your Latache tasker profile has been approved and is now active.'
              : (dto.reason?.trim() ?? 'Your Latache tasker application was not approved.'),
          entityType: 'tasker',
          entityId: String(taskerId),
        },
        transaction,
      );
      return { updated, profile };
    });

    return {
      id: String(result.updated.id),
      accountStatus: result.profile.status,
      onboardingStatus: result.updated.onboardingStatus,
      isDocVerified: result.updated.isDocVerified,
      action: dto.action,
    };
  }

  async moderate(actor: User, taskerId: number, dto: AdminUserModerationDto) {
    const tasker = await this.requireTasker(taskerId);
    if (dto.action !== 'reactivate' && !dto.reason?.trim()) {
      throw new BadRequestException('A reason is required when suspending or banning a tasker');
    }
    if (dto.action === 'suspend' && tasker.taskerProfile?.status === 'deactivated') {
      throw new ConflictException('A deactivated/banned tasker cannot be suspended');
    }
    if (dto.action === 'suspend' && tasker.taskerProfile?.status === 'suspended') {
      throw new ConflictException('Tasker is already suspended');
    }
    if (dto.action === 'ban' && tasker.taskerProfile?.status === 'deactivated') {
      throw new ConflictException('Tasker is already deactivated/banned');
    }
    if (dto.action === 'reactivate' && tasker.taskerProfile?.status === 'active') {
      throw new ConflictException('Tasker is already active');
    }
    if (
      dto.action === 'reactivate' &&
      tasker.taskerProfile?.status === 'deactivated' &&
      actor.role !== UserRole.SuperAdmin
    ) {
      throw new ForbiddenException(
        'Only the super administrator may reactivate a deactivated/banned tasker',
      );
    }
    if (dto.action === 'reactivate' && tasker.onboardingStatus !== 'approved') {
      throw new ConflictException(
        'Only an approved tasker can be reactivated; resolve verification first',
      );
    }

    const nextStatus =
      dto.action === 'suspend' ? 'suspended' : dto.action === 'ban' ? 'deactivated' : 'active';

    const updated = await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.taskerProfile.update({
        where: { userId: taskerId },
        data: {
          status: nextStatus,
          suspendedAt: nextStatus === 'suspended' ? new Date() : null,
          deactivatedAt: nextStatus === 'deactivated' ? new Date() : null,
          statusReason: nextStatus === 'active' ? null : dto.reason?.trim() ?? null,
        },
      });
      if (dto.action !== 'reactivate') {
        await this.sessions.revokeRole(taskerId, UserRole.Tasker, transaction);
      }
      await this.audit.record(
        {
          actorId: actor.id,
          targetUserId: taskerId,
          action: `tasker_${dto.action === 'ban' ? 'banned' : dto.action === 'suspend' ? 'suspended' : 'reactivated'}`,
          entityType: 'tasker',
          entityId: taskerId,
          reason: dto.reason,
          metadata: { previousStatus: tasker.taskerProfile?.status ?? tasker.accountStatus, nextStatus },
        },
        transaction,
      );
      await this.notifications.create(
        taskerId,
        {
          category: 'system',
          type: `account_${nextStatus}`,
          title:
            dto.action === 'reactivate'
              ? 'Tasker account reactivated'
              : dto.action === 'suspend'
                ? 'Tasker account suspended'
                : 'Tasker account deactivated',
          body: dto.reason?.trim() || 'Your tasker account status was updated by an administrator.',
          entityType: 'tasker',
          entityId: String(taskerId),
        },
        transaction,
      );
      return changed;
    });

    return {
      id: String(taskerId),
      accountStatus: updated.status,
      onboardingStatus: tasker.onboardingStatus,
      action: dto.action,
      sessionsRevoked: dto.action !== 'reactivate',
    };
  }

  private verificationChecks(
    tasker: {
      isVerified: boolean;
      identityDocument: unknown;
      idType: string | null;
      serviceAreaLat: Prisma.Decimal | null;
      serviceAreaLng: Prisma.Decimal | null;
      serviceAreaRadiusKm: Prisma.Decimal | null;
    },
    serviceCount: number,
    availabilityCount: number,
  ) {
    return {
      emailVerified: tasker.isVerified,
      identityDocumentPresent: Boolean(tasker.idType && tasker.identityDocument),
      servicesConfigured: serviceCount > 0,
      availabilityConfigured: availabilityCount > 0,
      serviceAreaConfigured:
        tasker.serviceAreaLat !== null &&
        tasker.serviceAreaLng !== null &&
        tasker.serviceAreaRadiusKm !== null,
    };
  }

  private async requireTasker(taskerId: number) {
    const tasker = await this.prisma.user.findFirst({
      where: { id: taskerId, roles: { has: UserRole.Tasker }, deletedAt: null, taskerProfile: { isNot: null } },
      include: { taskerProfile: true },
    });
    if (!tasker) throw new NotFoundException('Tasker not found');
    return tasker;
  }
}
