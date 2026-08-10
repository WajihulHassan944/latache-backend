import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Administrator registration RBAC integration', () => {
  const registration = readFileSync(
    join(__dirname, 'services/auth-registration.service.ts'),
    'utf8',
  );
  const dto = readFileSync(join(__dirname, 'dto/create-admin.dto.ts'), 'utf8');

  it('resolves role codes from the persistent RBAC model', () => {
    expect(registration).toContain('RbacAccessService');
    expect(registration).toContain('requireActiveRoleByCode(dto.adminRole)');
    expect(registration).toContain('rbacRoleId: role.id');
  });

  it('supports inherited permissions and validated least-privilege overrides', () => {
    expect(registration).toContain('resolveEffectivePermissions(role, dto.permissions)');
    expect(registration).toContain('inheritsRolePermissions');
    expect(dto).toContain('Optional least-privilege subset');
  });
});
