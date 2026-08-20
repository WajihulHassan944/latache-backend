import type { User } from '../../generated/prisma/client';
import { ADMINISTRATIVE_ROLES, UserRole } from '../enums/user-role.enum';

type RoleAwareUser = Pick<User, 'role' | 'roles'>;

export const userRoles = (user: RoleAwareUser): UserRole[] => {
  const raw = Array.isArray(user.roles) && user.roles.length > 0 ? user.roles : [user.role];
  const seen = new Set<UserRole>();
  for (const value of raw) {
    if (Object.values(UserRole).includes(value as UserRole)) seen.add(value as UserRole);
  }
  return [...seen];
};

export const hasUserRole = (user: RoleAwareUser, role: UserRole): boolean =>
  userRoles(user).includes(role);

export const hasAnyUserRole = (user: RoleAwareUser, roles: readonly UserRole[]): boolean =>
  roles.some((role) => hasUserRole(user, role));

export const isMarketplaceRole = (role: UserRole): boolean =>
  role === UserRole.Customer || role === UserRole.Tasker;

export const isAdministrativeRole = (role: UserRole): boolean =>
  ADMINISTRATIVE_ROLES.includes(role);

export const normalizeRoleMembership = (
  roles: readonly UserRole[],
  nextRole?: UserRole,
): UserRole[] => {
  const values = nextRole ? [...roles, nextRole] : [...roles];
  return [...new Set(values)];
};
