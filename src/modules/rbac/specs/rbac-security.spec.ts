import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('RBAC route security', () => {
  const controller = readFileSync(join(__dirname, '../controllers/rbac.controller.ts'), 'utf8');
  const repository = readFileSync(join(__dirname, '../repositories/rbac.repository.ts'), 'utf8');

  it('protects read APIs with permission checks and writes with super-admin role checks', () => {
    expect(controller).toContain("@Permissions('roles.read')");
    expect(controller).toContain("@Permissions('admins.read')");
    expect(controller).toContain('@Roles(UserRole.SuperAdmin)');
    expect(controller).toContain('@UseGuards(AdminAuthGuard, PermissionsGuard)');
    expect(controller).toContain('@UseGuards(AdminAuthGuard, RolesGuard)');
  });

  it('synchronizes inherited access and constrains explicit overrides', () => {
    expect(repository).toContain('inheritsRolePermissions: true');
    expect(repository).toContain('inheritsRolePermissions: false');
    expect(repository).toContain('constrainedPermissions');
    expect(repository).toContain('transaction.user.updateMany');
  });

  it('revokes active sessions when an administrator is suspended or deactivated', () => {
    expect(repository).toContain('accountStatus !== AccountStatus.Active');
    expect(repository).toContain('transaction.refreshToken.updateMany');
  });

  it('exposes canonical role, permission, admin access, and status endpoints', () => {
    for (const route of [
      "@Get('permissions')",
      "@Get('roles')",
      "@Post('roles')",
      "@Put('roles/:id/permissions')",
      "@Get('admins')",
      "@Patch('admins/:id/access')",
      "@Patch('admins/:id/status')",
    ]) {
      expect(controller).toContain(route);
    }
  });
});
