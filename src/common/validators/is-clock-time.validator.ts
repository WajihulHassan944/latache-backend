import { buildMessage, ValidateBy, type ValidationOptions } from 'class-validator';
import { isValidTime } from '../utils/time.util';

export const IsClockTime = (validationOptions?: ValidationOptions): PropertyDecorator =>
  ValidateBy(
    {
      name: 'isClockTime',
      validator: {
        validate: (value: unknown): boolean =>
          typeof value === 'string' && isValidTime(value),
        defaultMessage: buildMessage(
          (eachPrefix) => `${eachPrefix}$property must be a valid 24-hour or AM/PM time`,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
