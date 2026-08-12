import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('administrator dashboard static contracts', () => {
  it('keeps feature guards resolvable from the admin dashboard module', () => {
    const module = read('src/modules/admin-dashboard/admin-dashboard.module.ts');
    expect(module).toContain('AuthModule');
    expect(module).toContain('NotificationsModule');
    expect(module).toContain('AdminAuditModule');
    expect(module).toContain('PaymentsModule');
  });

  it('reuses RBAC for administrator management instead of creating a duplicate admin resource', () => {
    const rbac = read('src/modules/rbac/controllers/rbac.controller.ts');
    expect(rbac).toContain("@Patch('admins/:id')");
    expect(rbac).toContain("@Patch('admins/:id/access')");
    expect(rbac).toContain("@Patch('admins/:id/status')");
    expect(rbac).toContain("@Delete('admins/:id')");

    const customerController = read(
      'src/modules/admin-dashboard/controllers/admin-customers.controller.ts',
    );
    const taskerController = read(
      'src/modules/admin-dashboard/controllers/admin-taskers.controller.ts',
    );
    expect(customerController).not.toContain("@Controller('admin/admins')");
    expect(taskerController).not.toContain("@Controller('admin/admins')");
  });

  it('does not manufacture unavailable Tasker provider verification results', () => {
    const service = read('src/modules/admin-dashboard/services/admin-taskers.service.ts');
    expect(service).toContain('backgroundCheck: null');
    expect(service).toContain('insuranceVerification: null');
    expect(service).toContain("{ in: ['submitted', 'pending_review'] }");
  });

  it('adds only the administrative audit table in the v3.7 foundation migration', () => {
    const migration = read(
      'prisma/migrations/20260808090000_add_admin_dashboard_foundation/migration.sql',
    );
    expect(migration).toContain('CREATE TABLE "AdminAuditLogs"');
    expect(migration).not.toMatch(/INSERT\s+INTO/i);
    expect(migration).not.toContain('ALTER TABLE "Bookings"');
    expect(migration).not.toContain('ALTER TABLE "PaymentTransactions"');
  });
});
