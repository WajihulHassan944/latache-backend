import type { AccountStatus } from '../../common/enums/account-status.enum';

export interface RbacRoleView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
  isActive: boolean;
  adminCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface RbacAdminView {
  id: number;
  adminId: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  phoneCountryCode: string | null;
  phoneNumber: string | null;
  profilePicture: string | null;
  role: string;
  accountStatus: string;
  adminRole: string | null;
  permissions: string[];
  inheritsRolePermissions: boolean;
  rbacRole: Pick<
    RbacRoleView,
    'id' | 'code' | 'name' | 'description' | 'permissions' | 'isSystem' | 'isActive'
  > | null;
  createdById: number | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginationMetadata {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
}

export interface RbacRoleListData {
  roles: RbacRoleView[];
  pagination: PaginationMetadata;
}

export interface RbacAdminListData {
  admins: RbacAdminView[];
  pagination: PaginationMetadata;
}

export interface PermissionCatalogView {
  modules: Array<{
    module: string;
    label: string;
    permissions: Array<{
      key: string;
      label: string;
      description: string;
    }>;
  }>;
  permissions: string[];
}

export interface EffectiveAccessView {
  userId: number;
  role: string;
  adminRole: string | null;
  permissions: string[];
  inheritsRolePermissions: boolean;
  rbacRole: RbacAdminView['rbacRole'];
}

export interface RolePermissionsUpdateView {
  id: string;
  code: string;
  permissions: string[];
  synchronizedAdminCount: number;
  constrainedOverrideAdminCount: number;
}

export interface AdminAccessUpdateView {
  admin: RbacAdminView;
}

export interface AdminStatusUpdateView {
  id: number;
  accountStatus: AccountStatus | string;
}
