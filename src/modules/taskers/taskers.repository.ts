import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TaskerSort } from '../../common/enums/tasker-sort.enum';
import { UserRole } from '../../common/enums/user-role.enum';
import { dateOnlyFromDate, dateOnlyToDate, todayDateOnly } from '../../common/utils/date.util';
import { formatLocation } from '../../common/utils/location.util';
import { normalizePagination } from '../../common/utils/pagination.util';
import { to12Hour, to24Hour } from '../../common/utils/time.util';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type Service } from '../../generated/prisma/client';
import { ListTaskersQueryDto } from './dto/list-taskers-query.dto';
import { LocaleService } from '../localization/locale.service';

type Numeric = number | string | { toString(): string };

interface TaskerListRow {
  id: number;
  firstName: string | null;
  lastName: string | null;
  profilePicture: string | null;
  rating: Numeric;
  reviewsCount: number;
  bio: string | null;
  completedTasks: number;
  yearsOfExperience: number | null;
  vehicles: string[] | null;
  workImages: string[] | null;
  isElite: boolean;
  serviceAreaLat: Numeric | null;
  serviceAreaLng: Numeric | null;
  serviceAreaRadiusKm: Numeric | null;
  serviceAreaCity: string | null;
  serviceAreaArea: string | null;
  submittedAt: Date | null;
  hourlyRate: Numeric;
  serviceSlug: string | null;
  distanceKm: Numeric | null;
  eliteRank: number;
  eliteSearchRank: number;
  eliteTierCode: string | null;
  eliteProfileBadgeVisible: boolean;
}

interface CountRow {
  total: number;
}

export interface AvailabilityResponseSlot {
  id: string;
  startTime: string;
  endTime: string;
  startTimeAMPM: string;
  endTimeAMPM: string;
}

const numberOrNull = (value: Numeric | null): number | null =>
  value === null ? null : Number(value);

