import { BadRequestException } from '@nestjs/common';
import { isFutureDate } from './date.util';
import { parseTimeToMinutes, rangesOverlap, type TimeRange } from './time.util';

export interface AvailabilitySlotInput extends TimeRange {
  date: string;
}

/** Shared by onboarding submission and the active-tasker availability endpoints so both enforce identical rules. */
export const validateAvailabilitySlots = (slots: AvailabilitySlotInput[]): void => {
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
