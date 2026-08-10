import { parseTimeToMinutes } from '../../common/utils/time.util';

export const toIso = (value: Date | null | undefined): string | null =>
  value ? value.toISOString() : null;

export const roundMoney = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

export const estimatedTaskAmount = (
  hourlyRate: number,
  startTime: string,
  endTime: string,
): number => {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  if (start === null || end === null || end <= start) return roundMoney(hourlyRate);
  return roundMoney(hourlyRate * ((end - start) / 60));
};

export const monthKey = (date: Date): string =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

export const monthStart = (date = new Date()): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

export const safeJsonArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
