import type { User } from '../../generated/prisma/client';
import type { UserRole } from '../enums/user-role.enum';
import { userRoles } from './user-role.util';

const PRIVATE_USER_FIELDS = new Set([
  'password',
  'otp',
  'otpHash',
  'otpExpires',
  'otpAttempts',
  'passwordResetCode',
  'passwordResetCodeHash',
  'passwordResetCodeExpires',
  'passwordResetAttempts',
  'identityDocument',
]);

export type PublicUser = Record<string, unknown>;

/**
 * Serializes the single Latache identity while preserving the legacy `role`
 * response field as the currently active portal role. `primaryRole` is the
 * original/canonical database role and `roles` lists every enabled role.
 */
export const serializeUser = (user: User, activeRole?: UserRole): PublicUser => {
  const plain = { ...user } as Record<string, unknown>;
  for (const field of PRIVATE_USER_FIELDS) delete plain[field];

  const roles = userRoles(user);
  const selected = activeRole ?? (user.role as UserRole);
  plain.primaryRole = user.role;
  plain.roles = roles;
  plain.activeRole = selected;
  plain.role = selected;

  if (roles.includes('admin' as UserRole) || roles.includes('super_admin' as UserRole)) {
    plain.adminId = `ADM-${String(user.id).padStart(3, '0')}`;
  }

  plain.preferredLanguage = user.preferredLanguage ?? 'en';

  return plain;
};
