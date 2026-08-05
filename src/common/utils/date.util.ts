const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const isValidDateOnly = (value: string): boolean => {
  if (!DATE_PATTERN.test(value)) return false;
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

export const dateOnlyToDate = (value: string): Date => {
  if (!isValidDateOnly(value)) throw new TypeError(`Invalid date-only value: ${value}`);
  return new Date(`${value}T00:00:00.000Z`);
};

export const dateOnlyFromDate = (value: Date): string =>
  value.toISOString().slice(0, 10);

export const todayDateOnly = (now = new Date()): string =>
  now.toISOString().slice(0, 10);

export const isFutureDate = (date: string, now = new Date()): boolean =>
  isValidDateOnly(date) && date > todayDateOnly(now);

export const getDayTitle = (date: string, now = new Date()): string => {
  const today = dateOnlyToDate(todayDateOnly(now));
  const target = dateOnlyToDate(date);
  const difference = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (difference === 0) return 'Today';
  if (difference === 1) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(target);
};
