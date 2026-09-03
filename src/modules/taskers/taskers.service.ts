import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '../../common/enums/user-role.enum';
import { hasUserRole } from '../../common/utils/user-role.util';
import {
  dateOnlyFromDate,
  dateOnlyToDate,
  isFutureDate,
  todayDateOnly,
} from '../../common/utils/date.util';
import { parseTimeToMinutes, rangesOverlap } from '../../common/utils/time.util';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { ListTaskersQueryDto } from './dto/list-taskers-query.dto';
import { PublicTaskerReviewsQueryDto } from './dto/public-tasker-reviews-query.dto';
import { ReviewsService } from '../reviews/reviews.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { AvailabilitySlotDto, SubmitOnboardingDto } from './dto/submit-onboarding.dto';
import { TaskersRepository } from './taskers.repository';

@Injectable()
export class TaskersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: TaskersRepository,
    private readonly reviews: ReviewsService,
    private readonly platformSettings: PlatformSettingsService,
  ) {}

  async submitOnboarding(userId: number, dto: SubmitOnboardingDto) {
    this.validateAvailability(dto.availability);
    const requestedSlugs = dto.services.map((service) => service.slug);
    const duplicates = requestedSlugs.filter(
      (slug, index) => requestedSlugs.indexOf(slug) !== index,
    );
    if (duplicates.length) {
      throw new BadRequestException(
        `Duplicate service(s) in request: ${[...new Set(duplicates)].join(', ')}`,
      );
    }

    const submittedAt = new Date();
    await this.prisma.$transaction(async (transaction) => {
      const lockedUsers = await transaction.$queryRaw<Array<{ id: number }>>`
        SELECT "id" FROM "Users" WHERE "id" = ${userId} FOR UPDATE
      `;
      if (lockedUsers.length === 0) throw new NotFoundException('User not found');
      const user = await transaction.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');
      if (!hasUserRole(user, UserRole.Tasker)) {
        throw new ForbiddenException('Only taskers can submit onboarding applications');
      }

      const initialServiceRecords = await this.repository.findServicesBySlugs(
        requestedSlugs,
        transaction,
      );
      const serviceIds = [...new Set(initialServiceRecords.map((service) => service.id))].sort(
        (left, right) => left - right,
      );
      if (serviceIds.length) {
        await transaction.$queryRaw(
          Prisma.sql`SELECT "id" FROM "Services" WHERE "id" IN (${Prisma.join(
            serviceIds,
          )}) ORDER BY "id" FOR SHARE`,
        );
      }
      const serviceRecords = await this.repository.findServicesBySlugs(requestedSlugs, transaction);
      const currency = await this.platformSettings.currencyContext(transaction);
      const serviceBySlug = new Map(
        serviceRecords.filter((service) => service.slug).map((service) => [service.slug as string, service]),
      );
      const canonicalRateBySlug = new Map<string, number>();
      for (const requested of dto.services) {
        const service = serviceBySlug.get(requested.slug);
        if (!service) continue;
        const canonicalRate = this.platformSettings.convertPlatformAmountToUsd(
          requested.hourlyRate,
          currency,
        );
        const minimum = Number(service.minHourlyRateUsd);
        const maximum = Number(service.maxHourlyRateUsd);
        if (canonicalRate < minimum || canonicalRate > maximum) {
          throw new BadRequestException({
            code: 'TASKER_RATE_OUT_OF_SERVICE_RANGE',
            message: `Rate for ${requested.slug} must be between ${currency.symbol}${this.platformSettings.convertUsdAmount(minimum, currency)} and ${currency.symbol}${this.platformSettings.convertUsdAmount(maximum, currency)}.`,
            serviceSlug: requested.slug,
            minimumHourlyRate: this.platformSettings.convertUsdAmount(minimum, currency),
            maximumHourlyRate: this.platformSettings.convertUsdAmount(maximum, currency),
            currency: currency.code,
          });
        }
        canonicalRateBySlug.set(requested.slug, canonicalRate);
      }
      const serviceIdBySlug = new Map<string, number>();
      for (const service of serviceRecords) {
        if (service.slug && !serviceIdBySlug.has(service.slug)) {
          serviceIdBySlug.set(service.slug, service.id);
        }
      }
      const missingSlugs = requestedSlugs.filter((slug) => !serviceIdBySlug.has(slug));
      if (missingSlugs.length) {
        throw new BadRequestException(`Unknown service(s): ${missingSlugs.join(', ')}`);
      }

      await transaction.$queryRaw`
        SELECT "id" FROM "UserAvailabilities" WHERE "userId" = ${userId} FOR UPDATE
      `;
      const existingSlots = await transaction.userAvailability.findMany({
        where: { userId },
      });
      const existingIds = existingSlots.map((slot) => slot.id);
      const referencedBookings = existingIds.length
        ? await transaction.booking.findMany({
            where: { availabilityId: { in: existingIds } },
            select: { availabilityId: true },
          })
        : [];
      const referencedIds = new Set(referencedBookings.map((booking) => booking.availabilityId));
      const today = todayDateOnly();
      const preserved = existingSlots.filter((slot) => {
        const date = dateOnlyFromDate(slot.date);
        return slot.isBooked || referencedIds.has(slot.id) || date <= today;
      });

      const requestedToCreate = dto.availability.filter((requested) => {
        const exactPreserved = preserved.find(
          (slot) =>
            dateOnlyFromDate(slot.date) === requested.date &&
            parseTimeToMinutes(slot.startTime) === parseTimeToMinutes(requested.startTime) &&
            parseTimeToMinutes(slot.endTime) === parseTimeToMinutes(requested.endTime),
        );
        if (exactPreserved) return false;

        const conflicting = preserved.find(
          (slot) =>
            dateOnlyFromDate(slot.date) === requested.date && rangesOverlap(slot, requested),
        );
        if (conflicting) {
          throw new ConflictException(
            `Availability ${requested.date} ${requested.startTime}-${requested.endTime} overlaps an existing booked or historical slot`,
          );
        }
        return true;
      });

      const deletableIds = existingSlots
        .filter((slot) => {
          const date = dateOnlyFromDate(slot.date);
          return date > today && !slot.isBooked && !referencedIds.has(slot.id);
        })
        .map((slot) => slot.id);
      if (deletableIds.length) {
        await transaction.userAvailability.deleteMany({
          where: { id: { in: deletableIds } },
        });
      }
      if (requestedToCreate.length) {
        await transaction.userAvailability.createMany({
          data: requestedToCreate.map((slot) => ({
            userId,
            date: dateOnlyToDate(slot.date),
            startTime: slot.startTime,
            endTime: slot.endTime,
          })),
        });
      }

      await transaction.userService.deleteMany({ where: { userId } });
      await transaction.userService.createMany({
        data: dto.services.map((service) => ({
          userId,
          serviceId: serviceIdBySlug.get(service.slug) as number,
          hourlyRate: (canonicalRateBySlug.get(service.slug) as number).toFixed(2),
        })),
      });

      await transaction.taskerProfile.upsert({
        where: { userId },
        create: { userId, status: 'pending_approval' },
        update: { status: 'pending_approval', rejectedAt: null, statusReason: null },
      });

      await transaction.user.update({
        where: { id: userId },
        data: {
          yearsOfExperience: dto.yearsOfExperience,
          bio: dto.bio,
          idType: dto.identity.idType,
          identityDocument: dto.identity.document
            ? (dto.identity.document as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
          serviceAreaLabel: dto.serviceArea.label,
          serviceAreaLat: dto.serviceArea.lat,
          serviceAreaLng: dto.serviceArea.lng,
          serviceAreaRadiusKm: dto.serviceArea.radiusKm,
          serviceAreaCity: dto.serviceArea.city ?? null,
          serviceAreaArea: dto.serviceArea.area ?? null,
          onboardingStatus: 'pending_review',
          submittedAt,
        },
      });
    });

    return {
      taskerId: userId.toString(),
      status: 'pending_review',
      submittedAt: submittedAt.toISOString(),
    };
  }

  async list(query: ListTaskersQueryDto, locale: string) {
    try {
      const effectiveQuery = { ...query };
      if (query.lat !== undefined && query.lng !== undefined) {
        const policy = await this.platformSettings.serviceRadiusPolicy();
        if (policy.enforcementEnabled !== false) {
          const maximum = Number(policy.maximumRadiusKm ?? 500);
          const minimum = Number(policy.minimumRadiusKm ?? 0.1);
          const fallback = Number(policy.defaultRadiusKm ?? 20);
          if (query.radius !== undefined && (query.radius < minimum || query.radius > maximum)) {
            throw new BadRequestException(`radius must be between ${minimum} and ${maximum} km`);
          }
          effectiveQuery.radius = query.radius ?? fallback;
        }
      }
      if ((effectiveQuery.startTime !== undefined || effectiveQuery.endTime !== undefined) && !effectiveQuery.date) {
        throw new BadRequestException('date is required when filtering Taskers by availability time');
      }
      if (effectiveQuery.endTime !== undefined && effectiveQuery.startTime === undefined) {
        throw new BadRequestException('startTime is required when endTime is provided');
      }
      if (effectiveQuery.startTime !== undefined && effectiveQuery.endTime !== undefined) {
        const start = parseTimeToMinutes(effectiveQuery.startTime);
        const end = parseTimeToMinutes(effectiveQuery.endTime);
        if (start === null || end === null || start >= end) {
          throw new BadRequestException('endTime must be after startTime');
        }
      }
      const currency = await this.platformSettings.currencyContext();
      if (effectiveQuery.minPrice !== undefined) {
        effectiveQuery.minPrice = this.platformSettings.convertPlatformAmountToUsd(
          effectiveQuery.minPrice,
          currency,
        );
      }
      if (effectiveQuery.maxPrice !== undefined) {
        effectiveQuery.maxPrice = this.platformSettings.convertPlatformAmountToUsd(
          effectiveQuery.maxPrice,
          currency,
        );
      }
      const result = await this.repository.list(effectiveQuery, locale);
      return {
        ...result,
        currency: { code: currency.code, symbol: currency.symbol, market: currency.market },
        items: result.items.map((item) => ({
          ...item,
          pricePerHour: this.platformSettings.convertUsdAmount(item.pricePerHour, currency),
        })),
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'LAT_LNG_PAIR_REQUIRED') {
        throw new BadRequestException('lat and lng must be provided together');
      }
      if (error instanceof Error && error.message === 'INVALID_PRICE_RANGE') {
        throw new BadRequestException('minPrice must be less than or equal to maxPrice');
      }
      if (error instanceof Error && error.message === 'NEAREST_SORT_REQUIRES_LOCATION') {
        throw new BadRequestException('sort=nearest requires both lat and lng');
      }
      throw error;
    }
  }

  async getById(id: number, serviceSlug: string | undefined, locale: string) {
    const [tasker, currency] = await Promise.all([
      this.repository.getById(id, serviceSlug, locale),
      this.platformSettings.currencyContext(),
    ]);
    if (!tasker) throw new NotFoundException('Tasker not found');
    return {
      ...tasker,
      pricePerHour: this.platformSettings.convertUsdAmount(tasker.pricePerHour, currency),
      services: tasker.services.map((service) => ({
        ...service,
        hourlyRate: this.platformSettings.convertUsdAmount(service.hourlyRate, currency),
      })),
      currency: { code: currency.code, symbol: currency.symbol, market: currency.market },
    };
  }

  async getPublicReviews(id: number, query: PublicTaskerReviewsQueryDto) {
    const tasker = await this.prisma.user.findFirst({
      where: { id, roles: { has: UserRole.Tasker }, deletedAt: null, accountStatus: 'active', onboardingStatus: 'approved', taskerProfile: { is: { status: 'active' } } },
      select: { id: true },
    });
    if (!tasker) throw new NotFoundException('Tasker not found');
    return this.reviews.list(id, UserRole.Tasker, {
      view: 'received',
      rating: query.rating,
      page: query.page,
      limit: query.limit,
    });
  }

  async getAvailability(id: number) {
    const availability = await this.repository.getAvailability(id);
    if (!availability) throw new NotFoundException('Tasker not found');
    return availability;
  }

  private validateAvailability(slots: AvailabilitySlotDto[]): void {
    const invalidDates = slots.filter((slot) => !isFutureDate(slot.date));
    if (invalidDates.length) {
      throw new BadRequestException(
        `Availability date(s) must be after today: ${invalidDates
          .map((slot) => slot.date)
          .join(', ')}`,
      );
    }

    for (const slot of slots) {
      const start = parseTimeToMinutes(slot.startTime);
      const end = parseTimeToMinutes(slot.endTime);
      if (start === null || end === null || start >= end) {
        throw new BadRequestException(
          `Availability endTime must be after startTime for ${slot.date}`,
        );
      }
    }

    const byDate = new Map<string, AvailabilitySlotDto[]>();
    for (const slot of slots) {
      const values = byDate.get(slot.date) ?? [];
      for (const existing of values) {
        if (rangesOverlap(existing, slot)) {
          throw new BadRequestException(`Availability slots overlap on ${slot.date}`);
        }
      }
      values.push(slot);
      byDate.set(slot.date, values);
    }
  }
}
