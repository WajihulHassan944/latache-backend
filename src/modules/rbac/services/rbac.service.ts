import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, RbacRole, User } from '../../../generated/prisma/client';
import { AccountStatus } from '../../../common/enums/account-status.enum';
import { AdminRole } from '../../../common/enums/admin-role.enum';
import { UserRole } from '../../../common/enums/user-role.enum';
import { normalizePagination } from '../../../common/utils/pagination.util';
import { AdminAuditService } from '../../admin-audit/admin-audit.service';
import { success, type SuccessEnvelope } from '../../auth/auth-response';
import type {
  AdminAccessUpdateView,
  AdminStatusUpdateView,
  EffectiveAccessView,
  PermissionCatalogView,
  RbacAdminListData,
  RbacAdminView,
  RbacRoleListData,
  RbacRoleView,
  RolePermissionsUpdateView,
} from '../rbac.contracts';
import type {
  AssignAdminAccessDto,
  CreateRbacRoleDto,
  ListRbacAdminsDto,
  ListRbacRolesDto,
  UpdateAdminProfileDto,
  UpdateAdminStatusDto,
  UpdateRbacRoleDto,
  UpdateRolePermissionsDto,
} from '../dto';
import {
  RbacRepository,
  type AdminWithRbacRole,
  type RbacRoleWithAdminCount,
} from '../repositories/rbac.repository';
import { RbacAccessService } from './rbac-access.service';

@Injectable()
export class RbacService {
  constructor(
    private readonly repository: RbacRepository,
    private readonly access: RbacAccessService,
    private readonly audit: AdminAuditService,
  ) {}

  permissions(): SuccessEnvelope<PermissionCatalogView> {
    return success(this.access.catalog(), 'Permission catalogue fetched successfully.');
  }

