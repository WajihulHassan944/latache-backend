import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TaskerSort } from '../../common/enums/tasker-sort.enum';
import { UserRole } from '../../common/enums/user-role.enum';
import {
  dateOnlyFromDate,
  dateOnlyToDate,
  todayDateOnly,
} from '../../common/utils/date.util';
import { formatLocation } from '../../common/utils/location.util';
import { normalizePagination } from '../../common/utils/pagination.util';
import { to12Hour, to24Hour } from '../../common/utils/time.util';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type Service } from '../../generated/prisma/client';
import { ListTaskersQueryDto } from './dto/list-taskers-query.dto';

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
  ) {}

  findServicesBySlugs(
    slugs: string[],
    transaction?: Prisma.TransactionClient,
  ): Promise<Service[]> {
    return (transaction ?? this.prisma).service.findMany({
      where: { slug: { in: slugs } },
    });
  }

  async list(query: ListTaskersQueryDto) {
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

    const { page, limit, offset } = normalizePagination(query.page, query.limit, 9);
    const representativeConditions: Prisma.Sql[] = [];
    const eligibleConditions: Prisma.Sql[] = [
      Prisma.sql`u."role" = ${UserRole.Tasker}`,
      Prisma.sql`u."onboardingStatus" IS NOT NULL`,
    ];

    if (query.serviceSlug) {
      representativeConditions.push(Prisma.sql`s."slug" = ${query.serviceSlug}`);
    }
    if (query.minPrice !== undefined) {
      representativeConditions.push(
        Prisma.sql`us."hourlyRate" >= ${query.minPrice}`,
      );
    }
    if (query.maxPrice !== undefined) {
      representativeConditions.push(
        Prisma.sql`us."hourlyRate" <= ${query.maxPrice}`,
      );
    }
    if (query.isElite !== undefined) {
      eligibleConditions.push(Prisma.sql`u."isElite" = ${query.isElite}`);
    }

    if (query.lat !== undefined && query.lng !== undefined) {
      const distance = this.distanceSql(query.lat, query.lng);
      eligibleConditions.push(Prisma.sql`u."serviceAreaLat" IS NOT NULL`);
      eligibleConditions.push(Prisma.sql`u."serviceAreaLng" IS NOT NULL`);
      eligibleConditions.push(Prisma.sql`u."serviceAreaRadiusKm" IS NOT NULL`);
      eligibleConditions.push(Prisma.sql`${distance} <= ${query.radius ?? 20}`);
      eligibleConditions.push(
        Prisma.sql`${distance} <= u."serviceAreaRadiusKm"::float8`,
      );
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

    const cte = Prisma.sql`
      WITH representative AS (${representative}),
      eligible AS (
        SELECT
          u."id", u."firstName", u."lastName", u."profilePicture", u."rating",
          u."reviewsCount", u."bio", u."completedTasks", u."vehicles", u."workImages",
          u."isElite", u."serviceAreaLat", u."serviceAreaLng", u."serviceAreaRadiusKm",
          u."serviceAreaCity", u."serviceAreaArea", u."submittedAt",
          representative."hourlyRate", representative."serviceSlug"
        FROM "Users" u
        INNER JOIN representative ON representative."userId" = u."id"
        WHERE ${Prisma.join(eligibleConditions, ' AND ')}
      )
    `;

    const orderBy: Record<TaskerSort | 'default', string> = {
      [TaskerSort.PriceAscending]: '"hourlyRate" ASC, "id" ASC',
      [TaskerSort.PriceDescending]: '"hourlyRate" DESC, "id" ASC',
      [TaskerSort.RatingDescending]: '"rating" DESC, "id" ASC',
      [TaskerSort.CompletedDescending]: '"completedTasks" DESC, "id" ASC',
      default: '"submittedAt" DESC NULLS LAST, "id" DESC',
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
        vehicles: row.vehicles || [],
        serviceSlug: row.serviceSlug ?? '',
        workImages: row.workImages || [],
        isElite: row.isElite,
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

  async getById(id: number, serviceSlug?: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, role: UserRole.Tasker },
      include: {
        userServices: {
          include: { service: true },
        },
      },
    });
    if (!user) return null;

    const pricedServices = user.userServices.filter(
      (entry) => entry.service.slug !== null,
    );
    if (!pricedServices.length) return null;
    const cheapest = pricedServices.reduce((current, candidate) =>
      Number(candidate.hourlyRate) < Number(current.hourlyRate) ? candidate : current,
    );
    const primary = serviceSlug
      ? pricedServices.find((entry) => entry.service.slug === serviceSlug) ?? cheapest
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
      vehicles: user.vehicles,
      serviceSlug: primary.service.slug ?? '',
      workImages: user.workImages,
      isElite: user.isElite,
      location: formatLocation({
        lat: user.serviceAreaLat === null ? null : Number(user.serviceAreaLat),
        lng: user.serviceAreaLng === null ? null : Number(user.serviceAreaLng),
        city: user.serviceAreaCity,
        area: user.serviceAreaArea,
        radiusKm:
          user.serviceAreaRadiusKm === null ? null : Number(user.serviceAreaRadiusKm),
      }),
      ...(user.aboutMe ? { aboutMe: user.aboutMe } : {}),
      ...(user.skills.length ? { skills: user.skills } : {}),
    };
  }

  async getAvailability(id: number) {
    const user = await this.prisma.user.findFirst({
      where: { id, role: UserRole.Tasker },
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
        slots: slotsForDay.sort((left, right) =>
          left.startTime.localeCompare(right.startTime),
        ),
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
