import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../enums/user-role.enum';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export const ALLOW_PENDING_PROFILE_KEY = 'allowPendingProfile';
/**
 * Lets a single-role route be used before the marketplace profile is operational (e.g. a Tasker still awaiting
 * approval). The role must still match, and suspended/deactivated accounts are still rejected by the identity guard.
 * Use only for onboarding steps, such as paying the signup deposit that approval itself depends on.
 */
export const AllowPendingProfile = () => SetMetadata(ALLOW_PENDING_PROFILE_KEY, true);
