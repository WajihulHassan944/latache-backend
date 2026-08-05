import { AdminRole } from '../../../common/enums/admin-role.enum';

export const CREATABLE_ADMIN_ROLES = [
  AdminRole.FinanceAdmin,
  AdminRole.SupportAdmin,
  AdminRole.ContentAdmin,
  AdminRole.OperationsAdmin,
  AdminRole.AnalyticsAdmin,
  AdminRole.CustomAdmin,
] as const;

export const ADMIN_PERMISSIONS = [
  'admins.read',
  'admins.create',
  'admins.update',
  'admins.suspend',
  'admins.delete',
  'roles.read',
  'roles.manage',
  'customers.read',
  'customers.manage',
  'taskers.read',
  'taskers.manage',
  'bookings.read',
  'bookings.manage',
  'services.read',
  'services.manage',
  'finance.read',
  'finance.manage',
  'reports.read',
  'support.read',
  'support.manage',
  'content.read',
  'content.manage',
  'analytics.read',
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

const allPermissions = [...ADMIN_PERMISSIONS] as AdminPermission[];

export const DEFAULT_ADMIN_PERMISSIONS: Readonly<Record<AdminRole, AdminPermission[]>> = {
  [AdminRole.SuperAdmin]: allPermissions,
  [AdminRole.FinanceAdmin]: ['finance.read', 'finance.manage', 'reports.read'],
  [AdminRole.SupportAdmin]: [
    'support.read',
    'support.manage',
    'customers.read',
    'taskers.read',
    'bookings.read',
  ],
  [AdminRole.ContentAdmin]: [
    'content.read',
    'content.manage',
    'services.read',
  ],
  [AdminRole.OperationsAdmin]: [
    'customers.read',
    'customers.manage',
    'taskers.read',
    'taskers.manage',
    'bookings.read',
    'bookings.manage',
    'services.read',
    'services.manage',
  ],
  [AdminRole.AnalyticsAdmin]: ['analytics.read', 'reports.read', 'finance.read'],
  [AdminRole.CustomAdmin]: [],
};

export const permissionsForAdminRole = (
  role: AdminRole,
  customPermissions: string[] = [],
): string[] => {
  const permissions = role === AdminRole.CustomAdmin
    ? customPermissions
    : DEFAULT_ADMIN_PERMISSIONS[role];
  return [...new Set(permissions)].sort();
};
