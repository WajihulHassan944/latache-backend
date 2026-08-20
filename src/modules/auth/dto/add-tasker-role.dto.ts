import { OmitType } from '@nestjs/swagger';
import { RegisterTaskerDto } from './register-tasker.dto';

/**
 * Tasker application fields used when an already-authenticated Customer adds
 * Tasker capability to the same User identity. Shared identity credentials and
 * contact fields are intentionally not duplicated.
 */
export class AddTaskerRoleDto extends OmitType(RegisterTaskerDto, [
  'firstName',
  'lastName',
  'email',
  'phoneCountryCode',
  'phoneNumber',
  'password',
  'zipCode',
  'device',
  'preferredLanguage',
] as const) {}
