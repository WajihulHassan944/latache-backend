const TWELVE_HOUR_PATTERN = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i;
const TWENTY_FOUR_HOUR_PATTERN = /^(\d{1,2}):(\d{2})$/;

export const parseTimeToMinutes = (value: string): number | null => {
  const normalized = value.trim();
  const twelveHour = TWELVE_HOUR_PATTERN.exec(normalized);
  if (twelveHour) {
    const rawHours = Number(twelveHour[1]);
    const minutes = Number(twelveHour[2]);
    if (rawHours < 1 || rawHours > 12 || minutes < 0 || minutes > 59) return null;
    let hours = rawHours % 12;
    if (twelveHour[3]?.toUpperCase() === 'PM') hours += 12;
    return hours * 60 + minutes;
  }

  const twentyFourHour = TWENTY_FOUR_HOUR_PATTERN.exec(normalized);
  if (twentyFourHour) {
    const hours = Number(twentyFourHour[1]);
    const minutes = Number(twentyFourHour[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  return null;
};

export const isValidTime = (value: string): boolean => parseTimeToMinutes(value) !== null;

export const formatMinutesAs24Hour = (minutes: number): string => {
  const hours = Math.floor(minutes / 60).toString().padStart(2, '0');
  const remainingMinutes = (minutes % 60).toString().padStart(2, '0');
  return `${hours}:${remainingMinutes}`;
};

export const formatMinutesAs12Hour = (minutes: number): string => {
  const hours24 = Math.floor(minutes / 60);
  const remainingMinutes = (minutes % 60).toString().padStart(2, '0');
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${remainingMinutes} ${period}`;
};

export const to24Hour = (value: string): string => {
  const minutes = parseTimeToMinutes(value);
  return minutes === null ? value : formatMinutesAs24Hour(minutes);
};

export const to12Hour = (value: string): string => {
  const minutes = parseTimeToMinutes(value);
  return minutes === null ? value : formatMinutesAs12Hour(minutes);
};

export interface TimeRange {
  startTime: string;
  endTime: string;
}

export const rangesOverlap = (left: TimeRange, right: TimeRange): boolean => {
  const leftStart = parseTimeToMinutes(left.startTime);
  const leftEnd = parseTimeToMinutes(left.endTime);
  const rightStart = parseTimeToMinutes(right.startTime);
  const rightEnd = parseTimeToMinutes(right.endTime);
  if ([leftStart, leftEnd, rightStart, rightEnd].some((value) => value === null)) return false;
  return (leftStart as number) < (rightEnd as number) && (rightStart as number) < (leftEnd as number);
};
