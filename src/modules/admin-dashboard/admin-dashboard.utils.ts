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
  range.from && range.toExclusive
    ? { gte: range.from, lt: range.toExclusive }
    : undefined;

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
