import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('booking lifecycle admin audit trail', () => {
  const root = process.cwd();
  const read = (path: string): string => readFileSync(join(root, path), 'utf8');

  it('records booking creation and customer cancellation', () => {
    const bookings = read('src/modules/bookings/bookings.service.ts');
    expect(bookings).toContain("action: 'booking_created'");
    expect(bookings).toContain("action: 'booking_cancelled_by_customer'");
  });

  it('records Tasker acceptance, cancellation, and arrival', () => {
    const tasks = read('src/modules/tasker-dashboard/services/tasker-tasks.service.ts');
    expect(tasks).toContain("action: 'booking_confirmed_by_tasker'");
    expect(tasks).toContain("action: 'booking_cancelled_by_tasker'");
    expect(tasks).toContain("action: 'booking_tasker_arrived'");
  });

  it('always joins notification writes to the surrounding state-transition transaction', () => {
    // A bare notifications.create(userId, {...}) call with no trailing `transaction` argument
    // would fire outside the state-change transaction; every call site here must pass one so a
    // rolled-back status change can never leave behind a notification that claims it happened.
    const callsWithoutTransaction = (source: string): string[] => {
      const calls: string[] = [];
      const pattern = /this\.notifications\.create\(([\s\S]*?)\);/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source))) {
        const args = match[1] ?? '';
        if (!/,\s*transaction,?\s*$/.test(args.trim())) calls.push(match[0]);
      }
      return calls;
    };
    expect(callsWithoutTransaction(read('src/modules/bookings/bookings.service.ts'))).toEqual([]);
    expect(
      callsWithoutTransaction(read('src/modules/tasker-dashboard/services/tasker-tasks.service.ts')),
    ).toEqual([]);
  });
});