  async listRoles(query: ListRbacRolesDto): Promise<SuccessEnvelope<RbacRoleListData>> {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 20);
    const search = query.search?.trim();
    const where: Prisma.RbacRoleWhereInput = {
      deletedAt: null,
      ...(query.isSystem === undefined ? {} : { isSystem: query.isSystem }),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { code: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const result = await this.repository.listRoles(where, offset, limit);
    return success(
      {
        roles: result.roles.map((role) => this.toRole(role)),
        pagination: {
          page,
          limit,
          totalItems: result.totalItems,
          totalPages: Math.ceil(result.totalItems / limit),
        },
      },
      'Administrator roles fetched successfully.',
    );
  }

  async roleDetails(id: string): Promise<SuccessEnvelope<RbacRoleView>> {
    const role = await this.access.requireRoleById(id);
    const adminCount = await this.repository.countAdminsUsingRole(role.id);
    return success(this.toRole({ ...role, _count: { users: adminCount } }), 'Administrator role fetched successfully.');
  }

  async createRole(dto: CreateRbacRoleDto): Promise<SuccessEnvelope<RbacRoleView>> {
    const code = this.access.normalizeRoleCode(dto.code ?? dto.name);
    if (!/^[a-z][a-z0-9_]{2,63}$/.test(code)) {
      throw new BadRequestException('Role code must be lower_snake_case and 3 to 64 characters long');
    }
    if (await this.repository.findRoleByCode(code)) {
      throw new ConflictException('An administrator role with this code already exists');
    }

    const permissions = this.access.validatePermissionKeys(dto.permissions);
    const role = await this.repository.createRole({
      code,
      name: dto.name,
      description: dto.description,
      permissions,
      isSystem: false,
      isActive: true,
    });
    return success(this.toRole({ ...role, _count: { users: 0 } }), 'Administrator role created successfully.');
  }

  async updateRole(id: string, dto: UpdateRbacRoleDto): Promise<SuccessEnvelope<RbacRoleView>> {
    if (dto.name === undefined && dto.description === undefined && dto.isActive === undefined) {
      throw new BadRequestException('At least one role field must be supplied');
    }

    const role = await this.access.requireRoleById(id);
    this.assertMutableRole(role);
    if (role.isSystem && dto.isActive === false) {
      throw new ForbiddenException('System administrator roles cannot be deactivated');
    }
    if (dto.isActive === false && (await this.repository.countAdminsUsingRole(role.id)) > 0) {
      throw new BadRequestException('Role cannot be deactivated while administrators are assigned to it');
    }

    const updated = await this.repository.updateRole(role.id, {
      ...(dto.name === undefined ? {} : { name: dto.name }),
      ...(dto.description === undefined ? {} : { description: dto.description }),
      ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
    });
    const adminCount = await this.repository.countAdminsUsingRole(role.id);
    return success(this.toRole({ ...updated, _count: { users: adminCount } }), 'Administrator role updated successfully.');
  }

  async updateRolePermissions(
    id: string,
    dto: UpdateRolePermissionsDto,
  ): Promise<SuccessEnvelope<RolePermissionsUpdateView>> {
    const role = await this.access.requireRoleById(id);
    this.assertMutableRole(role);
    const permissions = this.access.validatePermissionKeys(dto.permissions);
    const result = await this.repository.replaceRolePermissions(role.id, permissions);
    return success(
      {
        id: result.role.id,
        code: result.role.code,
        permissions: result.role.permissions,
        synchronizedAdminCount: result.synchronizedAdminCount,
        constrainedOverrideAdminCount: result.constrainedOverrideAdminCount,
      },
      'Role permissions updated and assigned administrator access synchronized successfully.',
    );
  }

  async deleteRole(id: string): Promise<SuccessEnvelope<null>> {
    const role = await this.access.requireRoleById(id);
    this.assertMutableRole(role);
    if (role.isSystem) {
      throw new ForbiddenException('System administrator roles cannot be deleted');
    }
    if ((await this.repository.countAdminsUsingRole(role.id)) > 0) {
      throw new BadRequestException('Role cannot be deleted while administrators are assigned to it');
    }
    await this.repository.softDeleteRole(role.id);
    return success(null, 'Administrator role deleted successfully.');
  }

  async listAdmins(query: ListRbacAdminsDto): Promise<SuccessEnvelope<RbacAdminListData>> {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 20);
    const search = query.search?.trim();
    const roleCode = query.roleCode?.trim().toLowerCase();
    const where: Prisma.UserWhereInput = {
      role: { in: [UserRole.Admin, UserRole.SuperAdmin] },
      deletedAt: null,
      ...(query.accountStatus ? { accountStatus: query.accountStatus } : {}),
      ...(roleCode ? { adminRole: roleCode } : {}),
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const result = await this.repository.listAdmins(where, offset, limit);
    return success(
      {
        admins: result.admins.map((admin) => this.toAdmin(admin)),
        pagination: {
          page,
          limit,
          totalItems: result.totalItems,
          totalPages: Math.ceil(result.totalItems / limit),
        },
      },
      'Administrators fetched successfully.',
    );
  }

  async adminDetails(id: number): Promise<SuccessEnvelope<RbacAdminView>> {
    const admin = await this.requireAdmin(id);
    return success(this.toAdmin(admin), 'Administrator access fetched successfully.');
  }

  async currentAccess(user: User): Promise<SuccessEnvelope<EffectiveAccessView>> {
    const admin = await this.requireAdmin(user.id);
    return success(
      {
        userId: admin.id,
        role: admin.role,
        adminRole: admin.adminRole,
        permissions: admin.permissions,
        inheritsRolePermissions: admin.inheritsRolePermissions,
        rbacRole: this.toAdmin(admin).rbacRole,
      },
      'Effective administrator access fetched successfully.',
    );
  }

  async assignAdminAccess(
    actor: User,
    adminId: number,
    dto: AssignAdminAccessDto,
  ): Promise<SuccessEnvelope<AdminAccessUpdateView>> {
    const admin = await this.requireAdmin(adminId);
    this.assertActorPermission(actor, 'admins.update');
    this.assertManageableAdmin(actor, admin);
    const role = await this.access.requireActiveRoleByCode(dto.roleCode);
    if (role.code === AdminRole.SuperAdmin) {
      throw new ForbiddenException('The canonical super administrator role cannot be assigned through the API');
    }
    const effective = this.access.resolveEffectivePermissions(role, dto.permissions);
    this.assertNoPrivilegeEscalation(actor, effective.permissions);
    const updated = await this.repository.assignAdminAccess(
      admin.id,
      role,
      effective.permissions,
      effective.inheritsRolePermissions,
    );
    await this.audit.record({
      actorId: actor.id,
      targetUserId: admin.id,
      action: 'administrator_access_updated',
      entityType: 'administrator',
      entityId: admin.id,
      metadata: {
        previousAdminRole: admin.adminRole,
        nextAdminRole: role.code,
        permissions: effective.permissions,
        inheritsRolePermissions: effective.inheritsRolePermissions,
      },
    });
    return success(
      { admin: this.toAdmin(updated) },
      'Administrator role and effective permissions updated successfully.',
    );
  }

  async updateAdminProfile(
    actor: User,
    adminId: number,
    dto: UpdateAdminProfileDto,
  ): Promise<SuccessEnvelope<RbacAdminView>> {
    const admin = await this.requireAdmin(adminId);
    this.assertActorPermission(actor, 'admins.update');
    this.assertManageableAdmin(actor, admin);
    if (
      dto.firstName === undefined &&
      dto.lastName === undefined &&
      dto.phoneCountryCode === undefined &&
      dto.phoneNumber === undefined
    ) {
      throw new BadRequestException('At least one administrator profile field must be supplied');
    }

    const updated = await this.repository.updateAdminProfile(admin.id, {
      ...(dto.firstName === undefined ? {} : { firstName: dto.firstName.trim() }),
      ...(dto.lastName === undefined ? {} : { lastName: dto.lastName.trim() }),
      ...(dto.phoneCountryCode === undefined ? {} : { phoneCountryCode: dto.phoneCountryCode }),
      ...(dto.phoneNumber === undefined ? {} : { phoneNumber: dto.phoneNumber }),
    });
    await this.audit.record({
      actorId: actor.id,
      targetUserId: admin.id,
      action: 'administrator_profile_updated',
      entityType: 'administrator',
      entityId: admin.id,
      metadata: {
        changedFields: Object.entries(dto)
          .filter(([, value]) => value !== undefined)
          .map(([key]) => key),
      },
    });
    return success(this.toAdmin(updated), 'Administrator profile updated successfully.');
  }

  async deleteAdmin(actor: User, adminId: number): Promise<SuccessEnvelope<null>> {
    const admin = await this.requireAdmin(adminId);
    this.assertActorPermission(actor, 'admins.delete');
    this.assertManageableAdmin(actor, admin);
    await this.repository.softDeleteAdmin(admin.id);
    await this.audit.record({
      actorId: actor.id,
      targetUserId: admin.id,
      action: 'administrator_deleted',
      entityType: 'administrator',
      entityId: admin.id,
      reason: 'Administrator account soft-deleted by an authorized administrator.',
      metadata: { previousStatus: admin.accountStatus, adminRole: admin.adminRole },
    });
    return success(null, 'Administrator account deleted successfully.');
  }

  async updateAdminStatus(
    actor: User,
    adminId: number,
    dto: UpdateAdminStatusDto,
  ): Promise<SuccessEnvelope<AdminStatusUpdateView>> {
    const admin = await this.requireAdmin(adminId);
    this.assertActorPermission(
      actor,
      dto.accountStatus === AccountStatus.Deactivated ? 'admins.delete' : 'admins.suspend',
    );
    this.assertManageableAdmin(actor, admin);
    if (admin.accountStatus === dto.accountStatus) {
      throw new ConflictException(`Administrator is already ${dto.accountStatus.replaceAll('_', ' ')}`);
    }
    if (dto.accountStatus !== AccountStatus.Active && !dto.reason?.trim()) {
      throw new BadRequestException('A reason is required when suspending or deactivating an administrator');
    }
    const updated = await this.repository.updateAdminStatus(admin.id, dto.accountStatus);
    await this.audit.record({
      actorId: actor.id,
      targetUserId: admin.id,
      action: `administrator_${dto.accountStatus}`,
      entityType: 'administrator',
      entityId: admin.id,
      reason: dto.reason,
      metadata: { previousStatus: admin.accountStatus, nextStatus: dto.accountStatus },
    });
    return success(
      { id: updated.id, accountStatus: updated.accountStatus as AccountStatus },
      'Administrator account status updated successfully.',
    );
  }

  private async requireAdmin(id: number): Promise<AdminWithRbacRole> {
    const admin = await this.repository.findAdminById(id);
    if (!admin) throw new NotFoundException('Administrator not found');
    return admin;
  }

  private assertMutableRole(role: RbacRole): void {
    if (role.code === AdminRole.SuperAdmin) {
      throw new ForbiddenException('The canonical super administrator role is immutable');
    }
  }

  private assertManageableAdmin(actor: User, target: User): void {
    if (actor.id === target.id) {
      throw new ForbiddenException('Administrators cannot modify their own RBAC assignment or account status');
    }
    if (target.role === UserRole.SuperAdmin || target.adminRole === AdminRole.SuperAdmin) {
      throw new ForbiddenException('The canonical super administrator cannot be modified');
    }
    if (actor.role !== UserRole.SuperAdmin) {
      this.assertNoPrivilegeEscalation(actor, target.permissions);
    }
  }

  private assertActorPermission(actor: User, permission: string): void {
    if (actor.role === UserRole.SuperAdmin) return;
    if (actor.role !== UserRole.Admin || !actor.permissions.includes(permission)) {
      throw new ForbiddenException(`Missing required permission: ${permission}`);
    }
  }

  private assertNoPrivilegeEscalation(actor: User, targetPermissions: string[]): void {
    if (actor.role === UserRole.SuperAdmin) return;
    const available = new Set(actor.permissions);
    const escalation = targetPermissions.filter((permission) => !available.has(permission));
    if (escalation.length > 0) {
      throw new ForbiddenException(
        `Cannot manage administrator permissions outside your own access: ${escalation.join(', ')}`,
      );
    }
  }

  private toRole(role: RbacRoleWithAdminCount): RbacRoleView {
    return {
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description,
      permissions: role.permissions,
      isSystem: role.isSystem,
      isActive: role.isActive,
      adminCount: role._count.users,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }

  private toAdmin(admin: AdminWithRbacRole): RbacAdminView {
    return {
      id: admin.id,
      adminId: `ADM-${String(admin.id).padStart(3, '0')}`,
      firstName: admin.firstName,
      lastName: admin.lastName,
      email: admin.email,
      phoneCountryCode: admin.phoneCountryCode,
      phoneNumber: admin.phoneNumber,
      profilePicture: admin.profilePicture,
      role: admin.role,
      accountStatus: admin.accountStatus,
      adminRole: admin.adminRole,
      permissions: admin.permissions,
      inheritsRolePermissions: admin.inheritsRolePermissions,
      rbacRole: admin.rbacRole
        ? {
            id: admin.rbacRole.id,
            code: admin.rbacRole.code,
            name: admin.rbacRole.name,
            description: admin.rbacRole.description,
            permissions: admin.rbacRole.permissions,
            isSystem: admin.rbacRole.isSystem,
            isActive: admin.rbacRole.isActive,
          }
        : null,
      createdById: admin.createdById,
      lastLoginAt: admin.lastLoginAt,
      createdAt: admin.createdAt,
      updatedAt: admin.updatedAt,
    };
  }
}
