import {
  formatMinutesAs12Hour,
  formatMinutesAs24Hour,
  parseTimeToMinutes,
  rangesOverlap,
} from './time.util';

describe('time utilities', () => {
  it.each<[string, number]>([
    ['12:00 AM', 0],
    ['12:00 PM', 720],
    ['9:05 PM', 1265],
    ['23:59', 1439],
  ])('parses %s', (value, expected) => {
    expect(parseTimeToMinutes(value)).toBe(expected);
  });

  it.each<string>(['24:00', '13:30 PM', '09:60', 'not-time'])('rejects %s', (value) => {
    expect(parseTimeToMinutes(value)).toBeNull();
  });

  it('formats both supported representations', () => {
    expect(formatMinutesAs24Hour(65)).toBe('01:05');
    expect(formatMinutesAs12Hour(13 * 60 + 5)).toBe('1:05 PM');
  });

  it('detects overlapping ranges', () => {
    expect(
      rangesOverlap(
        { startTime: '09:00', endTime: '10:00' },
        { startTime: '09:30', endTime: '10:30' },
      ),
    ).toBe(true);
    expect(
      rangesOverlap(
        { startTime: '09:00', endTime: '10:00' },
        { startTime: '10:00', endTime: '11:00' },
      ),
    ).toBe(false);
  });
});
