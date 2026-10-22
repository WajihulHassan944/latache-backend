import { BadRequestException } from '@nestjs/common';
import type { AdminAnalyticsRange, AdminDateRangeQueryDto } from './dto';

export interface ResolvedAdminDateRange {
  from: Date | null;
  toExclusive: Date | null;
  range: AdminAnalyticsRange | 'custom';
  granularity: 'day' | 'month';
}

const DAY_MS = 86_400_000;

const parseDateOnly = (value: string): Date => {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`Invalid UTC date: ${value}`);
  }
  return date;
};

export const resolveAdminDateRange = (
  query: AdminDateRangeQueryDto,
  now = new Date(),
): ResolvedAdminDateRange => {
  if ((query.from && !query.to) || (!query.from && query.to)) {
    throw new BadRequestException('from and to must be supplied together');
  }
  if (query.from && query.to) {
    const from = parseDateOnly(query.from);
    const inclusiveTo = parseDateOnly(query.to);
    if (from.getTime() > inclusiveTo.getTime()) {
      throw new BadRequestException('from must be earlier than or equal to to');
    }
    const toExclusive = new Date(inclusiveTo.getTime() + DAY_MS);
    const days = Math.ceil((toExclusive.getTime() - from.getTime()) / DAY_MS);
    return {
      from,
      toExclusive,
      range: 'custom',
      granularity: days <= 45 ? 'day' : 'month',
    };
  }

  const range = query.range ?? '30d';
  if (range === 'all') {
    return { from: null, toExclusive: null, range, granularity: 'month' };
  }

  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const tomorrow = new Date(today.getTime() + DAY_MS);
  if (range === '7d' || range === '30d' || range === '90d') {
    const days = Number.parseInt(range, 10);
    return {
      from: new Date(today.getTime() - (days - 1) * DAY_MS),
      toExclusive: tomorrow,
      range,
      granularity: days <= 45 ? 'day' : 'month',
    };
  }

  const months = range === '6m' ? 6 : 12;
  return {
    from: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (months - 1), 1)),
    toExclusive: tomorrow,
    range,
    granularity: 'month',
  };
};

export const dateFilter = (range: ResolvedAdminDateRange) =>
  range.from && range.toExclusive ? { gte: range.from, lt: range.toExclusive } : undefined;

/**
 * Resolves the equal-length window immediately preceding `range`.
 * - day-based ranges (7d/30d/90d) and custom from/to: same length, ending the day
 *   before the current window starts.
 * - month-based ranges (6m/12m): shifted back by the same number of months, aligned
 *   to the 1st of the month.
 * - range = 'all' (no bounded start/end): no previous window exists, returns null.
 */
export const resolvePreviousAdminDateRange = (
  range: ResolvedAdminDateRange,
): ResolvedAdminDateRange | null => {
  if (!range.from || !range.toExclusive) return null;

  if (range.range === '6m' || range.range === '12m') {
    const months = range.range === '6m' ? 6 : 12;
    const prevFrom = new Date(
      Date.UTC(range.from.getUTCFullYear(), range.from.getUTCMonth() - months, 1),
    );
    return {
      from: prevFrom,
      toExclusive: range.from,
      range: range.range,
      granularity: range.granularity,
    };
  }

  const spanMs = range.toExclusive.getTime() - range.from.getTime();
  const prevFrom = new Date(range.from.getTime() - spanMs);
  return {
    from: prevFrom,
    toExclusive: range.from,
    range: range.range,
    granularity: range.granularity,
  };
};

export const percentage = (numerator: number, denominator: number): number =>
  denominator <= 0 ? 0 : Number(((numerator / denominator) * 100).toFixed(1));

export const money = (value: unknown): number => Number(Number(value ?? 0).toFixed(2));

export const pagination = (pageInput?: number, limitInput?: number) => {
  const page = Math.max(1, pageInput ?? 1);
  const limit = Math.min(100, Math.max(1, limitInput ?? 20));
  return { page, limit, skip: (page - 1) * limit };
};

export const fullName = (firstName?: string | null, lastName?: string | null): string =>
  `${firstName ?? ''} ${lastName ?? ''}`.trim();

/**
 * CustomerAddress only stores a free-text label/address (no structured
 * city/area columns), so admin list views derive city/area from the
 * trailing comma-separated segments of that text, e.g.
 * "12 Rue Oasis, Maarif, Casablanca" -> { area: 'Maarif', city: 'Casablanca' }.
 * Returns nulls when there is no default address or no comma structure.
 */
export const parseCityArea = (
  address?: string | null,
): { city: string | null; area: string | null } => {
  const parts = (address ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return { city: null, area: null };
  return {
    city: parts[parts.length - 1] ?? null,
    area: parts.length > 1 ? (parts[parts.length - 2] ?? null) : null,
  };
};
