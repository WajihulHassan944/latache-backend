import { Injectable } from '@nestjs/common';
import type { Prisma, RbacRole, User } from '../../../generated/prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AccountStatus } from '../../../common/enums/account-status.enum';
import { UserRole } from '../../../common/enums/user-role.enum';

export interface RbacRoleWithAdminCount extends RbacRole {
  _count: { users: number };
}

export interface AdminWithRbacRole extends User {
  rbacRole: RbacRole | null;
}

@Injectable()
export class RbacRepository {
  constructor(private readonly prisma: PrismaService) {}

  findRoleById(id: string, transaction?: Prisma.TransactionClient): Promise<RbacRole | null> {
    return (transaction ?? this.prisma).rbacRole.findUnique({ where: { id } });
  }

  findRoleByCode(code: string, transaction?: Prisma.TransactionClient): Promise<RbacRole | null> {
    return (transaction ?? this.prisma).rbacRole.findUnique({ where: { code } });
  }

  async listRoles(
    where: Prisma.RbacRoleWhereInput,
    skip: number,
    take: number,
  ): Promise<{ roles: RbacRoleWithAdminCount[]; totalItems: number }> {
    const [roles, totalItems] = await this.prisma.$transaction([
      this.prisma.rbacRole.findMany({
        where,
        skip,
        take,
        orderBy: [{ isSystem: 'desc' }, { createdAt: 'desc' }],
        include: { _count: { select: { users: true } } },
      }),
      this.prisma.rbacRole.count({ where }),
    ]);
    return { roles: roles as RbacRoleWithAdminCount[], totalItems };
  }

  createRole(data: Prisma.RbacRoleCreateInput): Promise<RbacRole> {
    return this.prisma.rbacRole.create({ data });
  }

  updateRole(id: string, data: Prisma.RbacRoleUpdateInput): Promise<RbacRole> {
    return this.prisma.rbacRole.update({ where: { id }, data });
  }

  countAdminsUsingRole(id: string): Promise<number> {
    return this.prisma.user.count({
      where: {
        rbacRoleId: id,
        role: { in: [UserRole.Admin, UserRole.SuperAdmin] },
        deletedAt: null,
      },
    });
  }

  async replaceRolePermissions(
    id: string,
    permissions: string[],
  ): Promise<{
    role: RbacRole;
    synchronizedAdminCount: number;
    constrainedOverrideAdminCount: number;
  }> {
    return this.prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
      const role = await transaction.rbacRole.update({
        where: { id },
        data: { permissions },
      });

      const synchronized = await transaction.user.updateMany({
        where: {
          rbacRoleId: id,
          inheritsRolePermissions: true,
          role: { in: [UserRole.Admin, UserRole.SuperAdmin] },
          deletedAt: null,
        },
        data: {
          adminRole: role.code,
          permissions,
        },
      });

      // Explicit overrides remain least-privilege subsets of the role. When a
      // permission is removed from the role, it is also removed from every
      // administrator-specific override in the same transaction.
      const overriddenAdmins = await transaction.user.findMany({
        where: {
          rbacRoleId: id,
          inheritsRolePermissions: false,
          role: UserRole.Admin,
          deletedAt: null,
        },
        select: { id: true, permissions: true },
      });
      const allowedPermissions = new Set(permissions);
      let constrainedOverrideAdminCount = 0;

      for (const admin of overriddenAdmins) {
        const constrainedPermissions = admin.permissions.filter((permission) =>
          allowedPermissions.has(permission),
        );
        if (constrainedPermissions.length === admin.permissions.length) continue;

        await transaction.user.update({
          where: { id: admin.id },
          data: { permissions: constrainedPermissions },
        });
        constrainedOverrideAdminCount += 1;
      }

      return {
        role,
        synchronizedAdminCount: synchronized.count,
        constrainedOverrideAdminCount,
      };
    });
  }

  softDeleteRole(id: string): Promise<RbacRole> {
    return this.prisma.rbacRole.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date() },
    });
  }

  async listAdmins(
    where: Prisma.UserWhereInput,
    skip: number,
    take: number,
  ): Promise<{ admins: AdminWithRbacRole[]; totalItems: number }> {
    const [admins, totalItems] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: { rbacRole: true },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { admins: admins as AdminWithRbacRole[], totalItems };
  }

  findAdminById(id: number): Promise<AdminWithRbacRole | null> {
    return this.prisma.user.findFirst({
      where: {
        id,
        role: { in: [UserRole.Admin, UserRole.SuperAdmin] },
        deletedAt: null,
      },
      include: { rbacRole: true },
    });
  }

  async assignAdminAccess(
    adminId: number,
    role: RbacRole,
    permissions: string[],
    inheritsRolePermissions: boolean,
  ): Promise<AdminWithRbacRole> {
    return this.prisma.user.update({
      where: { id: adminId },
      data: {
        rbacRoleId: role.id,
        adminRole: role.code,
        permissions,
        inheritsRolePermissions,
      },
      include: { rbacRole: true },
    });
  }

  updateAdminProfile(
    id: number,
    data: Partial<Pick<Prisma.UserUpdateInput, 'firstName' | 'lastName' | 'phoneCountryCode' | 'phoneNumber'>>,
  ): Promise<AdminWithRbacRole> {
    return this.prisma.user.update({
      where: { id },
      data,
      include: { rbacRole: true },
    });
  }

  async softDeleteAdmin(id: number): Promise<User> {
    return this.prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
      const user = await transaction.user.update({
        where: { id },
        data: { accountStatus: AccountStatus.Deactivated, deletedAt: new Date() },
      });
      await transaction.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return user;
    });
  }

  updateAdminStatus(id: number, accountStatus: string): Promise<User> {
    return this.prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
      const user = await transaction.user.update({
        where: { id },
        data: { accountStatus },
      });

      if (accountStatus !== AccountStatus.Active) {
        await transaction.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      return user;
    });
  }
}
