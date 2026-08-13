import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type EliteMembershipRequest, type User } from '../../../generated/prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AccountStatus } from '../../../common/enums/account-status.enum';
import { UserRole } from '../../../common/enums/user-role.enum';
import { AdminAuditService } from '../../admin-audit/admin-audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { AppCacheService, CacheNamespace } from '../../../infrastructure/redis/app-cache.service';
import {
  dateFilter,
  fullName,
  money,
  pagination,
  percentage,
  resolveAdminDateRange,
} from '../../admin-dashboard/admin-dashboard.utils';
import type { AdminDateRangeQueryDto } from '../../admin-dashboard/dto/admin-date-range-query.dto';
import type {
  CreateEliteBadgeDto,
  EliteDecisionDto,
  ListEliteAdminDto,
  ReplaceEliteBenefitsDto,
  RevokeEliteBadgeDto,
  SetEliteTierDto,
  TaskerEliteRequestDto,
  UpdateEliteBadgeDto,
  UpdateEliteTierPolicyDto,
} from '../dto';
import {
  ELITE_PROGRAM_HISTORY_COMPLETE_FROM,
  ELITE_TIER_CODES,
  type EliteTierCode,
} from '../elite-program.constants';
import { LocaleService } from '../../localization/locale.service';
import type { TranslationDto } from '../../localization/translation.dto';
import type { EliteBenefitTranslationDto } from '../dto/elite-benefits.dto';
import { ObjectStorageDeletionService } from '../../account-deletion/object-storage-deletion.service';

type DbClient = PrismaService | Prisma.TransactionClient;

type EliteTranslation = {
  locale: string;
  name: string;
  description: string | null;
};

type MetricsSnapshot = {
  rating: number;
  completedTasks: number;
  completionRate: number;
  settledEarnings: number;
  openComplaints: number;
  measuredAt: string;
};

type EliteTierRequirements = {
  minRating?: number;
  minCompletedTasks?: number;
  minCompletionRate?: number;
  maxOpenComplaints?: number;
  minSettledEarnings?: number;
};

type EligibilityCheck = {
  key: keyof EliteTierRequirements;
  actual: number;
  required: number;
  operator: 'gte' | 'lte';
  passed: boolean;
  score: number;
};

