import { BadRequestException } from '@nestjs/common';
import { validateAvailabilitySlots } from './availability.util';

describe('validateAvailabilitySlots', () => {
  const now = new Date('2026-09-23T10:30:00.000Z');

  it('accepts today (with a start still ahead) and future dates', () => {
    expect(() =>
      validateAvailabilitySlots(
        [
          { date: '2026-09-23', startTime: '11:00', endTime: '13:00' },
          { date: '2026-09-24', startTime: '09:00', endTime: '10:00' },
        ],
        now,
      ),
    ).not.toThrow();
  });

  it('rejects past dates', () => {
    expect(() =>
      validateAvailabilitySlots([{ date: '2026-09-22', startTime: '11:00', endTime: '12:00' }], now),
    ).toThrow(BadRequestException);
  });

  it('rejects a slot today whose start time has already passed or is right now', () => {
    expect(() =>
      validateAvailabilitySlots([{ date: '2026-09-23', startTime: '09:00', endTime: '12:00' }], now),
    ).toThrow(/already passed/);
    expect(() =>
      validateAvailabilitySlots([{ date: '2026-09-23', startTime: '10:30', endTime: '12:00' }], now),
    ).toThrow(/already passed/);
  });

  it('keeps the existing overlap and ordering rules', () => {
    expect(() =>
      validateAvailabilitySlots(
        [
          { date: '2026-09-24', startTime: '09:00', endTime: '11:00' },
          { date: '2026-09-24', startTime: '10:00', endTime: '12:00' },
        ],
        now,
      ),
    ).toThrow(/overlap/);
    expect(() =>
      validateAvailabilitySlots([{ date: '2026-09-24', startTime: '12:00', endTime: '11:00' }], now),
    ).toThrow(/endTime/);
  });
});
