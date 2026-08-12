import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminRole } from '../../../common/enums/admin-role.enum';
import { RbacAccessService } from '../services/rbac-access.service';

const financeRole = {
  id: 'role_finance_admin',
  code: AdminRole.FinanceAdmin,
  name: 'Finance Administrator',
  description: null,
  permissions: ['finance.read', 'finance.manage', 'reports.read'],
  isSystem: true,
  isActive: true,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('RbacAccessService', () => {
  const repository = {
    findRoleByCode: jest.fn(),
    findRoleById: jest.fn(),
  };
  const service = new RbacAccessService(repository as never);

  beforeEach(() => jest.clearAllMocks());

  it('returns the server-owned permission catalogue', () => {
    const catalog = service.catalog();
    expect(catalog.permissions).toContain('finance.read');
    expect(catalog.modules.find((group) => group.module === 'roles')).toBeDefined();
  });

  it('uses inherited permissions when no override is supplied', () => {
    expect(service.resolveEffectivePermissions(financeRole as never)).toEqual({
      permissions: ['finance.manage', 'finance.read', 'reports.read'],
      inheritsRolePermissions: true,
    });
  });

  it('accepts only a subset as an administrator-specific override', () => {
    expect(
      service.resolveEffectivePermissions(financeRole as never, ['reports.read', 'finance.read']),
    ).toEqual({
      permissions: ['finance.read', 'reports.read'],
      inheritsRolePermissions: false,
    });

    expect(() =>
      service.resolveEffectivePermissions(financeRole as never, ['admins.create']),
    ).toThrow(BadRequestException);
  });

  it('rejects missing and inactive roles', async () => {
    repository.findRoleByCode.mockResolvedValueOnce(null);
    await expect(service.requireActiveRoleByCode('unknown')).rejects.toThrow(NotFoundException);

    repository.findRoleByCode.mockResolvedValueOnce({ ...financeRole, isActive: false });
    await expect(service.requireActiveRoleByCode('finance_admin')).rejects.toThrow(
      NotFoundException,
    );
  });
});
