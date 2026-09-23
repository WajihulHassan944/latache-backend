import { BadRequestException } from '@nestjs/common';
import { isTodayOrFutureDate, todayDateOnly } from './date.util';
import { parseTimeToMinutes, rangesOverlap, type TimeRange } from './time.util';

export interface AvailabilitySlotInput extends TimeRange {
  date: string;
}

/** Shared by onboarding submission and the active-tasker availability endpoints so both enforce identical rules. */
export const validateAvailabilitySlots = (
  slots: AvailabilitySlotInput[],
  now = new Date(),
): void => {
  const invalidDates = slots.filter((slot) => !isTodayOrFutureDate(slot.date, now));
  if (invalidDates.length) {
    throw new BadRequestException(
      `Availability date(s) must be today or later: ${invalidDates
        .map((slot) => slot.date)
        .join(', ')}`,
    );
  }

  // Same UTC-minutes convention as booking's isPastSlotStart: a slot for today
  // whose start time has already been reached can never be booked.
  const today = todayDateOnly(now);
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const elapsed = slots.filter((slot) => {
    if (slot.date !== today) return false;
    const start = parseTimeToMinutes(slot.startTime);
    return start !== null && start <= nowMinutes;
  });
  if (elapsed.length) {
    throw new BadRequestException(
      `Availability start time(s) have already passed today: ${elapsed
        .map((slot) => `${slot.date} ${slot.startTime}`)
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

  const byDate = new Map<string, AvailabilitySlotInput[]>();
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
};