@Injectable()
export class EliteProgramService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly notifications: NotificationsService,
    private readonly locales: LocaleService,
    private readonly cache: AppCacheService,
    private readonly config: ConfigService,
    private readonly storage: ObjectStorageDeletionService,
  ) {}

  async overview(query: AdminDateRangeQueryDto): Promise<Record<string, unknown>> {
    const range = resolveAdminDateRange(query);
    const transitionDate = dateFilter(range);
    const [tiers, counts, pendingGroups, transitions, recentRequests, benefitCount, badgeCount] =
      await Promise.all([
        this.prisma.eliteTier.findMany({ orderBy: { rank: 'asc' } }),
        this.prisma.user.groupBy({
          by: ['eliteTierId'],
          where: {
            role: UserRole.Tasker,
            deletedAt: null,
            isElite: true,
            eliteTierId: { not: null },
          },
          _count: { _all: true },
        }),
        this.prisma.eliteMembershipRequest.groupBy({
          by: ['kind'],
          where: { status: 'pending' },
          _count: { _all: true },
        }),
        this.prisma.eliteTierTransition.findMany({
          where: transitionDate ? { createdAt: transitionDate } : undefined,
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            taskerId: true,
            fromTierCode: true,
            toTierCode: true,
            source: true,
            createdAt: true,
          },
        }),
        this.prisma.eliteMembershipRequest.findMany({
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            tasker: {
              select: { id: true, firstName: true, lastName: true, profilePicture: true },
            },
          },
        }),
        this.prisma.eliteBenefit.count({ where: { isActive: true } }),
        this.prisma.eliteBadge.count({ where: { isActive: true } }),
      ]);

    const countByTierId = new Map(counts.map((row) => [row.eliteTierId, row._count._all]));
    const tierCounts = tiers.map((tier) => ({
      code: tier.code,
      name: tier.name,
      rank: tier.rank,
      active: tier.isActive,
      count: countByTierId.get(tier.id) ?? 0,
    }));
    const totalElite = tierCounts.reduce((sum, tier) => sum + tier.count, 0);
    const pendingByKind = Object.fromEntries(
      pendingGroups.map((row) => [row.kind, row._count._all]),
    );

    return {
      history: {
        tierTransitionHistoryCompleteFrom: ELITE_PROGRAM_HISTORY_COMPLETE_FROM,
        note: 'Taskers marked isElite before tiered membership existed were migrated to Gold without fabricated historical transitions.',
      },
      metrics: {
        totalElite,
        tiers: tierCounts,
        pendingApplications: pendingByKind.application ?? 0,
        pendingUpgrades: pendingByKind.upgrade ?? 0,
        pendingDowngrades: pendingByKind.downgrade ?? 0,
        configuredBenefits: benefitCount,
        configuredBadges: badgeCount,
      },
      tierGrowth: this.reconstructTierHistory(tiers, tierCounts, transitions, range),
      recentActivity: recentRequests.map((request) => ({
        id: request.id,
        type: `elite_${request.kind}_${request.status}`,
        requestKind: request.kind,
        requestStatus: request.status,
        tasker: {
          id: String(request.tasker.id),
          name: fullName(request.tasker.firstName, request.tasker.lastName),
          profilePicture: request.tasker.profilePicture ?? '',
        },
        fromTier: request.fromTierCode,
        toTier: request.toTierCode,
        createdAt: request.createdAt.toISOString(),
        decidedAt: request.decidedAt?.toISOString() ?? null,
      })),
    };
  }

  async list(query: ListEliteAdminDto): Promise<Record<string, unknown>> {
    const view = query.view ?? 'members';
    if (view === 'members') return this.listMembers(query);
    return this.listRequests(query);
  }

  async details(taskerId: number): Promise<Record<string, unknown>> {
    const tasker = await this.prisma.user.findFirst({
      where: { id: taskerId, role: UserRole.Tasker, deletedAt: null },
      include: {
        eliteTier: { include: { benefits: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } } },
        eliteRequests: { orderBy: { createdAt: 'desc' }, take: 20 },
        eliteTransitions: { orderBy: { createdAt: 'desc' }, take: 20 },
        eliteBadges: {
          where: { revokedAt: null },
          include: { badge: { include: { tier: true } } },
          orderBy: { awardedAt: 'desc' },
        },
        userServices: {
          include: { service: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!tasker) throw new NotFoundException('Tasker not found');

    const metrics = await this.metricsSnapshot(this.prisma, tasker.id);
    const settled = await this.prisma.taskerWalletLedgerEntry.aggregate({
      where: { taskerId, kind: 'earning', status: 'settled' },
      _sum: { amount: true },
    });

    return {
      tasker: {
        id: String(tasker.id),
        taskerId: `TSK-${String(tasker.id).padStart(5, '0')}`,
        name: fullName(tasker.firstName, tasker.lastName),
        email: tasker.email,
        profilePicture: tasker.profilePicture ?? '',
        accountStatus: tasker.accountStatus,
        onboardingStatus: tasker.onboardingStatus,
        rating: Number(tasker.rating),
        reviewsCount: tasker.reviewsCount,
        completedTasks: tasker.completedTasks,
        isElite: tasker.isElite,
        eliteSince: tasker.eliteSince?.toISOString() ?? null,
        tier: tasker.eliteTier ? this.serializeTier(tasker.eliteTier) : null,
        services: tasker.userServices.map((item) => ({
          id: String(item.service.id),
          name: item.service.name,
          hourlyRate: money(item.hourlyRate),
        })),
      },
      metrics,
      settledEarnings: money(settled._sum.amount),
      benefits: tasker.eliteTier?.benefits.map((benefit) => this.serializeBenefit(benefit)) ?? [],
      badges: tasker.eliteBadges.map((assignment) => ({
        assignmentId: assignment.id,
        awardedAt: assignment.awardedAt.toISOString(),
        badge: this.serializeBadge(assignment.badge),
      })),
      requests: tasker.eliteRequests.map((request) => this.serializeRequest(request)),
      transitions: tasker.eliteTransitions.map((transition) => ({
        id: transition.id,
        fromTier: transition.fromTierCode,
        toTier: transition.toTierCode,
        source: transition.source,
        reason: transition.reason,
        createdAt: transition.createdAt.toISOString(),
      })),
    };
  }

  async taskerState(taskerId: number, locale: string): Promise<Record<string, unknown>> {
    const tasker = await this.prisma.user.findFirst({
      where: { id: taskerId, role: UserRole.Tasker, deletedAt: null },
      include: {
        eliteTier: {
          include: {
            translations: {
              where: { locale: { in: [locale, this.locales.defaultLocale] } },
            },
            benefits: {
              where: { isActive: true },
              orderBy: { sortOrder: 'asc' },
              include: {
                translations: {
                  where: { locale: { in: [locale, this.locales.defaultLocale] } },
                },
              },
            },
          },
        },
        eliteRequests: { where: { status: 'pending' }, orderBy: { createdAt: 'desc' }, take: 1 },
        eliteBadges: {
          where: { revokedAt: null, badge: { isActive: true } },
          include: {
            badge: {
              include: {
                tier: true,
                translations: {
                  where: { locale: { in: [locale, this.locales.defaultLocale] } },
                },
              },
            },
          },
          orderBy: { awardedAt: 'desc' },
        },
      },
    });
    if (!tasker) throw new NotFoundException('Tasker not found');
    const tiers = await this.prisma.eliteTier.findMany({
      where: { isActive: true },
      orderBy: { rank: 'asc' },
      include: {
        translations: {
          where: { locale: { in: [locale, this.locales.defaultLocale] } },
        },
      },
    });
    const currentIndex = tasker.eliteTier
      ? tiers.findIndex((tier) => tier.id === tasker.eliteTierId)
      : -1;
    const nextTier = tiers[currentIndex + 1] ?? null;
    const previousTier = currentIndex > 0 ? tiers[currentIndex - 1] : null;
    const applicationTier = !tasker.isElite ? (tiers[0] ?? null) : null;
    const eligibilityTarget = tasker.isElite ? nextTier : applicationTier;
    const metrics = await this.metricsSnapshot(this.prisma, taskerId);
    const eligibility = eligibilityTarget
      ? this.evaluateEligibility(metrics, eligibilityTarget.requirements)
      : this.evaluateEligibility(metrics, null);

    return {
      isElite: tasker.isElite,
      eliteSince: tasker.eliteSince?.toISOString() ?? null,
      tier: tasker.eliteTier ? this.serializeTier(tasker.eliteTier, locale) : null,
      benefits:
        tasker.eliteTier?.benefits.map((benefit) => this.serializeBenefit(benefit, locale)) ?? [],
      badges: tasker.eliteBadges.map((assignment) => ({
        assignmentId: assignment.id,
        awardedAt: assignment.awardedAt.toISOString(),
        badge: this.serializeBadge(assignment.badge, locale),
      })),
      pendingRequest: tasker.eliteRequests[0]
        ? this.serializeRequest(tasker.eliteRequests[0])
        : null,
      availableActions: {
        canApply: !tasker.isElite && !tasker.eliteRequests.length && tiers.length > 0,
        canRequestUpgrade: tasker.isElite && Boolean(nextTier) && !tasker.eliteRequests.length,
        canRequestDowngrade: tasker.isElite && !tasker.eliteRequests.length,
        nextTier: nextTier ? this.serializeTier(nextTier, locale) : null,
        previousTier: previousTier
          ? this.serializeTier(previousTier, locale)
          : tasker.isElite
            ? { code: 'standard', name: 'Standard' }
            : null,
      },
      eligibility: {
        targetTier: eligibilityTarget ? this.serializeTier(eligibilityTarget, locale) : null,
        ...eligibility,
        note:
          eligibility.score === null
            ? 'No automatic Elite eligibility thresholds are configured for the target tier. Admin review uses the real tasker metrics below.'
            : 'The score is calculated only from the configured target-tier requirements and real tasker metrics. It does not automatically approve a request.',
        metrics,
      },
    };
  }

  async submitRequest(
    taskerId: number,
    dto: TaskerEliteRequestDto,
  ): Promise<Record<string, unknown>> {
    let request: EliteMembershipRequest;
    try {
      request = await this.prisma.$transaction(
        async (tx) => {
          const tasker = await tx.user.findFirst({
            where: { id: taskerId, role: UserRole.Tasker, deletedAt: null },
            include: { eliteTier: true },
          });
          if (!tasker) throw new NotFoundException('Tasker not found');
          if (tasker.accountStatus !== AccountStatus.Active) {
            throw new ForbiddenException('Only active taskers can submit Elite Program requests');
          }
          if (
            !tasker.isVerified ||
            !tasker.isDocVerified ||
            tasker.onboardingStatus !== 'approved'
          ) {
            throw new ConflictException(
              'Tasker onboarding and identity verification must be approved first',
            );
          }

          const existing = await tx.eliteMembershipRequest.findFirst({
            where: { taskerId, status: 'pending' },
          });
          if (existing)
            throw new ConflictException('A pending Elite Program request already exists');

          const target = await this.resolveRequestedTarget(tx, tasker.eliteTier, dto.kind);
          const metrics = await this.metricsSnapshot(tx, taskerId);
          return tx.eliteMembershipRequest.create({
            data: {
              taskerId,
              kind: dto.kind,
              fromTierCode: tasker.eliteTier?.code ?? null,
              toTierCode: target?.code ?? null,
              reason: dto.reason?.trim() || null,
              metricsSnapshot: metrics as unknown as Prisma.InputJsonValue,
              requirementsSnapshot: target?.requirements
                ? (target.requirements as Prisma.InputJsonValue)
                : Prisma.DbNull,
            },
          });
        },
        { maxWait: 15_000, timeout: 30_000 },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A pending Elite Program request already exists');
      }
      throw error;
    }

    await this.notifyEliteManagers(
      'Elite Program request submitted',
      `Tasker ${taskerId} submitted an Elite ${request.kind} request.`,
      request.id,
    );
    return { request: this.serializeRequest(request) };
  }

  async cancelTaskerRequest(taskerId: number, requestId: string): Promise<Record<string, unknown>> {
    const result = await this.prisma.eliteMembershipRequest.updateMany({
      where: { id: requestId, taskerId, status: 'pending' },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });
    if (!result.count) throw new NotFoundException('Pending Elite request not found');
    return { cancelled: true, requestId };
  }

  async decide(
    actor: User,
    requestId: string,
    dto: EliteDecisionDto,
  ): Promise<Record<string, unknown>> {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const request = await tx.eliteMembershipRequest.findUnique({
          where: { id: requestId },
          include: { tasker: { include: { eliteTier: true } } },
        });
        if (!request) throw new NotFoundException('Elite request not found');
        if (request.status !== 'pending')
          throw new ConflictException('Elite request is no longer pending');

        const currentTier = request.tasker.eliteTier?.code ?? null;
        if (currentTier !== request.fromTierCode) {
          throw new ConflictException(
            'Tasker tier changed after this request was submitted; review a fresh request',
          );
        }
        const decisionReason = dto.reason?.trim();
        if (dto.action === 'reject' && !decisionReason) {
          throw new BadRequestException('A rejection reason is required');
        }

        if (dto.action === 'reject') {
          const updated = await tx.eliteMembershipRequest.update({
            where: { id: request.id },
            data: {
              status: 'rejected',
              decisionReason,
              decidedById: actor.id,
              decidedAt: new Date(),
            },
          });
          await this.audit.record(
            {
              actorId: actor.id,
              targetUserId: request.taskerId,
              action: 'elite_request_rejected',
              entityType: 'elite_membership_request',
              entityId: request.id,
              reason: dto.reason,
              metadata: {
                kind: request.kind,
                fromTier: request.fromTierCode,
                toTier: request.toTierCode,
              },
            },
            tx,
          );
          return { request: updated, transition: null };
        }

        const transition = await this.applyTierChange(tx, {
          tasker: request.tasker,
          toTierCode: request.toTierCode,
          source: 'request',
          actorId: actor.id,
          reason: dto.reason,
          requestId: request.id,
        });
        const updated = await tx.eliteMembershipRequest.update({
          where: { id: request.id },
          data: {
            status: 'approved',
            decisionReason: dto.reason?.trim() || null,
            decidedById: actor.id,
            decidedAt: new Date(),
          },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            targetUserId: request.taskerId,
            action: 'elite_request_approved',
            entityType: 'elite_membership_request',
            entityId: request.id,
            reason: dto.reason,
            metadata: {
              kind: request.kind,
              fromTier: request.fromTierCode,
              toTier: request.toTierCode,
            },
          },
          tx,
        );
        return { request: updated, transition };
      },
      { maxWait: 15_000, timeout: 30_000 },
    );

    const taskerId = result.request.taskerId;
    await this.notifications.create(taskerId, {
      category: 'system',
      type: `elite_request_${result.request.status}`,
      title: `Elite request ${result.request.status}`,
      body:
        result.request.status === 'approved'
          ? 'Your Elite Program request was approved.'
          : 'Your Elite Program request was not approved. Review the decision details in your account.',
      entityType: 'elite_membership_request',
      entityId: result.request.id,
    });
    return {
      request: this.serializeRequest(result.request),
      transition: result.transition
        ? {
            id: result.transition.id,
            fromTier: result.transition.fromTierCode,
            toTier: result.transition.toTierCode,
            createdAt: result.transition.createdAt.toISOString(),
          }
        : null,
    };
  }

  async setTier(
    actor: User,
    taskerId: number,
    dto: SetEliteTierDto,
  ): Promise<Record<string, unknown>> {
    const targetCode = dto.tier === 'standard' ? null : dto.tier;
    const transition = await this.prisma.$transaction(
      async (tx) => {
        const tasker = await tx.user.findFirst({
          where: { id: taskerId, role: UserRole.Tasker, deletedAt: null },
          include: { eliteTier: true },
        });
        if (!tasker) throw new NotFoundException('Tasker not found');
        if ((tasker.eliteTier?.code ?? null) === targetCode) {
          throw new ConflictException('Tasker is already assigned to that tier');
        }
        const changed = await this.applyTierChange(tx, {
          tasker,
          toTierCode: targetCode,
          source: 'admin',
          actorId: actor.id,
          reason: dto.reason,
        });
        await tx.eliteMembershipRequest.updateMany({
          where: { taskerId, status: 'pending' },
          data: {
            status: 'cancelled',
            cancelledAt: new Date(),
            decisionReason: 'Superseded by direct administrator tier assignment.',
          },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            targetUserId: taskerId,
            action: 'elite_tier_changed',
            entityType: 'tasker',
            entityId: taskerId,
            reason: dto.reason,
            metadata: { fromTier: tasker.eliteTier?.code ?? null, toTier: targetCode },
          },
          tx,
        );
        return changed;
      },
      { maxWait: 15_000, timeout: 30_000 },
    );

    await this.notifications.create(taskerId, {
      category: 'system',
      type: 'elite_tier_changed',
      title: targetCode ? `Elite tier updated to ${targetCode}` : 'Elite membership ended',
      body: targetCode
        ? `Your Latache Elite tier is now ${targetCode}.`
        : 'Your Latache Elite membership has been moved to Standard.',
      entityType: 'elite_tier_transition',
      entityId: transition.id,
    });
    return {
      taskerId: String(taskerId),
      fromTier: transition.fromTierCode,
      toTier: transition.toTierCode,
      changedAt: transition.createdAt.toISOString(),
    };
  }

  async program(): Promise<Record<string, unknown>> {
    return this.cache.getOrLoad(
      CacheNamespace.EliteProgram,
      { operation: 'program' },
      this.config.get<number>('cache.eliteTtlSeconds', 120),
      () => this.loadProgram(),
    );
  }

  private async loadProgram(): Promise<Record<string, unknown>> {
    const [tiers, badges] = await Promise.all([
      this.prisma.eliteTier.findMany({
        orderBy: { rank: 'asc' },
        include: {
          translations: { orderBy: { locale: 'asc' } },
          benefits: {
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
            include: { translations: { orderBy: { locale: 'asc' } } },
          },
          _count: { select: { members: true } },
        },
      }),
      this.prisma.eliteBadge.findMany({
        orderBy: [{ tier: { rank: 'asc' } }, { name: 'asc' }],
        include: {
          tier: true,
          translations: { orderBy: { locale: 'asc' } },
          _count: {
            select: { assignments: { where: { revokedAt: null } } },
          },
        },
      }),
    ]);
    return {
      tiers: tiers.map((tier) => ({
        ...this.serializeTier(tier),
        memberCount: tier._count.members,
        benefits: tier.benefits.map((benefit) => this.serializeBenefit(benefit)),
      })),
      badges: badges.map((badge) => ({
        ...this.serializeBadge(badge),
        activeAssignmentCount: badge._count.assignments,
      })),
      benefitEnforcement: {
        status: 'configuration_only',
        note: 'Benefit definitions are real persisted program configuration. Financial/booking effects are applied only when a consuming module explicitly integrates the benefit code; this API never fabricates discounts or bonuses.',
      },
    };
  }

  async updateTierPolicy(
    actor: User,
    tierCode: string,
    dto: UpdateEliteTierPolicyDto,
  ): Promise<Record<string, unknown>> {
    const code = this.normalizeTierCode(tierCode);
    const existing = await this.prisma.eliteTier.findUnique({ where: { code } });
    if (!existing) throw new NotFoundException('Elite tier not found');
    const translations = this.normalizeTranslations(dto.translations);
    const english = translations.find(
      (translation) => translation.locale === this.locales.defaultLocale,
    );
    if (
      dto.name === undefined &&
      dto.description === undefined &&
      dto.requirements === undefined &&
      translations.length === 0
    ) {
      throw new BadRequestException('At least one tier policy field must be provided');
    }

    const tier = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.eliteTier.update({
        where: { id: existing.id },
        data: {
          ...(dto.name === undefined && english?.name === undefined
            ? {}
            : { name: (dto.name ?? english?.name)?.trim() }),
          ...(dto.description === undefined && english?.description === undefined
            ? {}
            : { description: (dto.description ?? english?.description)?.trim() || null }),
          ...(dto.requirements === undefined
            ? {}
            : {
                requirements:
                  dto.requirements === null
                    ? Prisma.DbNull
                    : (dto.requirements as Prisma.InputJsonValue),
              }),
        },
      });
      await this.upsertTierTranslations(tx, updated.id, translations, {
        name: updated.name,
        description: updated.description,
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'elite_tier_policy_updated',
          entityType: 'elite_tier',
          entityId: updated.id,
          metadata: {
            tier: updated.code,
            requirementsConfigured:
              dto.requirements === undefined
                ? existing.requirements !== null
                : dto.requirements !== null && Object.keys(dto.requirements).length > 0,
          },
        },
        tx,
      );
      return tx.eliteTier.findUniqueOrThrow({
        where: { id: updated.id },
        include: { translations: { orderBy: { locale: 'asc' } } },
      });
    });

    await this.invalidateProgramCache();
    return { tier: this.serializeTier(tier) };
  }

  async replaceBenefits(
    actor: User,
    tierCode: string,
    dto: ReplaceEliteBenefitsDto,
  ): Promise<Record<string, unknown>> {
    const normalized = dto.benefits.map((benefit) => ({
      ...benefit,
      code: this.normalizeCode(benefit.code),
      name: benefit.name.trim(),
      translations: this.normalizeBenefitTranslations(benefit.translations),
    }));
    const duplicates = normalized.filter(
      (benefit, index) =>
        normalized.findIndex((candidate) => candidate.code === benefit.code) !== index,
    );
    if (duplicates.length)
      throw new BadRequestException('Benefit codes must be unique within a tier');

    const tier = await this.prisma.eliteTier.findUnique({
      where: { code: this.normalizeTierCode(tierCode) },
    });
    if (!tier) throw new NotFoundException('Elite tier not found');

    await this.prisma.$transaction(async (tx) => {
      const codes = normalized.map((benefit) => benefit.code);
      await tx.eliteBenefit.deleteMany({
        where: { tierId: tier.id, ...(codes.length ? { code: { notIn: codes } } : {}) },
      });
      for (const benefit of normalized) {
        const row = await tx.eliteBenefit.upsert({
          where: { tierId_code: { tierId: tier.id, code: benefit.code } },
          create: {
            tierId: tier.id,
            code: benefit.code,
            name: benefit.name,
            description: benefit.description?.trim() || null,
            displayValue: benefit.displayValue?.trim() || null,
            metadata: benefit.metadata
              ? (benefit.metadata as Prisma.InputJsonValue)
              : Prisma.DbNull,
            isActive: benefit.isActive ?? true,
            sortOrder: benefit.sortOrder ?? 0,
          },
          update: {
            name: benefit.name,
            description: benefit.description?.trim() || null,
            displayValue: benefit.displayValue?.trim() || null,
            metadata: benefit.metadata
              ? (benefit.metadata as Prisma.InputJsonValue)
              : Prisma.DbNull,
            isActive: benefit.isActive ?? true,
            sortOrder: benefit.sortOrder ?? 0,
          },
        });
        await this.upsertBenefitTranslations(tx, row.id, benefit.translations, {
          name: row.name,
          description: row.description,
          displayValue: row.displayValue,
        });
      }
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'elite_benefits_replaced',
          entityType: 'elite_tier',
          entityId: tier.id,
          metadata: { tier: tier.code, benefitCodes: codes },
        },
        tx,
      );
    });

    const benefits = await this.prisma.eliteBenefit.findMany({
      where: { tierId: tier.id },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { translations: { orderBy: { locale: 'asc' } } },
    });
    await this.invalidateProgramCache();
    return {
      tier: this.serializeTier(tier),
      benefits: benefits.map((benefit) => this.serializeBenefit(benefit)),
    };
  }

  async createBadge(actor: User, dto: CreateEliteBadgeDto): Promise<Record<string, unknown>> {
    const tier = dto.tier
      ? await this.prisma.eliteTier.findUnique({ where: { code: dto.tier } })
      : null;
    if (dto.tier && !tier) throw new NotFoundException('Elite tier not found');
    const code = this.normalizeCode(dto.code);
    const translations = this.normalizeTranslations(dto.translations);
    try {
      const badge = await this.prisma.$transaction(async (tx) => {
        const created = await tx.eliteBadge.create({
          data: {
            tierId: tier?.id ?? null,
            code,
            name: dto.name.trim(),
            description: dto.description?.trim() || null,
            assetUrl: dto.assetUrl?.trim() || null,
            criteria: dto.criteria ? (dto.criteria as Prisma.InputJsonValue) : Prisma.DbNull,
            isActive: dto.isActive ?? true,
          },
        });
        await this.upsertBadgeTranslations(tx, created.id, translations, {
          name: created.name,
          description: created.description,
        });
        await this.audit.record(
          {
            actorId: actor.id,
            action: 'elite_badge_created',
            entityType: 'elite_badge',
            entityId: created.id,
            metadata: { code: created.code, tier: tier?.code ?? null },
          },
          tx,
        );
        return tx.eliteBadge.findUniqueOrThrow({
          where: { id: created.id },
          include: { tier: true, translations: { orderBy: { locale: 'asc' } } },
        });
      });
      await this.invalidateProgramCache();
      return { badge: this.serializeBadge(badge) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Elite badge code already exists');
      }
      throw error;
    }
  }

  async updateBadge(
    actor: User,
    badgeId: string,
    dto: UpdateEliteBadgeDto,
  ): Promise<Record<string, unknown>> {
    const existing = await this.prisma.eliteBadge.findUnique({ where: { id: badgeId } });
    if (!existing) throw new NotFoundException('Elite badge not found');
    const translations = this.normalizeTranslations(dto.translations);
    const english = translations.find(
      (translation) => translation.locale === this.locales.defaultLocale,
    );
    const tier = dto.tier
      ? await this.prisma.eliteTier.findUnique({ where: { code: dto.tier } })
      : undefined;
    if (dto.tier && !tier) throw new NotFoundException('Elite tier not found');
    const badge = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.eliteBadge.update({
        where: { id: badgeId },
        data: {
          ...(dto.code === undefined ? {} : { code: this.normalizeCode(dto.code) }),
          ...(dto.name === undefined && english?.name === undefined
            ? {}
            : { name: (dto.name ?? english?.name)?.trim() }),
          ...(dto.description === undefined && english?.description === undefined
            ? {}
            : { description: (dto.description ?? english?.description)?.trim() || null }),
          ...(dto.assetUrl === undefined ? {} : { assetUrl: dto.assetUrl.trim() || null }),
          ...(dto.criteria === undefined
            ? {}
            : { criteria: dto.criteria as Prisma.InputJsonValue }),
          ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
          ...(dto.tier === undefined ? {} : { tierId: tier?.id ?? null }),
        },
      });
      await this.upsertBadgeTranslations(tx, updated.id, translations, {
        name: updated.name,
        description: updated.description,
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'elite_badge_updated',
          entityType: 'elite_badge',
          entityId: updated.id,
          metadata: { code: updated.code, tier: tier?.code ?? null },
        },
        tx,
      );
      return tx.eliteBadge.findUniqueOrThrow({
        where: { id: updated.id },
        include: { tier: true, translations: { orderBy: { locale: 'asc' } } },
      });
    });
    await this.invalidateProgramCache();
    return { badge: this.serializeBadge(badge) };
  }

  async deleteBadge(actor: User, badgeId: string): Promise<Record<string, unknown>> {
    const badge = await this.prisma.eliteBadge.findUnique({ where: { id: badgeId } });
    if (!badge) throw new NotFoundException('Elite badge not found');
    const assets = this.storage.extractManagedAssets(badge.assetUrl);
    await this.prisma.$transaction(async (tx) => {
      await this.storage.enqueue(tx, assets, 'elite_badge', badgeId, actor.id);
      await tx.eliteBadge.delete({ where: { id: badgeId } });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'elite_badge_permanently_deleted',
          entityType: 'elite_badge',
          entityId: badgeId,
          metadata: { code: badge.code, irreversible: true, assetCount: assets.length },
        },
        tx,
      );
    });
    await this.storage.attemptImmediate('elite_badge', badgeId, assets.length);
    await this.invalidateProgramCache();
    return { deleted: true, badgeId };
  }

  private async invalidateProgramCache(): Promise<void> {
    await Promise.all([
      this.cache.invalidate(CacheNamespace.EliteProgram),
      this.cache.invalidate(CacheNamespace.PlatformContent),
      this.cache.invalidate(CacheNamespace.AdminAnalytics),
    ]);
  }

  async assignBadge(
    actor: User,
    taskerId: number,
    badgeId: string,
  ): Promise<Record<string, unknown>> {
    const [tasker, badge] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: taskerId, role: UserRole.Tasker, deletedAt: null },
        include: { eliteTier: true },
      }),
      this.prisma.eliteBadge.findUnique({ where: { id: badgeId }, include: { tier: true } }),
    ]);
    if (!tasker) throw new NotFoundException('Tasker not found');
    if (!badge || !badge.isActive) throw new NotFoundException('Active elite badge not found');
    if (!tasker.isElite || !tasker.eliteTier)
      throw new ConflictException('Only current Elite taskers can receive Elite badges');
    if (badge.tier && badge.tier.id !== tasker.eliteTierId) {
      throw new ConflictException(`This badge is restricted to the ${badge.tier.name} tier`);
    }

    const assignment = await this.prisma.eliteTaskerBadge.upsert({
      where: { taskerId_badgeId: { taskerId, badgeId } },
      create: { taskerId, badgeId, awardedById: actor.id },
      update: {
        awardedById: actor.id,
        awardedAt: new Date(),
        revokedAt: null,
        revokeReason: null,
      },
      include: { badge: { include: { tier: true } } },
    });
    await this.audit.record({
      actorId: actor.id,
      targetUserId: taskerId,
      action: 'elite_badge_awarded',
      entityType: 'elite_badge',
      entityId: badgeId,
      metadata: { badgeCode: badge.code },
    });
    await this.notifications.create(taskerId, {
      category: 'system',
      type: 'elite_badge_awarded',
      title: 'New Elite badge awarded',
      body: `You received the ${badge.name} badge.`,
      entityType: 'elite_badge',
      entityId: badgeId,
    });
    return {
      assignmentId: assignment.id,
      awardedAt: assignment.awardedAt.toISOString(),
      badge: this.serializeBadge(assignment.badge),
    };
  }

  async revokeBadge(
    actor: User,
    taskerId: number,
    badgeId: string,
    dto: RevokeEliteBadgeDto,
  ): Promise<Record<string, unknown>> {
    const assignment = await this.prisma.eliteTaskerBadge.findUnique({
      where: { taskerId_badgeId: { taskerId, badgeId } },
      include: { badge: true },
    });
    if (!assignment || assignment.revokedAt)
      throw new NotFoundException('Active tasker badge assignment not found');
    await this.prisma.eliteTaskerBadge.update({
      where: { taskerId_badgeId: { taskerId, badgeId } },
      data: { revokedAt: new Date(), revokeReason: dto.reason?.trim() || null },
    });
    await this.audit.record({
      actorId: actor.id,
      targetUserId: taskerId,
      action: 'elite_badge_revoked',
      entityType: 'elite_badge',
      entityId: badgeId,
      reason: dto.reason,
      metadata: { badgeCode: assignment.badge.code },
    });
    return { revoked: true, taskerId: String(taskerId), badgeId };
  }

  async performance(query: AdminDateRangeQueryDto): Promise<Record<string, unknown>> {
    const range = resolveAdminDateRange(query);
    const date = dateFilter(range);
    const elite = await this.prisma.user.findMany({
      where: { role: UserRole.Tasker, deletedAt: null, isElite: true, eliteTierId: { not: null } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        profilePicture: true,
        rating: true,
        completedTasks: true,
        eliteTier: true,
      },
    });
    const ids = elite.map((tasker) => tasker.id);
    if (!ids.length) {
      return {
        range: this.rangeView(range),
        metrics: {
          totalElite: 0,
          averageRating: 0,
          completionRate: 0,
          settledEarnings: 0,
          platformFees: 0,
          disputes: 0,
        },
        trend: [],
        topPerformers: [],
      };
    }

    const [statuses, earnings, fees, disputes, earningRows, bookingRows] = await Promise.all([
      this.prisma.booking.groupBy({
        by: ['status'],
        where: { taskerId: { in: ids }, ...(date ? { createdAt: date } : {}) },
        _count: { _all: true },
      }),
      this.prisma.taskerWalletLedgerEntry.aggregate({
        where: {
          taskerId: { in: ids },
          kind: 'earning',
          status: 'settled',
          ...(date ? { createdAt: date } : {}),
        },
        _sum: { amount: true },
      }),
      this.prisma.booking.aggregate({
        where: { taskerId: { in: ids }, paymentStatus: 'paid', ...(date ? { paidAt: date } : {}) },
        _sum: { platformFeeAmount: true },
      }),
      this.prisma.taskComplaint.count({
        where: { booking: { taskerId: { in: ids } }, ...(date ? { createdAt: date } : {}) },
      }),
      this.prisma.taskerWalletLedgerEntry.findMany({
        where: {
          taskerId: { in: ids },
          kind: 'earning',
          status: 'settled',
          ...(date ? { createdAt: date } : {}),
        },
        select: { taskerId: true, amount: true, createdAt: true },
      }),
      this.prisma.booking.findMany({
        where: {
          taskerId: { in: ids },
          status: { in: ['completed', 'cancelled'] },
          ...(date ? { createdAt: date } : {}),
        },
        select: { taskerId: true, status: true, createdAt: true },
      }),
    ]);
    const completed = statuses.find((row) => row.status === 'completed')?._count._all ?? 0;
    const cancelled = statuses.find((row) => row.status === 'cancelled')?._count._all ?? 0;
    const averageRating = Number(
      (elite.reduce((sum, tasker) => sum + Number(tasker.rating), 0) / elite.length).toFixed(2),
    );

    const earningsByTasker = new Map<number, number>();
    for (const row of earningRows) {
      earningsByTasker.set(
        row.taskerId,
        (earningsByTasker.get(row.taskerId) ?? 0) + Number(row.amount),
      );
    }
    const topPerformers = [...elite]
      .sort((a, b) => (earningsByTasker.get(b.id) ?? 0) - (earningsByTasker.get(a.id) ?? 0))
      .slice(0, 10)
      .map((tasker, index) => ({
        rank: index + 1,
        taskerId: String(tasker.id),
        name: fullName(tasker.firstName, tasker.lastName),
        profilePicture: tasker.profilePicture ?? '',
        tier: tasker.eliteTier?.code ?? null,
        rating: Number(tasker.rating),
        completedTasks: tasker.completedTasks,
        settledEarnings: money(earningsByTasker.get(tasker.id) ?? 0),
      }));

    return {
      range: this.rangeView(range),
      metrics: {
        totalElite: elite.length,
        averageRating,
        completionRate: percentage(completed, completed + cancelled),
        settledEarnings: money(earnings._sum.amount),
        platformFeesFromPaidEliteBookings: money(fees._sum.platformFeeAmount),
        disputes,
      },
      trend: this.performanceTrend(earningRows, bookingRows, range.granularity),
      topPerformers,
    };
  }

  async reportData(
    query: AdminDateRangeQueryDto,
    type: 'monthly_summary' | 'tier_transitions' | 'benefit_utilization',
  ): Promise<Record<string, unknown>> {
    const range = resolveAdminDateRange(query);
    const date = dateFilter(range);
    if (type === 'monthly_summary') {
      const [overview, performance] = await Promise.all([
        this.overview(query),
        this.performance(query),
      ]);
      return { type, range: this.rangeView(range), overview, performance };
    }
    if (type === 'tier_transitions') {
      const rows = await this.prisma.eliteTierTransition.groupBy({
        by: ['fromTierCode', 'toTierCode'],
        where: date ? { createdAt: date } : undefined,
        _count: { _all: true },
      });
      return {
        type,
        range: this.rangeView(range),
        transitions: rows.map((row) => ({
          fromTier: row.fromTierCode ?? 'standard',
          toTier: row.toTierCode ?? 'standard',
          count: row._count._all,
        })),
      };
    }

    const tiers = await this.prisma.eliteTier.findMany({
      orderBy: { rank: 'asc' },
      include: {
        benefits: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
        _count: { select: { members: true } },
      },
    });
    return {
      type,
      range: this.rangeView(range),
      trackingAvailable: false,
      note: 'Benefit usage is not fabricated. Utilization remains unavailable until a consuming booking/payment/support feature records real benefit usage events.',
      configuredBenefits: tiers.map((tier) => ({
        tier: tier.code,
        memberCount: tier._count.members,
        benefits: tier.benefits.map((benefit) => this.serializeBenefit(benefit)),
      })),
      utilization: [],
    };
  }

  csvForReport(type: string, data: Record<string, unknown>): string {
    if (type === 'tier_transitions') {
      const rows = Array.isArray(data.transitions) ? data.transitions : [];
      return this.toCsv(rows as Array<Record<string, unknown>>);
    }
    if (type === 'benefit_utilization') {
      return this.toCsv([]);
    }
    const performance = data.performance as Record<string, unknown> | undefined;
    const metrics = (performance?.metrics ?? {}) as Record<string, unknown>;
    return this.toCsv([metrics]);
  }

  private async listMembers(query: ListEliteAdminDto): Promise<Record<string, unknown>> {
    const { page, limit, skip } = pagination(query.page, query.limit);
    const search = query.search?.trim();
    const where: Prisma.UserWhereInput = {
      role: UserRole.Tasker,
      deletedAt: null,
      isElite: true,
      eliteTier: query.tier ? { code: query.tier } : { isNot: null },
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const orderBy: Prisma.UserOrderByWithRelationInput[] =
      query.sort === 'oldest'
        ? [{ eliteSince: 'asc' }]
        : query.sort === 'rating_desc'
          ? [{ rating: 'desc' }, { eliteSince: 'desc' }]
          : query.sort === 'jobs_desc'
            ? [{ completedTasks: 'desc' }, { eliteSince: 'desc' }]
            : [{ eliteSince: 'desc' }, { createdAt: 'desc' }];

    const [members, totalItems] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          profilePicture: true,
          rating: true,
          reviewsCount: true,
          completedTasks: true,
          accountStatus: true,
          eliteSince: true,
          eliteTier: true,
          userServices: { take: 3, orderBy: { createdAt: 'asc' }, include: { service: true } },
          eliteBadges: { where: { revokedAt: null }, include: { badge: true }, take: 10 },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    const ids = members.map((member) => member.id);
    const earningRows = ids.length
      ? await this.prisma.taskerWalletLedgerEntry.groupBy({
          by: ['taskerId'],
          where: { taskerId: { in: ids }, kind: 'earning', status: 'settled' },
          _sum: { amount: true },
        })
      : [];
    const earnings = new Map(earningRows.map((row) => [row.taskerId, money(row._sum.amount)]));
    let items = members.map((member) => ({
      id: String(member.id),
      taskerId: `TSK-${String(member.id).padStart(5, '0')}`,
      name: fullName(member.firstName, member.lastName),
      email: member.email,
      profilePicture: member.profilePicture ?? '',
      accountStatus: member.accountStatus,
      tier: member.eliteTier ? this.serializeTier(member.eliteTier) : null,
      joinedEliteAt: member.eliteSince?.toISOString() ?? null,
      rating: Number(member.rating),
      reviewsCount: member.reviewsCount,
      completedTasks: member.completedTasks,
      settledEarnings: earnings.get(member.id) ?? 0,
      services: member.userServices.map((item) => item.service.name).filter(Boolean),
      badges: member.eliteBadges.map((item) => ({
        id: item.badge.id,
        code: item.badge.code,
        name: item.badge.name,
        assetUrl: item.badge.assetUrl,
      })),
    }));
    if (query.sort === 'earnings_desc') {
      items = items.sort((a, b) => b.settledEarnings - a.settledEarnings);
    }
    return {
      view: 'members',
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      items,
    };
  }

  private async listRequests(query: ListEliteAdminDto): Promise<Record<string, unknown>> {
    const { page, limit, skip } = pagination(query.page, query.limit);
    const kind =
      query.view === 'applications'
        ? 'application'
        : query.view === 'upgrade_requests'
          ? 'upgrade'
          : 'downgrade';
    const search = query.search?.trim();
    const where: Prisma.EliteMembershipRequestWhereInput = {
      kind,
      status: query.requestStatus ?? 'pending',
      ...(query.tier ? { toTierCode: query.tier } : {}),
      ...(search
        ? {
            tasker: {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };
    const [requests, totalItems] = await Promise.all([
      this.prisma.eliteMembershipRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: query.sort === 'oldest' ? { createdAt: 'asc' } : { createdAt: 'desc' },
        include: {
          tasker: {
            include: { eliteTier: true },
          },
          decidedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.eliteMembershipRequest.count({ where }),
    ]);
    return {
      view: query.view,
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      items: requests.map((request) => {
        const snapshot = this.asMetricsSnapshot(request.metricsSnapshot);
        const requirements = request.requirementsSnapshot;
        return {
          ...this.serializeRequest(request),
          eligibility: snapshot
            ? this.evaluateEligibility(snapshot, requirements)
            : {
                score: null,
                eligible: null,
                requirements: this.parseRequirements(requirements),
                checks: [],
                reason: 'This request does not contain a usable metrics snapshot.',
              },
          tasker: {
            id: String(request.tasker.id),
            taskerId: `TSK-${String(request.tasker.id).padStart(5, '0')}`,
            name: fullName(request.tasker.firstName, request.tasker.lastName),
            email: request.tasker.email,
            profilePicture: request.tasker.profilePicture ?? '',
            rating: Number(request.tasker.rating),
            completedTasks: request.tasker.completedTasks,
            currentTier: request.tasker.eliteTier?.code ?? null,
          },
          decidedBy: request.decidedBy
            ? {
                id: String(request.decidedBy.id),
                name: fullName(request.decidedBy.firstName, request.decidedBy.lastName),
              }
            : null,
        };
      }),
    };
  }

  private async resolveRequestedTarget(
    tx: Prisma.TransactionClient,
    currentTier: { id: string; code: string; rank: number } | null,
    kind: 'application' | 'upgrade' | 'downgrade',
  ) {
    const tiers = await tx.eliteTier.findMany({
      where: { isActive: true },
      orderBy: { rank: 'asc' },
    });
    if (!tiers.length) throw new ConflictException('No active Elite tiers are configured');
    if (kind === 'application') {
      if (currentTier)
        throw new ConflictException('Current Elite members cannot submit a new application');
      return tiers[0] ?? null;
    }
    if (!currentTier)
      throw new ConflictException(`${kind} requests require current Elite membership`);
    const index = tiers.findIndex((tier) => tier.id === currentTier.id);
    if (index < 0) throw new ConflictException('Current Elite tier is not active');
    if (kind === 'upgrade') {
      const next = tiers[index + 1];
      if (!next) throw new ConflictException('Tasker is already in the highest active Elite tier');
      return next;
    }
    return index > 0 ? (tiers[index - 1] ?? null) : null;
  }

  private async applyTierChange(
    tx: Prisma.TransactionClient,
    input: {
      tasker: {
        id: number;
        isElite: boolean;
        eliteSince: Date | null;
        eliteTier: { code: string } | null;
      };
      toTierCode: string | null;
      source: 'request' | 'admin';
      actorId: number;
      reason?: string;
      requestId?: string;
    },
  ) {
    const target = input.toTierCode
      ? await tx.eliteTier.findUnique({ where: { code: input.toTierCode } })
      : null;
    if (input.toTierCode && (!target || !target.isActive)) {
      throw new ConflictException('Target Elite tier is not active');
    }
    const fromTier = input.tasker.eliteTier?.code ?? null;
    await tx.user.update({
      where: { id: input.tasker.id },
      data: {
        isElite: Boolean(target),
        eliteTierId: target?.id ?? null,
        eliteSince: target
          ? input.tasker.isElite && input.tasker.eliteSince
            ? input.tasker.eliteSince
            : new Date()
          : null,
      },
    });
    return tx.eliteTierTransition.create({
      data: {
        taskerId: input.tasker.id,
        requestId: input.requestId ?? null,
        fromTierCode: fromTier,
        toTierCode: target?.code ?? null,
        source: input.source,
        reason: input.reason?.trim() || null,
        actorId: input.actorId,
      },
    });
  }

  private async metricsSnapshot(client: DbClient, taskerId: number): Promise<MetricsSnapshot> {
    const [tasker, statuses, earnings, openComplaints] = await Promise.all([
      client.user.findUnique({
        where: { id: taskerId },
        select: { rating: true, completedTasks: true },
      }),
      client.booking.groupBy({
        by: ['status'],
        where: { taskerId, status: { in: ['completed', 'cancelled'] } },
        _count: { _all: true },
      }),
      client.taskerWalletLedgerEntry.aggregate({
        where: { taskerId, kind: 'earning', status: 'settled' },
        _sum: { amount: true },
      }),
      client.taskComplaint.count({ where: { booking: { taskerId }, status: 'open' } }),
    ]);
    const completed = statuses.find((row) => row.status === 'completed')?._count._all ?? 0;
    const cancelled = statuses.find((row) => row.status === 'cancelled')?._count._all ?? 0;
    return {
      rating: Number(tasker?.rating ?? 0),
      completedTasks: tasker?.completedTasks ?? completed,
      completionRate: percentage(completed, completed + cancelled),
      settledEarnings: money(earnings._sum.amount),
      openComplaints,
      measuredAt: new Date().toISOString(),
    };
  }

  private async notifyEliteManagers(title: string, body: string, entityId: string): Promise<void> {
    const admins = await this.prisma.user.findMany({
      where: {
        role: { in: [UserRole.Admin, UserRole.SuperAdmin] },
        accountStatus: AccountStatus.Active,
        deletedAt: null,
        OR: [{ role: UserRole.SuperAdmin }, { permissions: { has: 'elite.manage' } }],
      },
      select: { id: true },
    });
    await Promise.allSettled(
      admins.map((admin) =>
        this.notifications.create(admin.id, {
          category: 'system',
          type: 'elite_request_submitted',
          title,
          body,
          entityType: 'elite_membership_request',
          entityId,
        }),
      ),
    );
  }

  private reconstructTierHistory(
    tiers: Array<{ id: string; code: string; name: string; rank: number }>,
    current: Array<{ code: string; count: number }>,
    transitions: Array<{ fromTierCode: string | null; toTierCode: string | null; createdAt: Date }>,
    range: { granularity: 'day' | 'month' },
  ) {
    const keyFor = (date: Date) =>
      range.granularity === 'day'
        ? date.toISOString().slice(0, 10)
        : date.toISOString().slice(0, 7);
    const buckets = new Map<string, typeof transitions>();
    for (const transition of transitions) {
      const key = keyFor(transition.createdAt);
      buckets.set(key, [...(buckets.get(key) ?? []), transition]);
    }
    const counts = new Map(current.map((row) => [row.code, row.count]));
    const keys = [...buckets.keys()].sort().reverse();
    const reversed: Array<Record<string, unknown>> = [];
    for (const key of keys) {
      reversed.push({
        bucket: key,
        tiers: tiers.map((tier) => ({ code: tier.code, count: counts.get(tier.code) ?? 0 })),
      });
      for (const transition of buckets.get(key) ?? []) {
        if (transition.toTierCode)
          counts.set(
            transition.toTierCode,
            Math.max(0, (counts.get(transition.toTierCode) ?? 0) - 1),
          );
        if (transition.fromTierCode)
          counts.set(transition.fromTierCode, (counts.get(transition.fromTierCode) ?? 0) + 1);
      }
    }
    return reversed.reverse();
  }

  private performanceTrend(
    earningRows: Array<{ amount: Prisma.Decimal; createdAt: Date }>,
    bookingRows: Array<{ status: string; createdAt: Date }>,
    granularity: 'day' | 'month',
  ) {
    const bucket = (date: Date) =>
      granularity === 'day' ? date.toISOString().slice(0, 10) : date.toISOString().slice(0, 7);
    const map = new Map<string, { earnings: number; completed: number; cancelled: number }>();
    for (const row of earningRows) {
      const key = bucket(row.createdAt);
      const item = map.get(key) ?? { earnings: 0, completed: 0, cancelled: 0 };
      item.earnings += Number(row.amount);
      map.set(key, item);
    }
    for (const row of bookingRows) {
      const key = bucket(row.createdAt);
      const item = map.get(key) ?? { earnings: 0, completed: 0, cancelled: 0 };
      if (row.status === 'completed') item.completed += 1;
      if (row.status === 'cancelled') item.cancelled += 1;
      map.set(key, item);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => ({
        bucket: key,
        settledEarnings: money(value.earnings),
        completionRate: percentage(value.completed, value.completed + value.cancelled),
      }));
  }

  private serializeTier(
    tier: {
      id: string;
      code: string;
      name: string;
      rank: number;
      description: string | null;
      requirements?: unknown;
      isActive?: boolean;
      translations?: EliteTranslation[];
    },
    locale?: string,
  ) {
    const selected = locale
      ? this.locales.selectTranslation(tier.translations ?? [], locale)
      : undefined;
    return {
      id: tier.id,
      code: tier.code,
      name: selected?.translation?.name ?? tier.name,
      rank: tier.rank,
      description: selected?.translation?.description ?? tier.description,
      requirements: 'requirements' in tier ? tier.requirements : null,
      isActive: 'isActive' in tier ? tier.isActive : true,
      ...(locale
        ? {
            resolvedLocale: selected?.translation ? selected.resolvedLocale : 'canonical',
            translationFallback: selected?.translation ? selected.fallback : true,
          }
        : { translations: tier.translations ?? [] }),
    };
  }

  private serializeBenefit(
    benefit: {
      id: string;
      code: string;
      name: string;
      description: string | null;
      displayValue: string | null;
      metadata: unknown;
      isActive: boolean;
      sortOrder: number;
      translations?: Array<EliteTranslation & { displayValue: string | null }>;
    },
    locale?: string,
  ) {
    const selected = locale
      ? this.locales.selectTranslation(benefit.translations ?? [], locale)
      : undefined;
    return {
      id: benefit.id,
      code: benefit.code,
      name: selected?.translation?.name ?? benefit.name,
      description: selected?.translation?.description ?? benefit.description,
      displayValue: selected?.translation?.displayValue ?? benefit.displayValue,
      metadata: benefit.metadata,
      isActive: benefit.isActive,
      sortOrder: benefit.sortOrder,
      ...(locale
        ? {
            resolvedLocale: selected?.translation ? selected.resolvedLocale : 'canonical',
            translationFallback: selected?.translation ? selected.fallback : true,
          }
        : { translations: benefit.translations ?? [] }),
    };
  }

  private serializeBadge(
    badge: {
      id: string;
      code: string;
      name: string;
      description: string | null;
      assetUrl: string | null;
      criteria: unknown;
      isActive: boolean;
      tier?: { code: string; name: string } | null;
      translations?: EliteTranslation[];
    },
    locale?: string,
  ) {
    const selected = locale
      ? this.locales.selectTranslation(badge.translations ?? [], locale)
      : undefined;
    return {
      id: badge.id,
      code: badge.code,
      name: selected?.translation?.name ?? badge.name,
      description: selected?.translation?.description ?? badge.description,
      assetUrl: badge.assetUrl,
      criteria: badge.criteria,
      isActive: badge.isActive,
      tier: badge.tier ? { code: badge.tier.code, name: badge.tier.name } : null,
      ...(locale
        ? {
            resolvedLocale: selected?.translation ? selected.resolvedLocale : 'canonical',
            translationFallback: selected?.translation ? selected.fallback : true,
          }
        : { translations: badge.translations ?? [] }),
    };
  }

  private normalizeTranslations(translations: TranslationDto[] | undefined): EliteTranslation[] {
    const normalized = (translations ?? []).map((translation) => ({
      locale: this.locales.requireSupported(translation.locale),
      name: translation.name.trim(),
      description: translation.description?.trim() || null,
    }));
    if (new Set(normalized.map((translation) => translation.locale)).size !== normalized.length) {
      throw new BadRequestException({
        code: 'DUPLICATE_TRANSLATION_LOCALE',
        message: 'Each locale may appear only once in translations',
      });
    }
    return normalized;
  }

  private normalizeBenefitTranslations(
    translations: EliteBenefitTranslationDto[] | undefined,
  ): Array<EliteTranslation & { displayValue: string | null }> {
    return this.normalizeTranslations(translations).map((translation) => ({
      ...translation,
      displayValue:
        translations
          ?.find((item) => this.locales.requireSupported(item.locale) === translation.locale)
          ?.displayValue?.trim() || null,
    }));
  }

  private async upsertTierTranslations(
    tx: Prisma.TransactionClient,
    tierId: string,
    translations: EliteTranslation[],
    canonical: { name: string; description: string | null },
  ): Promise<void> {
    const rows = this.withCanonical(translations, canonical);
    for (const row of rows) {
      await tx.eliteTierTranslation.upsert({
        where: { tierId_locale: { tierId, locale: row.locale } },
        create: { tierId, ...row },
        update: { name: row.name, description: row.description },
      });
    }
  }

  private async upsertBenefitTranslations(
    tx: Prisma.TransactionClient,
    benefitId: string,
    translations: Array<EliteTranslation & { displayValue: string | null }>,
    canonical: { name: string; description: string | null; displayValue: string | null },
  ): Promise<void> {
    const byLocale = new Map(translations.map((row) => [row.locale, row]));
    byLocale.set(this.locales.defaultLocale, {
      locale: this.locales.defaultLocale,
      ...canonical,
    });
    for (const row of byLocale.values()) {
      const data = {
        name: row.name,
        description: row.description,
        displayValue: row.displayValue,
      };
      await tx.eliteBenefitTranslation.upsert({
        where: { benefitId_locale: { benefitId, locale: row.locale } },
        create: { benefitId, locale: row.locale, ...data },
        update: data,
      });
    }
  }

  private async upsertBadgeTranslations(
    tx: Prisma.TransactionClient,
    badgeId: string,
    translations: EliteTranslation[],
    canonical: { name: string; description: string | null },
  ): Promise<void> {
    for (const row of this.withCanonical(translations, canonical)) {
      await tx.eliteBadgeTranslation.upsert({
        where: { badgeId_locale: { badgeId, locale: row.locale } },
        create: { badgeId, ...row },
        update: { name: row.name, description: row.description },
      });
    }
  }

  private withCanonical(
    translations: EliteTranslation[],
    canonical: { name: string; description: string | null },
  ): EliteTranslation[] {
    const byLocale = new Map(translations.map((row) => [row.locale, row]));
    byLocale.set(this.locales.defaultLocale, {
      locale: this.locales.defaultLocale,
      ...canonical,
    });
    return [...byLocale.values()];
  }

  private serializeRequest(request: {
    id: string;
    kind: string;
    fromTierCode: string | null;
    toTierCode: string | null;
    status: string;
    reason: string | null;
    decisionReason: string | null;
    metricsSnapshot: unknown;
    requirementsSnapshot: unknown;
    createdAt: Date;
    updatedAt: Date;
    decidedAt: Date | null;
    cancelledAt: Date | null;
  }) {
    return {
      id: request.id,
      kind: request.kind,
      fromTier: request.fromTierCode,
      toTier: request.toTierCode,
      status: request.status,
      reason: request.reason,
      decisionReason: request.decisionReason,
      metricsSnapshot: request.metricsSnapshot,
      requirementsSnapshot: request.requirementsSnapshot,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
      decidedAt: request.decidedAt?.toISOString() ?? null,
      cancelledAt: request.cancelledAt?.toISOString() ?? null,
    };
  }

  private evaluateEligibility(
    metrics: MetricsSnapshot,
    rawRequirements: unknown,
  ): {
    score: number | null;
    eligible: boolean | null;
    requirements: EliteTierRequirements | null;
    checks: EligibilityCheck[];
  } {
    const requirements = this.parseRequirements(rawRequirements);
    if (!requirements || !Object.keys(requirements).length) {
      return { score: null, eligible: null, requirements, checks: [] };
    }

    const checks: EligibilityCheck[] = [];
    const addMinimum = (
      key: 'minRating' | 'minCompletedTasks' | 'minCompletionRate' | 'minSettledEarnings',
      actual: number,
      required: number | undefined,
    ) => {
      if (required === undefined) return;
      const passed = actual >= required;
      const score = required <= 0 ? 100 : Math.min(100, (actual / required) * 100);
      checks.push({ key, actual, required, operator: 'gte', passed, score: this.round(score) });
    };
    addMinimum('minRating', metrics.rating, requirements.minRating);
    addMinimum('minCompletedTasks', metrics.completedTasks, requirements.minCompletedTasks);
    addMinimum('minCompletionRate', metrics.completionRate, requirements.minCompletionRate);
    addMinimum('minSettledEarnings', metrics.settledEarnings, requirements.minSettledEarnings);

    if (requirements.maxOpenComplaints !== undefined) {
      const required = requirements.maxOpenComplaints;
      const actual = metrics.openComplaints;
      const passed = actual <= required;
      const score = passed ? 100 : required <= 0 ? 0 : Math.min(100, (required / actual) * 100);
      checks.push({
        key: 'maxOpenComplaints',
        actual,
        required,
        operator: 'lte',
        passed,
        score: this.round(score),
      });
    }

    if (!checks.length) return { score: null, eligible: null, requirements, checks };
    return {
      score: this.round(checks.reduce((sum, check) => sum + check.score, 0) / checks.length),
      eligible: checks.every((check) => check.passed),
      requirements,
      checks,
    };
  }

  private parseRequirements(value: unknown): EliteTierRequirements | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const source = value as Record<string, unknown>;
    const readNumber = (key: keyof EliteTierRequirements): number | undefined => {
      const raw = source[key];
      return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
    };
    const minRating = readNumber('minRating');
    const minCompletedTasks = readNumber('minCompletedTasks');
    const minCompletionRate = readNumber('minCompletionRate');
    const maxOpenComplaints = readNumber('maxOpenComplaints');
    const minSettledEarnings = readNumber('minSettledEarnings');
    const requirements: EliteTierRequirements = {
      ...(minRating === undefined ? {} : { minRating }),
      ...(minCompletedTasks === undefined ? {} : { minCompletedTasks }),
      ...(minCompletionRate === undefined ? {} : { minCompletionRate }),
      ...(maxOpenComplaints === undefined ? {} : { maxOpenComplaints }),
      ...(minSettledEarnings === undefined ? {} : { minSettledEarnings }),
    };
    return requirements;
  }

  private asMetricsSnapshot(value: unknown): MetricsSnapshot | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const source = value as Record<string, unknown>;
    const rating = source.rating;
    const completedTasks = source.completedTasks;
    const completionRate = source.completionRate;
    const settledEarnings = source.settledEarnings;
    const openComplaints = source.openComplaints;
    if (
      typeof rating !== 'number' ||
      !Number.isFinite(rating) ||
      typeof completedTasks !== 'number' ||
      !Number.isFinite(completedTasks) ||
      typeof completionRate !== 'number' ||
      !Number.isFinite(completionRate) ||
      typeof settledEarnings !== 'number' ||
      !Number.isFinite(settledEarnings) ||
      typeof openComplaints !== 'number' ||
      !Number.isFinite(openComplaints)
    )
      return null;
    return {
      rating,
      completedTasks,
      completionRate,
      settledEarnings,
      openComplaints,
      measuredAt: typeof source.measuredAt === 'string' ? source.measuredAt : '',
    };
  }

  private round(value: number): number {
    return Math.round((value + Number.EPSILON) * 10) / 10;
  }

  private normalizeCode(value: string): string {
    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!normalized) throw new BadRequestException('A valid code is required');
    return normalized;
  }

  private normalizeTierCode(value: string): EliteTierCode {
    const normalized = value.trim().toLowerCase();
    if (!ELITE_TIER_CODES.includes(normalized as EliteTierCode)) {
      throw new BadRequestException(`Unknown Elite tier: ${value}`);
    }
    return normalized as EliteTierCode;
  }

  private rangeView(range: {
    from: Date | null;
    toExclusive: Date | null;
    range: string;
    granularity: string;
  }) {
    return {
      range: range.range,
      from: range.from?.toISOString() ?? null,
      toExclusive: range.toExclusive?.toISOString() ?? null,
      granularity: range.granularity,
    };
  }

  private toCsv(rows: Array<Record<string, unknown>>): string {
    if (!rows.length) return '';
    const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const escape = (value: unknown): string => {
      const raw =
        value === null || value === undefined
          ? ''
          : typeof value === 'object'
            ? JSON.stringify(value)
            : String(value);
      return `"${raw.replace(/"/g, '""')}"`;
    };
    return [
      headers.map(escape).join(','),
      ...rows.map((row) => headers.map((header) => escape(row[header])).join(',')),
    ].join('\n');
  }
}
