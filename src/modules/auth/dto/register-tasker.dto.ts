import { BaseRegistrationDto } from './common-auth.dto';

/**
 * Lightweight Tasker signup, same shape as RegisterCustomerDto. The Tasker
 * role is assigned immediately; professional details (services, rate,
 * availability, identity documents, service area) are submitted afterwards
 * via POST /taskers/onboarding once the account is authenticated.
 */
export class RegisterTaskerDto extends BaseRegistrationDto {}
