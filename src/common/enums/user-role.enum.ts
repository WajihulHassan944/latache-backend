export enum UserRole {
  SuperAdmin = 'super_admin',
  Admin = 'admin',
  Customer = 'customer',
  Tasker = 'tasker',
}

export const ADMINISTRATIVE_ROLES: readonly UserRole[] = [
  UserRole.SuperAdmin,
  UserRole.Admin,
];
