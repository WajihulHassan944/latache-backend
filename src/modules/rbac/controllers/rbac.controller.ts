import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { User } from '../../../generated/prisma/client';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AdminAuthGuard } from '../../auth/guards/admin-auth.guard';
import type { SuccessEnvelope } from '../../auth/auth-response';
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
import {
  AssignAdminAccessDto,
  CreateRbacRoleDto,
  ListRbacAdminsDto,
  ListRbacRolesDto,
  UpdateAdminProfileDto,
  UpdateAdminStatusDto,
  UpdateRbacRoleDto,
  UpdateRolePermissionsDto,
} from '../dto';
import { RbacService } from '../services/rbac.service';

@ApiTags('03 RBAC - Roles & Permissions')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'A valid active administrator session is required.' })
@Controller('rbac')
export class RbacController {
  constructor(private readonly rbac: RbacService) {}

  @Get('me')
  @UseGuards(AdminAuthGuard)
  @ApiOperation({
    summary: 'Get the current administrator effective access',
    description:
      'Returns the assigned RBAC role, effective permission keys, and whether permissions inherit future role changes. Super admin receives the canonical full-access role.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        success: true,
        data: {
          userId: 20,
          role: 'admin',
          adminRole: 'finance_admin',
          permissions: ['finance.read', 'finance.manage', 'reports.read'],
          inheritsRolePermissions: true,
          rbacRole: {
            id: 'role_finance_admin',
            code: 'finance_admin',
            name: 'Finance Administrator',
            isSystem: true,
            isActive: true,
          },
        },
        message: 'Effective administrator access fetched successfully.',
      },
    },
  })
  currentAccess(@CurrentUser() user: User): Promise<SuccessEnvelope<EffectiveAccessView>> {
    return this.rbac.currentAccess(user);
  }

  @Get('permissions')
  @UseGuards(AdminAuthGuard, PermissionsGuard)
  @Permissions('roles.read')
  @ApiOperation({
    summary: 'Get the assignable permission catalogue',
    description:
      'Read-only server-owned catalogue for admin forms. Permission keys cannot be created through the API because every permission must correspond to an implemented backend capability.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        success: true,
        data: {
          modules: [
            {
              module: 'finance',
              label: 'Finance',
              permissions: [
                { key: 'finance.read', label: 'View finance', description: 'View financial summaries.' },
                { key: 'finance.manage', label: 'Manage finance', description: 'Perform permitted finance actions.' },
              ],
            },
          ],
          permissions: ['finance.read', 'finance.manage', 'reports.read'],
        },
        message: 'Permission catalogue fetched successfully.',
      },
    },
  })
  @ApiForbiddenResponse({ description: 'Administrator lacks roles.read.' })
  permissions(): SuccessEnvelope<PermissionCatalogView> {
    return this.rbac.permissions();
  }

  @Get('roles')
  @UseGuards(AdminAuthGuard, PermissionsGuard)
  @Permissions('roles.read')
  @ApiOperation({
    summary: 'List administrator roles',
    description:
      'Returns system and custom RBAC roles with effective role permissions and assigned administrator counts. Used to populate the administrator creation and access-management forms.',
  })
  @ApiOkResponse({ description: 'Paginated role list.' })
  @ApiForbiddenResponse({ description: 'Administrator lacks roles.read.' })
  listRoles(@Query() query: ListRbacRolesDto): Promise<SuccessEnvelope<RbacRoleListData>> {
    return this.rbac.listRoles(query);
  }

  @Get('roles/:id')
  @UseGuards(AdminAuthGuard, PermissionsGuard)
  @Permissions('roles.read')
  @ApiOperation({ summary: 'Get an administrator role' })
  @ApiParam({ name: 'id', example: 'role_finance_admin' })
  @ApiOkResponse({ description: 'Role details including permissions and assigned administrator count.' })
  @ApiNotFoundResponse({ description: 'Role does not exist or was deleted.' })
  roleDetails(@Param('id') id: string): Promise<SuccessEnvelope<RbacRoleView>> {
    return this.rbac.roleDetails(id);
  }

  @Post('roles')
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles(UserRole.SuperAdmin)
  @ApiOperation({
    summary: 'Create a custom administrator role',
    description:
      'Super-admin-only. Creates a reusable custom role from permission keys returned by GET /api/rbac/permissions. Role codes are immutable after creation.',
  })
  @ApiCreatedResponse({
    schema: {
      example: {
        success: true,
        data: {
          id: 'cm123role',
          code: 'regional_operations_admin',
          name: 'Regional Operations Administrator',
          permissions: ['taskers.read', 'taskers.manage', 'bookings.read'],
          isSystem: false,
          isActive: true,
          adminCount: 0,
        },
        message: 'Administrator role created successfully.',
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Unknown permission key or invalid role code.' })
  @ApiConflictResponse({ description: 'Role code already exists.' })
  @ApiForbiddenResponse({ description: 'Only the canonical super administrator may manage RBAC roles.' })
  createRole(@Body() dto: CreateRbacRoleDto): Promise<SuccessEnvelope<RbacRoleView>> {
    return this.rbac.createRole(dto);
  }

  @Patch('roles/:id')
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles(UserRole.SuperAdmin)
  @ApiOperation({
    summary: 'Update administrator role metadata or active status',
    description:
      'The role code is immutable. The canonical super_admin role cannot be modified, system roles cannot be deactivated, and assigned custom roles cannot be deactivated.',
  })
  @ApiOkResponse({ description: 'Updated role.' })
  @ApiBadRequestResponse({ description: 'No fields provided or the role still has assigned administrators.' })
  @ApiForbiddenResponse({ description: 'Protected role mutation attempted.' })
  @ApiNotFoundResponse({ description: 'Role does not exist.' })
  updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateRbacRoleDto,
  ): Promise<SuccessEnvelope<RbacRoleView>> {
    return this.rbac.updateRole(id, dto);
  }

  @Put('roles/:id/permissions')
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles(UserRole.SuperAdmin)
  @ApiOperation({
    summary: 'Replace a role permission set',
    description:
      'Super-admin-only. Replaces the complete role permission set, synchronizes inherited assignments, and removes permissions from administrator-specific overrides when those permissions no longer belong to the role.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        success: true,
        data: {
          id: 'role_finance_admin',
          code: 'finance_admin',
          permissions: ['finance.read', 'reports.read'],
          synchronizedAdminCount: 3,
          constrainedOverrideAdminCount: 1,
        },
        message: 'Role permissions updated and assigned administrator access synchronized successfully.',
      },
    },
  })
  @ApiBadRequestResponse({ description: 'One or more permission keys are unknown.' })
  @ApiForbiddenResponse({ description: 'The super_admin role is immutable.' })
  updateRolePermissions(
    @Param('id') id: string,
    @Body() dto: UpdateRolePermissionsDto,
  ): Promise<SuccessEnvelope<RolePermissionsUpdateView>> {
    return this.rbac.updateRolePermissions(id, dto);
  }

  @Delete('roles/:id')
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles(UserRole.SuperAdmin)
  @ApiOperation({
    summary: 'Delete a custom administrator role',
    description:
      'Performs a soft delete. System roles and roles currently assigned to administrators cannot be deleted.',
  })
  @ApiOkResponse({ description: 'Role soft-deleted.' })
  @ApiBadRequestResponse({ description: 'Administrators remain assigned to the role.' })
  @ApiForbiddenResponse({ description: 'System or super-admin role deletion attempted.' })
  deleteRole(@Param('id') id: string): Promise<SuccessEnvelope<null>> {
    return this.rbac.deleteRole(id);
  }

  @Get('admins')
  @UseGuards(AdminAuthGuard, PermissionsGuard)
  @Permissions('admins.read')
  @ApiOperation({
    summary: 'List administrators and effective RBAC access',
    description:
      'Returns administrator profile summaries, role assignment, effective permissions, inheritance mode, and account status. Admins require admins.read; super admin bypasses permission checks.',
  })
  @ApiOkResponse({ description: 'Paginated administrator access list.' })
  @ApiForbiddenResponse({ description: 'Administrator lacks admins.read.' })
  listAdmins(@Query() query: ListRbacAdminsDto): Promise<SuccessEnvelope<RbacAdminListData>> {
    return this.rbac.listAdmins(query);
  }

  @Get('admins/:id')
  @UseGuards(AdminAuthGuard, PermissionsGuard)
  @Permissions('admins.read')
  @ApiOperation({ summary: 'Get an administrator RBAC assignment' })
  @ApiParam({ name: 'id', type: Number, example: 20 })
  @ApiOkResponse({ description: 'Administrator access details.' })
  @ApiNotFoundResponse({ description: 'Administrator not found.' })
  adminDetails(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SuccessEnvelope<RbacAdminView>> {
    return this.rbac.adminDetails(id);
  }

  @Patch('admins/:id')
  @UseGuards(AdminAuthGuard, PermissionsGuard)
  @Permissions('admins.update')
  @ApiOperation({
    summary: 'Update an administrator profile',
    description:
      'Updates non-identity profile fields only. Email changes are deliberately excluded because email ownership must go through a separately verified auth flow. Delegated admins cannot modify accounts with broader access than their own.',
  })
  @ApiOkResponse({ description: 'Administrator profile updated.' })
  @ApiBadRequestResponse({ description: 'No editable fields supplied.' })
  @ApiForbiddenResponse({ description: 'Missing admins.update or protected administrator target.' })
  @ApiNotFoundResponse({ description: 'Administrator not found.' })
  updateAdminProfile(
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAdminProfileDto,
  ): Promise<SuccessEnvelope<RbacAdminView>> {
    return this.rbac.updateAdminProfile(actor, id, dto);
  }

  @Patch('admins/:id/access')
  @UseGuards(AdminAuthGuard, PermissionsGuard)
  @Permissions('admins.update')
  @ApiOperation({
    summary: 'Assign an administrator role and optional permission subset',
    description:
      'Requires admins.update. Super admin may assign any non-super-admin access. Delegated admins can only assign permissions they already hold, preventing privilege escalation. Omit permissions to inherit the selected role.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        success: true,
        data: {
          admin: {
            id: 20,
            adminRole: 'finance_admin',
            permissions: ['finance.read', 'reports.read'],
            inheritsRolePermissions: false,
          },
        },
        message: 'Administrator role and effective permissions updated successfully.',
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Unknown permission or override is outside the selected role.' })
  @ApiForbiddenResponse({ description: 'Missing admins.update, self-modification, super-admin modification, or privilege escalation attempted.' })
  @ApiNotFoundResponse({ description: 'Administrator or active role not found.' })
  assignAdminAccess(
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignAdminAccessDto,
  ): Promise<SuccessEnvelope<AdminAccessUpdateView>> {
    return this.rbac.assignAdminAccess(actor, id, dto);
  }

  @Patch('admins/:id/status')
  @UseGuards(AdminAuthGuard)
  @ApiOperation({
    summary: 'Update an administrator account status',
    description:
      'Suspending/reactivating requires admins.suspend; deactivation requires admins.delete. Delegated admins may only manage accounts whose effective permissions are within their own access. The canonical super administrator and current caller remain protected.',
  })
  @ApiOkResponse({ description: 'Administrator account status updated.' })
  @ApiForbiddenResponse({ description: 'Self-modification or super-admin modification attempted.' })
  @ApiNotFoundResponse({ description: 'Administrator not found.' })
  updateAdminStatus(
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAdminStatusDto,
  ): Promise<SuccessEnvelope<AdminStatusUpdateView>> {
    return this.rbac.updateAdminStatus(actor, id, dto);
  }

  @Delete('admins/:id')
  @UseGuards(AdminAuthGuard, PermissionsGuard)
  @Permissions('admins.delete')
  @ApiOperation({
    summary: 'Soft-delete an administrator account',
    description:
      'Revokes active sessions and records deletedAt. The current caller and canonical super administrator are protected. This does not physically remove audit or relational history.',
  })
  @ApiOkResponse({ description: 'Administrator account soft-deleted.' })
  @ApiForbiddenResponse({ description: 'Missing admins.delete or protected administrator target.' })
  @ApiNotFoundResponse({ description: 'Administrator not found.' })
  deleteAdmin(
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SuccessEnvelope<null>> {
    return this.rbac.deleteAdmin(actor, id);
  }
}
