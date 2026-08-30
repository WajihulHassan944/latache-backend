import { AdminRole } from '../../../common/enums/admin-role.enum';

export interface PermissionCatalogItem {
  key: string;
  label: string;
  description: string;
}

export interface PermissionCatalogModule {
  module: string;
  label: string;
  permissions: readonly PermissionCatalogItem[];
}

export const PERMISSION_CATALOG = [
  {
    module: 'admins',
    label: 'Administrator Management',
    permissions: [
      {
        key: 'admins.read',
        label: 'View administrators',
        description: 'View administrator accounts and access assignments.',
      },
      {
        key: 'admins.create',
        label: 'Create administrators',
        description: 'Create administrator accounts.',
      },
      {
        key: 'admins.update',
        label: 'Update administrators',
        description: 'Update administrator profiles and access assignments.',
      },
      {
        key: 'admins.suspend',
        label: 'Suspend administrators',
        description: 'Suspend or reactivate administrator accounts.',
      },
      {
        key: 'admins.delete',
        label: 'Delete administrators',
        description: 'Permanently delete eligible administrator accounts when policy allows.',
      },
    ],
  },
  {
    module: 'roles',
    label: 'Roles and Permissions',
    permissions: [
      {
        key: 'roles.read',
        label: 'View roles',
        description: 'View RBAC roles and the permission catalogue.',
      },
      {
        key: 'roles.manage',
        label: 'Manage roles',
        description: 'Create and modify RBAC roles. Sensitive writes remain super-admin only.',
      },
    ],
  },
  {
    module: 'customers',
    label: 'Customer Management',
    permissions: [
      {
        key: 'customers.read',
        label: 'View customers',
        description: 'View customer accounts and profiles.',
      },
      {
        key: 'customers.manage',
        label: 'Manage customers',
        description: 'Update customer account lifecycle and profile data.',
      },
      {
        key: 'customers.delete',
        label: 'Permanently delete customers',
        description:
          'Irreversibly delete eligible customer accounts and managed assets. Protected financial and booking history blocks deletion.',
      },
    ],
  },
  {
    module: 'taskers',
    label: 'Tasker Management',
    permissions: [
      {
        key: 'taskers.read',
        label: 'View taskers',
        description: 'View tasker profiles and onboarding applications.',
      },
      {
        key: 'taskers.manage',
        label: 'Manage taskers',
        description: 'Approve, reject, suspend, or update tasker accounts.',
      },
      {
        key: 'taskers.delete',
        label: 'Permanently delete taskers',
        description:
          'Irreversibly delete eligible Tasker accounts and managed assets. Protected financial and booking history blocks deletion.',
      },
    ],
  },
  {
    module: 'elite',
    label: 'Elite Tasker Program',
    permissions: [
      {
        key: 'elite.read',
        label: 'View Elite program',
        description:
          'View Elite members, applications, performance, reports, badges, and benefits.',
      },
      {
        key: 'elite.manage',
        label: 'Manage Elite program',
        description: 'Approve tier changes and manage Elite tiers, benefits, and badges.',
      },
    ],
  },
  {
    module: 'bookings',
    label: 'Booking Management',
    permissions: [
      {
        key: 'bookings.read',
        label: 'View bookings',
        description: 'View customer and tasker bookings.',
      },
      {
        key: 'bookings.manage',
        label: 'Manage bookings',
        description: 'Update booking lifecycle and resolve booking issues.',
      },
    ],
  },
  {
    module: 'services',
    label: 'Service Management',
    permissions: [
      {
        key: 'services.read',
        label: 'View services',
        description: 'View the Latache service catalogue.',
      },
      {
        key: 'services.manage',
        label: 'Manage services',
        description: 'Create and update service catalogue entries.',
      },
    ],
  },
  {
    module: 'reviews',
    label: 'Review Moderation',
    permissions: [
      {
        key: 'reviews.read',
        label: 'View reviews',
        description: 'View review content and moderation state.',
      },
      {
        key: 'reviews.manage',
        label: 'Moderate reviews',
        description: 'Hide or restore reviews without rewriting author content.',
      },
    ],
  },
  {
    module: 'finance',
    label: 'Finance',
    permissions: [
      {
        key: 'finance.read',
        label: 'View finance',
        description: 'View financial summaries, transactions, and reconciliation data.',
      },
      {
        key: 'finance.manage',
        label: 'Manage finance',
        description: 'Perform permitted finance operations and reconciliation actions.',
      },
    ],
  },
  {
    module: 'reports',
    label: 'Reports',
    permissions: [
      {
        key: 'reports.read',
        label: 'View reports',
        description: 'View and export authorized operational and financial reports.',
      },
    ],
  },
  {
    module: 'support',
    label: 'Support',
    permissions: [
      {
        key: 'support.read',
        label: 'View support cases',
        description: 'View support requests and conversations.',
      },
      {
        key: 'support.manage',
        label: 'Manage support cases',
        description: 'Respond to and resolve support requests.',
      },
    ],
  },
  {
    module: 'content',
    label: 'Content',
    permissions: [
      {
        key: 'content.read',
        label: 'View content',
        description: 'View editable platform content.',
      },
      {
        key: 'content.manage',
        label: 'Manage content',
        description: 'Create, update, publish, or unpublish platform content.',
      },
    ],
  },
  {
    module: 'seo',
    label: 'SEO',
    permissions: [
      { key: 'seo.read', label: 'View SEO', description: 'View SEO metadata, redirects, sitemap and robots configuration.' },
      { key: 'seo.manage', label: 'Manage SEO', description: 'Manage SEO metadata, redirects, sitemap and robots configuration.' },
    ],
  },
  {
    module: 'settings',
    label: 'Platform Settings',
    permissions: [
      {
        key: 'settings.read',
        label: 'View platform settings',
        description:
          'View platform identity, currency, tax, booking, radius, commission, referral, and linked Elite policy.',
      },
      {
        key: 'settings.manage',
        label: 'Manage platform settings',
        description:
          'Update supported platform policy. Unsupported integrations remain non-activatable.',
      },
    ],
  },
  {
    module: 'analytics',
    label: 'Analytics',
    permissions: [
      {
        key: 'analytics.read',
        label: 'View analytics',
        description: 'View dashboards, metrics, and analytical reports.',
      },
    ],
  },
] as const satisfies readonly PermissionCatalogModule[];

