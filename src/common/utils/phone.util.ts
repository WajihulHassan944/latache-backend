import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * True when phoneNumber is a plausible national number for phoneCountryCode's
 * dialing prefix (e.g. a Pakistani-shaped number submitted with Morocco's +212
 * fails). Uses libphonenumber-js's per-country length/pattern metadata rather
 * than a fixed digit-count rule, since valid lengths vary by country.
 */
export const isPhoneNumberValidForCountryCode = (
  phoneCountryCode: string,
  phoneNumber: string,
): boolean => {
  const parsed = parsePhoneNumberFromString(`${phoneCountryCode}${phoneNumber}`);
  return parsed?.isValid() ?? false;
};
