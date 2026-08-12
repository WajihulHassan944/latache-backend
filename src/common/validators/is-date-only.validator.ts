import { buildMessage, ValidateBy, type ValidationOptions } from 'class-validator';
import { isValidDateOnly } from '../utils/date.util';

export const IsDateOnly = (validationOptions?: ValidationOptions): PropertyDecorator =>
  ValidateBy(
    {
      name: 'isDateOnly',
      validator: {
        validate: (value: unknown): boolean => typeof value === 'string' && isValidDateOnly(value),
        defaultMessage: buildMessage(
          (eachPrefix) => `${eachPrefix}$property must be a valid date in YYYY-MM-DD format`,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