@Injectable()
export class TaskersRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly locales: LocaleService,
  ) {}

  findServicesBySlugs(slugs: string[], transaction?: Prisma.TransactionClient): Promise<Service[]> {
    return (transaction ?? this.prisma).service.findMany({
      where: { slug: { in: slugs } },
    });
  }

  async list(query: ListTaskersQueryDto, locale = this.locales.defaultLocale) {
    if ((query.lat === undefined) !== (query.lng === undefined)) {
      throw new Error('LAT_LNG_PAIR_REQUIRED');
    }
    if (
      query.minPrice !== undefined &&
      query.maxPrice !== undefined &&
      query.minPrice > query.maxPrice
    ) {
      throw new Error('INVALID_PRICE_RANGE');
    }
    if (query.sort === TaskerSort.Nearest && (query.lat === undefined || query.lng === undefined)) {
      throw new Error('NEAREST_SORT_REQUIRES_LOCATION');
    }

    const { page, limit, offset } = normalizePagination(query.page, query.limit, 9);
    const representativeConditions: Prisma.Sql[] = [];
    const eligibleConditions: Prisma.Sql[] = [
      Prisma.sql`${UserRole.Tasker} = ANY(u."roles")`,
      Prisma.sql`u."accountStatus" = 'active'`,
      Prisma.sql`u."deletedAt" IS NULL`,
      Prisma.sql`u."onboardingStatus" = 'approved'`,
      Prisma.sql`EXISTS (
        SELECT 1 FROM "TaskerProfiles" tp
        WHERE tp."userId" = u."id" AND tp."status" = 'active'
      )`,
    ];

    if (query.serviceSlug) {
      representativeConditions.push(Prisma.sql`s."slug" = ${query.serviceSlug}`);
    }
    if (query.minPrice !== undefined) {
      representativeConditions.push(Prisma.sql`us."hourlyRate" >= ${query.minPrice}`);
    }
    if (query.maxPrice !== undefined) {
      representativeConditions.push(Prisma.sql`us."hourlyRate" <= ${query.maxPrice}`);
    }
    if (query.isElite !== undefined) {
      eligibleConditions.push(Prisma.sql`u."isElite" = ${query.isElite}`);
    }
    if (query.date) {
      if (query.startTime && query.endTime) {
        eligibleConditions.push(Prisma.sql`EXISTS (
          SELECT 1 FROM "UserAvailabilities" ua
          WHERE ua."userId" = u."id"
            AND ua."date" = ${query.date}::date
            AND ua."isBooked" = FALSE
            AND ua."startTime" <= ${query.startTime}
            AND ua."endTime" >= ${query.endTime}
        )`);
      } else if (query.startTime) {
        eligibleConditions.push(Prisma.sql`EXISTS (
          SELECT 1 FROM "UserAvailabilities" ua
          WHERE ua."userId" = u."id"
            AND ua."date" = ${query.date}::date
            AND ua."isBooked" = FALSE
            AND ua."startTime" <= ${query.startTime}
            AND ua."endTime" > ${query.startTime}
        )`);
      } else {
        eligibleConditions.push(Prisma.sql`EXISTS (
          SELECT 1 FROM "UserAvailabilities" ua
          WHERE ua."userId" = u."id"
            AND ua."date" = ${query.date}::date
            AND ua."isBooked" = FALSE
        )`);
      }
    }
    const search = query.search?.trim();
    if (search) {
      const normalizedSearch = `%${this.locales.normalizeSearchText(search)}%`;
      const rawSearch = `%${search}%`;
      eligibleConditions.push(Prisma.sql`(
        lower(concat_ws(' ', u."firstName", u."lastName")) LIKE lower(${rawSearch})
        OR lower(COALESCE(u."bio", '')) LIKE lower(${rawSearch})
        OR EXISTS (
          SELECT 1
          FROM "UserServices" search_us
          INNER JOIN "Services" search_s ON search_s."id" = search_us."serviceId"
          LEFT JOIN "ServiceTranslations" search_st
            ON search_st."serviceId" = search_s."id"
            AND search_st."locale" IN (${locale}, ${this.locales.defaultLocale})
          WHERE search_us."userId" = u."id"
            AND (
              lower(COALESCE(search_s."name", '')) LIKE lower(${rawSearch})
              OR search_st."normalizedName" LIKE ${normalizedSearch}
              OR COALESCE(search_st."normalizedDescription", '') LIKE ${normalizedSearch}
            )
        )
      )`);
    }

    if (query.lat !== undefined && query.lng !== undefined) {
      const distance = this.distanceSql(query.lat, query.lng);
      eligibleConditions.push(Prisma.sql`u."serviceAreaLat" IS NOT NULL`);
      eligibleConditions.push(Prisma.sql`u."serviceAreaLng" IS NOT NULL`);
      eligibleConditions.push(Prisma.sql`u."serviceAreaRadiusKm" IS NOT NULL`);
      eligibleConditions.push(Prisma.sql`${distance} <= ${query.radius ?? 100}`);
      eligibleConditions.push(Prisma.sql`${distance} <= u."serviceAreaRadiusKm"::float8`);
    }

    const representativeWhere = representativeConditions.length
      ? Prisma.sql`WHERE ${Prisma.join(representativeConditions, ' AND ')}`
      : Prisma.sql``;
    const representative = query.serviceSlug
      ? Prisma.sql`
          SELECT us."userId", us."hourlyRate", s."slug" AS "serviceSlug"
          FROM "UserServices" us
          INNER JOIN "Services" s ON s."id" = us."serviceId"
          ${representativeWhere}
        `
      : Prisma.sql`
          SELECT DISTINCT ON (us."userId")
            us."userId", us."hourlyRate", s."slug" AS "serviceSlug"
          FROM "UserServices" us
          INNER JOIN "Services" s ON s."id" = us."serviceId"
          ${representativeWhere}
          ORDER BY us."userId", us."hourlyRate" ASC, us."id" ASC
        `;

    const distanceExpr =
      query.lat !== undefined && query.lng !== undefined
        ? this.distanceSql(query.lat, query.lng)
        : Prisma.sql`NULL::float8`;

    const cte = Prisma.sql`
      WITH representative AS (${representative}),
      eligible AS (
        SELECT
          u."id", u."firstName", u."lastName", u."profilePicture", u."rating",
          u."reviewsCount", u."bio", u."completedTasks", u."yearsOfExperience", u."vehicles", u."workImages",
          u."isElite", u."serviceAreaLat", u."serviceAreaLng", u."serviceAreaRadiusKm",
          u."serviceAreaCity", u."serviceAreaArea", u."submittedAt",
          representative."hourlyRate", representative."serviceSlug",
          ${distanceExpr} AS "distanceKm",
          COALESCE(et."rank", 0)::int AS "eliteRank",
          CASE WHEN EXISTS (
            SELECT 1 FROM "EliteBenefits" eb
            WHERE eb."tierId" = et."id" AND eb."code" = 'search_priority_boost' AND eb."isActive" = TRUE
          ) THEN COALESCE(et."rank", 0)::int ELSE 0 END AS "eliteSearchRank",
          et."code" AS "eliteTierCode",
          EXISTS (
            SELECT 1 FROM "EliteBenefits" eb
            WHERE eb."tierId" = et."id" AND eb."code" = 'elite_profile_badge' AND eb."isActive" = TRUE
          ) AS "eliteProfileBadgeVisible"
        FROM "Users" u
        INNER JOIN representative ON representative."userId" = u."id"
        LEFT JOIN "EliteTiers" et ON et."id" = u."eliteTierId" AND et."isActive" = TRUE
        WHERE ${Prisma.join(eligibleConditions, ' AND ')}
      )
    `;

    const orderBy: Record<TaskerSort | 'default', string> = {
      [TaskerSort.PriceAscending]: '"hourlyRate" ASC, "eliteSearchRank" DESC, "rating" DESC, "id" ASC',
      [TaskerSort.PriceDescending]: '"hourlyRate" DESC, "eliteSearchRank" DESC, "rating" DESC, "id" ASC',
      [TaskerSort.RatingDescending]: '"rating" DESC, "eliteSearchRank" DESC, "completedTasks" DESC, "id" ASC',
      [TaskerSort.CompletedDescending]: '"completedTasks" DESC, "eliteSearchRank" DESC, "rating" DESC, "id" ASC',
      [TaskerSort.Nearest]: '"distanceKm" ASC NULLS LAST, "eliteSearchRank" DESC, "rating" DESC, "id" ASC',
      default: '"eliteSearchRank" DESC, "rating" DESC, "completedTasks" DESC, "submittedAt" DESC NULLS LAST, "id" DESC',
    };
    const selectedOrder = query.sort ? orderBy[query.sort] : orderBy.default;

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRaw<TaskerListRow[]>(
        Prisma.sql`${cte}
          SELECT * FROM eligible
          ORDER BY ${Prisma.raw(selectedOrder)}
          LIMIT ${limit} OFFSET ${offset}
        `,
      ),
      this.prisma.$queryRaw<CountRow[]>(
        Prisma.sql`${cte} SELECT COUNT(*)::int AS total FROM eligible`,
      ),
    ]);
    const totalItems = countRows[0]?.total ?? 0;

    return {
      items: rows.map((row) => ({
        id: row.id.toString(),
        name: `${row.firstName || ''} ${row.lastName || ''}`.trim(),
        avatar: row.profilePicture || '',
        rating: Number(row.rating),
        reviewsCount: row.reviewsCount,
        pricePerHour: Number(row.hourlyRate),
        bio: row.bio || '',
        completedTasks: row.completedTasks,
        yearsOfExperience: row.yearsOfExperience,
        vehicles: row.vehicles || [],
        serviceSlug: row.serviceSlug ?? '',
        workImages: row.workImages || [],
        isElite: row.isElite,
        eliteTier: row.eliteTierCode ? { code: row.eliteTierCode, rank: row.eliteRank } : null,
        eliteProfileBadgeVisible: Boolean(row.eliteProfileBadgeVisible),
        distanceKm: row.distanceKm === null ? null : Math.round(Number(row.distanceKm) * 10) / 10,
        location: formatLocation({
          lat: numberOrNull(row.serviceAreaLat),
          lng: numberOrNull(row.serviceAreaLng),
          city: row.serviceAreaCity,
          area: row.serviceAreaArea,
          radiusKm: numberOrNull(row.serviceAreaRadiusKm),
        }),
      })),
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
    };
  }

  async getById(id: number, serviceSlug?: string, locale = this.locales.defaultLocale) {
    const user = await this.prisma.user.findFirst({
      where: { id, roles: { has: UserRole.Tasker }, accountStatus: 'active', deletedAt: null, onboardingStatus: 'approved', taskerProfile: { is: { status: 'active' } } },
      include: {
        eliteTier: {
          select: {
            code: true,
            name: true,
            rank: true,
            benefits: {
              where: { isActive: true, code: { in: ['elite_profile_badge', 'search_priority_boost', 'tier_commission_policy'] } },
              select: { code: true },
            },
          },
        },
        userServices: {
          include: {
            service: {
              include: {
                translations: {
                  where: { locale: { in: [locale, this.locales.defaultLocale] } },
                },
              },
            },
          },
        },
      },
    });
    if (!user) return null;

    const pricedServices = user.userServices.filter((entry) => entry.service.slug !== null);
    if (!pricedServices.length) return null;
    const cheapest = pricedServices.reduce((current, candidate) =>
      Number(candidate.hourlyRate) < Number(current.hourlyRate) ? candidate : current,
    );
    const primary = serviceSlug
      ? (pricedServices.find((entry) => entry.service.slug === serviceSlug) ?? cheapest)
      : cheapest;

    return {
      id: user.id.toString(),
      name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
      avatar: user.profilePicture || '',
      rating: Number(user.rating),
      reviewsCount: user.reviewsCount,
      pricePerHour: Number(primary.hourlyRate),
      bio: user.bio || '',
      completedTasks: user.completedTasks,
      yearsOfExperience: user.yearsOfExperience,
      vehicles: user.vehicles,
      serviceSlug: primary.service.slug ?? '',
      services: pricedServices.map((entry) => ({
        id: entry.service.id.toString(),
        name:
          this.locales.selectTranslation(entry.service.translations, locale).translation?.name ??
          entry.service.name ??
          '',
        slug: entry.service.slug ?? '',
        icon: entry.service.icon ?? '',
        hourlyRate: Number(entry.hourlyRate),
      })),
      workImages: user.workImages,
      isElite: user.isElite,
      eliteTier: user.eliteTier
        ? { code: user.eliteTier.code, name: user.eliteTier.name, rank: user.eliteTier.rank }
        : null,
      elitePerks: user.eliteTier?.benefits.map((benefit) => benefit.code) ?? [],
      eliteProfileBadgeVisible:
        user.eliteTier?.benefits.some((benefit) => benefit.code === 'elite_profile_badge') ?? false,
      location: formatLocation({
        lat: user.serviceAreaLat === null ? null : Number(user.serviceAreaLat),
        lng: user.serviceAreaLng === null ? null : Number(user.serviceAreaLng),
        city: user.serviceAreaCity,
        area: user.serviceAreaArea,
        radiusKm: user.serviceAreaRadiusKm === null ? null : Number(user.serviceAreaRadiusKm),
      }),
      ...(user.aboutMe ? { aboutMe: user.aboutMe } : {}),
      ...(user.skills.length ? { skills: user.skills } : {}),
    };
  }

  async getAvailability(id: number) {
    const user = await this.prisma.user.findFirst({
      where: { id, roles: { has: UserRole.Tasker }, accountStatus: 'active', deletedAt: null, onboardingStatus: 'approved', taskerProfile: { is: { status: 'active' } } },
      select: { id: true },
    });
    if (!user) return null;

    const slots = await this.prisma.userAvailability.findMany({
      where: {
        userId: id,
        isBooked: false,
        date: { gt: dateOnlyToDate(todayDateOnly()) },
      },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });
    const dayMap = new Map<string, AvailabilityResponseSlot[]>();
    for (const slot of slots) {
      const date = dateOnlyFromDate(slot.date);
      const daySlots = dayMap.get(date) ?? [];
      daySlots.push({
        id: slot.id.toString(),
        startTime: to24Hour(slot.startTime),
        endTime: to24Hour(slot.endTime),
        startTimeAMPM: to12Hour(slot.startTime),
        endTimeAMPM: to12Hour(slot.endTime),
      });
      dayMap.set(date, daySlots);
    }

    return {
      taskerId: user.id.toString(),
      timezone: this.config.get<string>('app.timezone', 'Africa/Casablanca'),
      days: [...dayMap.entries()].map(([date, slotsForDay]) => ({
        date,
        slots: slotsForDay.sort((left, right) => left.startTime.localeCompare(right.startTime)),
      })),
    };
  }

  private distanceSql(latitude: number, longitude: number): Prisma.Sql {
    return Prisma.sql`(
      6371 * acos(
        LEAST(1, GREATEST(-1,
          cos(radians(${latitude})) * cos(radians(u."serviceAreaLat"::float8)) *
          cos(radians(u."serviceAreaLng"::float8) - radians(${longitude})) +
          sin(radians(${latitude})) * sin(radians(u."serviceAreaLat"::float8))
        ))
      )
    )`;
  }
}
