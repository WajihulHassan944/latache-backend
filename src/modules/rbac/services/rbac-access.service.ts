import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { RbacRole } from '../../../generated/prisma/client';
import { AdminRole } from '../../../common/enums/admin-role.enum';
import {
  ADMIN_PERMISSIONS,
  PERMISSION_CATALOG,
  isKnownPermission,
} from '../constants/permission-catalog';
import { RbacRepository } from '../repositories/rbac.repository';
import type { PermissionCatalogView } from '../rbac.contracts';

@Injectable()
export class RbacAccessService {
  constructor(private readonly repository: RbacRepository) {}

  catalog(): PermissionCatalogView {
    return {
      modules: PERMISSION_CATALOG.map((group) => ({
        module: group.module,
        label: group.label,
        permissions: group.permissions.map((permission) => ({ ...permission })),
      })),
      permissions: [...ADMIN_PERMISSIONS],
    };
  }

  async requireActiveRoleByCode(code: string): Promise<RbacRole> {
    const role = await this.repository.findRoleByCode(this.normalizeRoleCode(code));
    if (!role || role.deletedAt || !role.isActive) {
      throw new NotFoundException('Active administrator role not found');
    }
    return role;
  }

  async requireRoleById(id: string): Promise<RbacRole> {
    const role = await this.repository.findRoleById(id);
    if (!role || role.deletedAt) {
      throw new NotFoundException('Administrator role not found');
    }
    return role;
  }

  resolveEffectivePermissions(
    role: RbacRole,
    requestedPermissions?: string[],
  ): { permissions: string[]; inheritsRolePermissions: boolean } {
    if (requestedPermissions === undefined) {
      return {
        permissions: this.normalizePermissions(role.permissions),
        inheritsRolePermissions: true,
      };
    }

    const permissions = this.validatePermissionKeys(requestedPermissions);
    if (role.code !== AdminRole.CustomAdmin) {
      const rolePermissions = new Set(role.permissions);
      const outsideRole = permissions.filter((permission) => !rolePermissions.has(permission));
      if (outsideRole.length > 0) {
        throw new BadRequestException(
          `Permission overrides must be a subset of ${role.code}: ${outsideRole.join(', ')}`,
        );
      }
    }

    return { permissions, inheritsRolePermissions: false };
  }

  validatePermissionKeys(permissions: string[]): string[] {
    const normalized = this.normalizePermissions(permissions);
    const unknown = normalized.filter((permission) => !isKnownPermission(permission));
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown permissions: ${unknown.join(', ')}`);
    }
    return normalized;
  }

  normalizeRoleCode(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  private normalizePermissions(permissions: readonly string[]): string[] {
    return [...new Set(permissions.map((permission) => permission.trim()).filter(Boolean))].sort();
  }
}