export const ADMIN_PERMISSIONS = PERMISSION_CATALOG.flatMap((group) =>
  group.permissions.map((permission) => permission.key),
) as string[];

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export interface SystemRbacRoleDefinition {
  code: AdminRole;
  name: string;
  description: string;
  permissions: readonly string[];
  isSystem: true;
}

export const SYSTEM_RBAC_ROLES: readonly SystemRbacRoleDefinition[] = [
  {
    code: AdminRole.SuperAdmin,
    name: 'Super Administrator',
    description: 'Canonical platform owner with immutable full access.',
    permissions: ADMIN_PERMISSIONS,
    isSystem: true,
  },
  {
    code: AdminRole.FinanceAdmin,
    name: 'Finance Administrator',
    description: 'Financial operations, reconciliation, and reporting access.',
    permissions: ['finance.read', 'finance.manage', 'reports.read', 'settings.read'],
    isSystem: true,
  },
  {
    code: AdminRole.SupportAdmin,
    name: 'Support Administrator',
    description: 'Customer, tasker, booking, and support case visibility.',
    permissions: [
      'support.read',
      'support.manage',
      'customers.read',
      'taskers.read',
      'bookings.read',
    ],
    isSystem: true,
  },
  {
    code: AdminRole.ContentAdmin,
    name: 'Content Administrator',
    description: 'Content and service catalogue management.',
    permissions: [
      'content.read',
      'content.manage',
      'seo.read',
      'seo.manage',
      'services.read',
      'reviews.read',
      'reviews.manage',
    ],
    isSystem: true,
  },
  {
    code: AdminRole.OperationsAdmin,
    name: 'Operations Administrator',
    description: 'Day-to-day customer, tasker, booking, and service operations.',
    permissions: [
      'customers.read',
      'customers.manage',
      'taskers.read',
      'taskers.manage',
      'elite.read',
      'elite.manage',
      'bookings.read',
      'bookings.manage',
      'services.read',
      'services.manage',
      'reviews.read',
      'reviews.manage',
      'settings.read',
    ],
    isSystem: true,
  },
  {
    code: AdminRole.AnalyticsAdmin,
    name: 'Analytics Administrator',
    description: 'Analytics, reporting, and finance read access.',
    permissions: ['analytics.read', 'reports.read', 'finance.read', 'elite.read', 'settings.read'],
    isSystem: true,
  },
  {
    code: AdminRole.CustomAdmin,
    name: 'Custom Administrator',
    description: 'Compatibility role for administrator-specific permission overrides.',
    permissions: [],
    isSystem: true,
  },
];

export const DEFAULT_ADMIN_PERMISSIONS = Object.fromEntries(
  SYSTEM_RBAC_ROLES.map((role) => [role.code, [...role.permissions]]),
) as Readonly<Record<AdminRole, string[]>>;

export const CREATABLE_ADMIN_ROLES = SYSTEM_RBAC_ROLES.filter(
  (role) => role.code !== AdminRole.SuperAdmin,
).map((role) => role.code);

export const permissionKeys = (): string[] => [...ADMIN_PERMISSIONS];

export const isKnownPermission = (permission: string): boolean =>
  ADMIN_PERMISSIONS.includes(permission);
