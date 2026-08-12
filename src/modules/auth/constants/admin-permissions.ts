import { AdminRole } from '../../../common/enums/admin-role.enum';
import { DEFAULT_ADMIN_PERMISSIONS } from '../../rbac/constants/permission-catalog';

export {
  ADMIN_PERMISSIONS,
  CREATABLE_ADMIN_ROLES,
  DEFAULT_ADMIN_PERMISSIONS,
  type AdminPermission,
} from '../../rbac/constants/permission-catalog';

export const permissionsForAdminRole = (
  role: AdminRole,
  customPermissions: string[] = [],
): string[] => {
  const permissions =
    role === AdminRole.CustomAdmin ? customPermissions : DEFAULT_ADMIN_PERMISSIONS[role];
  return [...new Set(permissions)].sort();
};
