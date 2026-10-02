import { buildMessage, ValidateBy, type ValidationArguments, type ValidationOptions } from 'class-validator';
import { isPhoneNumberValidForCountryCode } from '../utils/phone.util';

/**
 * Cross-field check for the companion phoneCountryCode property on the same DTO.
 * Skips (passes) when either field is missing/not-a-string so @IsOptional()/
 * @Matches() on the individual fields remain the source of truth for presence
 * and format; this only catches a syntactically valid pair that doesn't belong
 * together, e.g. phoneCountryCode "+212" (Morocco) with a Pakistani-shaped number.
 */
export const IsPhoneMatchingCountryCode = (validationOptions?: ValidationOptions): PropertyDecorator =>
  ValidateBy(
    {
      name: 'isPhoneMatchingCountryCode',
      validator: {
        validate: (phoneNumber: unknown, args?: ValidationArguments): boolean => {
          const countryCode = (args?.object as Record<string, unknown> | undefined)?.phoneCountryCode;
          if (typeof phoneNumber !== 'string' || typeof countryCode !== 'string') return true;
          if (!phoneNumber || !countryCode) return true;
          return isPhoneNumberValidForCountryCode(countryCode, phoneNumber);
        },
        defaultMessage: buildMessage(
          (eachPrefix) => `${eachPrefix}phoneNumber is not a valid number for the given phoneCountryCode`,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
