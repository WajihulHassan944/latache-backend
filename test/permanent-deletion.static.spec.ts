import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('permanent deletion architecture', () => {
  it('protects account deletion with explicit RBAC permissions and confirmation', () => {
    const permissions = read('src/modules/rbac/constants/permission-catalog.ts');
    const customerController = read(
      'src/modules/admin-dashboard/controllers/admin-customers.controller.ts',
    );
    const taskerController = read(
      'src/modules/admin-dashboard/controllers/admin-taskers.controller.ts',
    );
    const dto = read('src/modules/account-deletion/dto/permanent-delete.dto.ts');

    expect(permissions).toContain("key: 'customers.delete'");
    expect(permissions).toContain("key: 'taskers.delete'");
    expect(customerController).toContain("@Permissions('customers.delete')");
    expect(taskerController).toContain("@Permissions('taskers.delete')");
    expect(dto).toContain("@IsIn(['PERMANENT_DELETE'])");
  });

  it('locks and rechecks before a physical user delete while preserving financial history', () => {
    const source = read('src/modules/account-deletion/account-deletion.service.ts');
    for (const marker of [
      'FOR UPDATE',
      'ACCOUNT_PURGE_BLOCKED',
      'paymentTransaction.count',
      'customerWalletLedgerEntry.count',
      'taskerWalletLedgerEntry.count',
      'taskerEarning.count',
      'taskerPlatformReceivable.count',
      'taskerWithdrawal.count',
      'await tx.user.delete',
      'account_permanently_deleted',
    ]) {
      expect(source).toContain(marker);
    }
    expect(source).not.toContain('deletedAt: new Date()');
  });

  it('uses a durable idempotent object-storage deletion outbox and worker job', () => {
    const schema = read('prisma/schema.prisma');
    const migration = read(
      'prisma/migrations/20260812233000_add_permanent_deletion_controls/migration.sql',
    );
    const worker = read('src/infrastructure/jobs/performance-jobs.service.ts');
    const purge = read('src/modules/account-deletion/object-storage-deletion.service.ts');

    expect(schema).toContain('model ObjectStorageDeletionTask');
    expect(migration).toContain('storage_deletion_provider_public_resource_unique');
    expect(worker).toContain("PurgeDeletedAssets: 'storage.purge-deleted-assets'");
    expect(purge).toContain("status: 'processing'");
    expect(purge).toContain("status: 'completed'");
    expect(purge).toContain("status: 'failed'");
    expect(purge).toContain('nextAttemptAt');
  });

  it('has no remaining HTTP DELETE implementation that writes deletedAt', () => {
    const taskerProfile = read('src/modules/tasker-dashboard/services/tasker-profile.service.ts');
    const wallet = read('src/modules/tasker-dashboard/services/tasker-wallet.service.ts');
    const rbac = read('src/modules/rbac/repositories/rbac.repository.ts');

    expect(taskerProfile).not.toContain('deletedAt: new Date()');
    expect(wallet).not.toContain('data: { deletedAt: new Date()');
    expect(rbac).not.toContain('softDelete');
  });
});
