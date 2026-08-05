import { getDayTitle, isFutureDate, isValidDateOnly } from './date.util';

describe('date utilities', () => {
  it('validates calendar dates, not only their shape', () => {
    expect(isValidDateOnly('2028-02-29')).toBe(true);
    expect(isValidDateOnly('2027-02-29')).toBe(false);
    expect(isValidDateOnly('2027-13-01')).toBe(false);
  });

  it('requires a date strictly after today', () => {
    const now = new Date('2026-08-04T10:00:00.000Z');
    expect(isFutureDate('2026-08-05', now)).toBe(true);
    expect(isFutureDate('2026-08-04', now)).toBe(false);
  });

  it('produces stable day titles in UTC', () => {
    const now = new Date('2026-08-04T10:00:00.000Z');
    expect(getDayTitle('2026-08-04', now)).toBe('Today');
    expect(getDayTitle('2026-08-05', now)).toBe('Tomorrow');
  });
});
