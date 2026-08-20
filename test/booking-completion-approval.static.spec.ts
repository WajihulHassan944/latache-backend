import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('booking completion approval production flow', () => {
  const root = process.cwd();
  const read = (path: string): string => readFileSync(join(root, path), 'utf8');

  it('separates Tasker submission from customer-approved payment finalization', () => {
    const tasker = read('src/modules/tasker-dashboard/services/tasker-tasks.service.ts');
    const controller = read('src/modules/bookings/bookings.controller.ts');
    expect(tasker).toContain('status: TASKER_BOOKING_STATUS.AwaitingCustomerApproval');
    expect(tasker).toContain('completionApprovalDueAt: approvalDueAt');
    expect(tasker).not.toContain(
      'data: { status: TASKER_BOOKING_STATUS.Completed, taskCompletedAt: now }',
    );
    expect(controller).toContain("booking.status === 'awaiting_customer_approval'");
    expect(controller.indexOf("booking.status === 'awaiting_customer_approval'")).toBeLessThan(
      controller.lastIndexOf('finalizeCompletedBooking'),
    );
  });

  it('uses a locked idempotent worker and blocks active disputes', () => {
    const bookings = read('src/modules/bookings/bookings.service.ts');
    const jobs = read('src/infrastructure/jobs/performance-jobs.service.ts');
    expect(bookings).toContain('autoCompleteDueBookings');
    expect(bookings).toContain('FOR UPDATE');
    expect(bookings).toContain("booking.status !== 'awaiting_customer_approval'");
    expect(bookings).toContain("status: { in: ['open', 'under_investigation', 'escalated'] }");
    expect(bookings).toContain('completionAutoApprovedAt: now');
    expect(jobs).toContain("AutoCompleteBookings: 'bookings.auto-complete'");
    expect(jobs).toContain('auto-complete-bookings-v1');
  });

  it('exposes policy configuration and an additive indexed migration', () => {
    expect(read('.env.example')).toContain('BOOKING_COMPLETION_APPROVAL_HOURS=24');
    expect(read('src/modules/platform-settings/dto/platform-settings.dto.ts')).toContain(
      'completionApprovalHours',
    );
    const migration = read(
      'prisma/migrations/20260818120000_add_booking_completion_approval/migration.sql',
    );
    expect(migration).toContain('ADD COLUMN "completionApprovalDueAt"');
    expect(migration).toContain('bookings_completion_approval_due_idx');
    expect(migration.toLowerCase()).not.toContain('drop table');
  });
});
