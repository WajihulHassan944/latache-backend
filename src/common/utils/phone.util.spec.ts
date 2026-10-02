import { isPhoneNumberValidForCountryCode } from './phone.util';

describe('phone utilities', () => {
  it('accepts a number that matches its country code', () => {
    expect(isPhoneNumberValidForCountryCode('+212', '612345678')).toBe(true); // Moroccan mobile
    expect(isPhoneNumberValidForCountryCode('+92', '3001234567')).toBe(true); // Pakistani mobile
    expect(isPhoneNumberValidForCountryCode('+1', '2015550123')).toBe(true); // US number
  });

  it('rejects a number shaped for a different country', () => {
    // Pakistani-shaped mobile number submitted with Morocco's dialing code.
    expect(isPhoneNumberValidForCountryCode('+212', '3001234567')).toBe(false);
  });

  it('rejects garbage input without throwing', () => {
    expect(isPhoneNumberValidForCountryCode('+212', '0')).toBe(false);
    expect(isPhoneNumberValidForCountryCode('+999', '612345678')).toBe(false);
  });
});
