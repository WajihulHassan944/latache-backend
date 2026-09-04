import { Injectable, NotFoundException } from '@nestjs/common';
import { SERVICE_ICON_OPTIONS } from '../../../common/constants/service-icon.constant';
import { normalizePagination } from '../../../common/utils/pagination.util';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { PlatformSettingsService } from '../../platform-settings/platform-settings.service';
import type { AdminServicesQueryDto } from '../dto/admin-services.dto';

@Injectable()
export class AdminServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformSettings: PlatformSettingsService,
  ) {}

  async read(query: AdminServicesQueryDto): Promise<Record<string, unknown>> {
    if (query.view === 'pricing') {
      return this.pricing();
    }
    if (query.view === 'icons') {
      return this.icons();
    }
    return this.catalog(query);
  }

  /**
   * Static catalogue (no DB read) so the admin create/edit-service form can
   * populate its icon picker from the same list the backend validates
   * Service.icon against - the two can never drift out of sync.
   */
  private icons(): Record<string, unknown> {
    return { view: 'icons', icons: SERVICE_ICON_OPTIONS };
  }

  async detail(serviceId: number): Promise<Record<string, unknown>> {
    const service = await this.prisma.service.findUnique({
      where: { id: serviceId },
      include: {
        translations: { orderBy: { locale: 'asc' } },
        options: {
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: { translations: { orderBy: { locale: 'asc' } } },
        },
        userServices: {
          where: {
            user: {
              roles: { has: 'tasker' },
              accountStatus: 'active',
              onboardingStatus: 'approved',
              deletedAt: null,
              taskerProfile: { is: { status: 'active' } },
            },
          },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                profilePicture: true,
                rating: true,
                reviewsCount: true,
                completedTasks: true,
                isElite: true,
                eliteTier: { select: { code: true, name: true } },
              },
            },
          },
          orderBy: { hourlyRate: 'asc' },
        },
        _count: { select: { bookings: true } },
      },
    });
    if (!service) throw new NotFoundException('Service category not found');

    const activeOptions = service.options.filter((option) => option.isActive).length;
    return {
      category: {
        id: String(service.id),
        name: service.name,
        slug: service.slug,
        description: service.description,
        icon: service.icon,
        isActive: service.isActive,
        sortOrder: service.sortOrder,
        createdAt: service.createdAt,
        updatedAt: service.updatedAt,
        translations: service.translations,
      },
      summary: {
        subServices: service.options.length,
        activeSubServices: activeOptions,
        activeTaskers: service.userServices.length,
        bookings: service._count.bookings,
      },
      subServices: service.options.map((option) => ({
        id: String(option.id),
        name: option.name,
        slug: option.slug,
        description: option.description,
        isActive: option.isActive,
        sortOrder: option.sortOrder,
        createdAt: option.createdAt,
        updatedAt: option.updatedAt,
        translations: option.translations,
      })),
      taskers: service.userServices.map((assignment) => ({
        assignmentId: String(assignment.id),
        taskerId: String(assignment.user.id),
        name: `${assignment.user.firstName ?? ''} ${assignment.user.lastName ?? ''}`.trim(),
        profilePicture: assignment.user.profilePicture ?? '',
        hourlyRate: Number(assignment.hourlyRate),
        rating: Number(assignment.user.rating),
        reviewsCount: assignment.user.reviewsCount,
        completedTasks: assignment.user.completedTasks,
        isElite: assignment.user.isElite,
        eliteTier: assignment.user.eliteTier,
      })),
      mutations: {
        updateCategory: `PATCH /api/services/${service.id}`,
        deactivateCategory: `DELETE /api/services/${service.id}`,
        createSubService: `POST /api/services/${service.id}/options`,
        updateSubService: `PATCH /api/services/${service.id}/options/:optionId`,
        deactivateSubService: `DELETE /api/services/${service.id}/options/:optionId`,
        note: 'Tasker assignments/rates remain owned by the Tasker skills/onboarding flow; this admin view does not create a second assignment source of truth.',
      },
    };
  }

  private async catalog(query: AdminServicesQueryDto): Promise<Record<string, unknown>> {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    const search = query.search?.trim();
    const status = query.status ?? 'all';
    const where: Prisma.ServiceWhereInput = {
      ...(status === 'active'
        ? { isActive: true }
        : status === 'inactive'
          ? { isActive: false }
          : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { slug: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
              {
                translations: {
                  some: {
                    OR: [
                      { name: { contains: search, mode: 'insensitive' } },
                      { description: { contains: search, mode: 'insensitive' } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [totalItems, rows, totalCategories, activeCategories, optionTotals, activeAssignments] =
      await Promise.all([
        this.prisma.service.count({ where }),
        this.prisma.service.findMany({
          where,
          skip: offset,
          take: limit,
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          include: {
            translations: { orderBy: { locale: 'asc' } },
            options: { select: { id: true, isActive: true } },
            userServices: {
              where: {
                user: {
                  roles: { has: 'tasker' },
                  accountStatus: 'active',
                  onboardingStatus: 'approved',
                  deletedAt: null,
                  taskerProfile: { is: { status: 'active' } },
                },
              },
              select: { userId: true },
            },
            _count: { select: { bookings: true } },
          },
        }),
        this.prisma.service.count(),
        this.prisma.service.count({ where: { isActive: true } }),
        this.prisma.serviceOption.groupBy({
          by: ['isActive'],
          _count: { _all: true },
        }),
        this.prisma.userService.findMany({
          where: {
            service: { isActive: true },
            user: {
              roles: { has: 'tasker' },
              accountStatus: 'active',
              onboardingStatus: 'approved',
              deletedAt: null,
              taskerProfile: { is: { status: 'active' } },
            },
          },
          distinct: ['userId'],
          select: { userId: true },
        }),
      ]);

    const totalOptions = optionTotals.reduce((sum, row) => sum + row._count._all, 0);
    const activeOptions = optionTotals.find((row) => row.isActive)?._count._all ?? 0;

    return {
      view: 'catalog',
      summary: {
        totalCategories,
        activeCategories,
        inactiveCategories: Math.max(0, totalCategories - activeCategories),
        subServices: totalOptions,
        activeSubServices: activeOptions,
        activeTaskers: activeAssignments.length,
      },
      items: rows.map((service) => ({
        id: String(service.id),
        name: service.name,
        slug: service.slug,
        description: service.description,
        icon: service.icon,
        isActive: service.isActive,
        sortOrder: service.sortOrder,
        subServices: service.options.length,
        activeSubServices: service.options.filter((option) => option.isActive).length,
        activeTaskers: new Set(service.userServices.map((assignment) => assignment.userId)).size,
        bookings: service._count.bookings,
        updatedAt: service.updatedAt,
        translations: service.translations,
      })),
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      mutations: {
        createCategory: 'POST /api/services',
        manageCategory: 'PATCH|DELETE /api/services/:serviceId',
        manageSubServices: 'POST|PATCH|DELETE /api/services/:serviceId/options[/ :optionId]',
      },
    };
  }

  private async pricing(): Promise<Record<string, unknown>> {
    const settings = await this.platformSettings.view('commission,tax,eliteProgram');
    const commission = settings.commission as Record<string, unknown>;
    const tax = settings.tax as Record<string, unknown>;
    const eliteProgram = settings.eliteProgram as Record<string, unknown>;

    const tiers = [
      {
        code: 'standard',
        label: 'Standard',
        platformFeePercent: Number(commission.standardRatePercent ?? 0),
        minimumTaskPrice: Number(commission.standardMinTaskPrice ?? 0),
      },
      {
        code: 'gold',
        label: 'Elite Gold',
        platformFeePercent: Number(commission.goldRatePercent ?? 0),
        minimumTaskPrice: Number(commission.goldMinTaskPrice ?? 0),
      },
      {
        code: 'platinum',
        label: 'Elite Platinum',
        platformFeePercent: Number(commission.platinumRatePercent ?? 0),
        minimumTaskPrice: Number(commission.platinumMinTaskPrice ?? 0),
      },
      {
        code: 'diamond',
        label: 'Elite Diamond',
        platformFeePercent: Number(commission.diamondRatePercent ?? 0),
        minimumTaskPrice: Number(commission.diamondMinTaskPrice ?? 0),
      },
    ];

    return {
      view: 'pricing',
      tiers,
      urgencyRules: {
        sameDayPlatformFeeSurchargePercent: Number(commission.sameDaySurchargePercent ?? 0),
        weekendPlatformFeeSurchargePercent: Number(commission.weekendSurchargePercent ?? 0),
        emergencyPricingAvailable: false,
        note: 'Same-day/weekend values are platform-fee surcharges used by the existing pricing engine. Emergency booking remains unavailable until an actual emergency-booking lifecycle exists.',
      },
      tax: {
        mode: tax.mode ?? 'disabled',
        defaultRatePercent: Number(tax.defaultRatePercent ?? 0),
        serviceSurchargeAmount: Number(tax.serviceSurchargeAmount ?? 0),
        inclusivePricing: Boolean(tax.inclusivePricing ?? false),
      },
      eliteProgram,
      capabilities: {
        minimumTaskPriceEnforcedInQuote: true,
        minimumTaskPriceEnforcedInFinalCharge: true,
        commissionEnforcedInFinalCharge: true,
        bookingPriorityRoutingEnforced: false,
        categoryOverridesAvailable: true,
      },
      managedBy: {
        commissionAndTax: 'PUT /api/admin/platform-settings',
        eliteProgram: '/api/admin/elite-taskers/program',
      },
    };
  }
}
