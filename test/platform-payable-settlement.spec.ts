import { TaskerFinanceService } from '../src/modules/tasker-finance/tasker-finance.service';
import { PlatformPayableSettlementsService } from '../src/modules/tasker-finance/platform-payable-settlements.service';

type Row = Record<string, unknown>;

const receivable = (id: string, outstanding: number, confirmedAt: string): Row => ({
  id,
  bookingId: Number(id.replace(/\D/g, '')) || 1,
  outstandingAmount: outstanding.toFixed(2),
  settledAmount: '0.00',
  confirmedAt: new Date(confirmedAt),
});

const buildFinance = (outstanding: number, receivables: Row[], policy = { maximumOutstandingPlatformDebt: 50, blockCashBookingsAtDebtLimit: true }) => {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    taskerWallet: { upsert: jest.fn(), update: jest.fn() },
    taskerWalletLedgerEntry: { create: jest.fn() },
    taskerPlatformAccount: {
      upsert: jest.fn(),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ taskerId: 31, currency: 'USD', outstandingPayable: outstanding.toFixed(2), cashBookingsRestricted: outstanding >= 50 }),
      update: jest.fn(),
    },
    taskerPlatformReceivable: { findMany: jest.fn().mockResolvedValue(receivables), update: jest.fn() },
    taskerPlatformLedgerEntry: { create: jest.fn() },
  };
  const service = Object.create(TaskerFinanceService.prototype) as TaskerFinanceService;
  const notifications = { create: jest.fn() };
  Object.assign(service, { settings: { taskerFinancePolicy: jest.fn().mockResolvedValue(policy) }, notifications });
  return { service, tx, notifications };
};

describe('applyPayableSettlement', () => {
  it('settles oldest receivables first and records one ledger entry per receivable', async () => {
    const { service, tx } = buildFinance(30, [receivable('r1', 10, '2026-09-01'), receivable('r2', 20, '2026-09-02')]);
    const result = await service.applyPayableSettlement(tx as never, { taskerId: 31, settlementId: 's1', amount: 15, currency: 'USD', reference: 'ref' });
    expect(result).toEqual({ applied: 15, overpayment: 0, outstandingAfter: 15 });
    const updates = tx.taskerPlatformReceivable.update.mock.calls.map((c) => [c[0].where.id, c[0].data.outstandingAmount, c[0].data.status]);
    expect(updates).toEqual([['r1', '0.00', 'settled'], ['r2', '15.00', 'partially_settled']]);
    const ledger = tx.taskerPlatformLedgerEntry.create.mock.calls.map((c) => c[0].data);
    expect(ledger.map((l) => [l.kind, l.amount, l.payableDelta, l.idempotencyKey])).toEqual([
      ['settlement_payment', '10.00', '-10.00', 'settlement:s1:receivable:r1'],
      ['settlement_payment', '5.00', '-5.00', 'settlement:s1:receivable:r2'],
    ]);
    expect(tx.taskerPlatformAccount.update).toHaveBeenCalledWith({ where: { taskerId: 31 }, data: { outstandingPayable: { decrement: '15.00' } } });
  });

  it('credits anything above the outstanding balance to the Tasker wallet', async () => {
    const { service, tx } = buildFinance(10, [receivable('r1', 10, '2026-09-01')]);
    const result = await service.applyPayableSettlement(tx as never, { taskerId: 31, settlementId: 's2', amount: 25, currency: 'USD', reference: 'ref' });
    expect(result).toEqual({ applied: 10, overpayment: 15, outstandingAfter: 0 });
    expect(tx.taskerWallet.update).toHaveBeenCalledWith({ where: { taskerId: 31 }, data: { availableBalance: { increment: '15.00' } } });
    expect(tx.taskerWalletLedgerEntry.create.mock.calls[0][0].data).toMatchObject({ kind: 'platform_payable_overpayment', idempotencyKey: 'settlement:s2:overpayment' });
  });

  it('lifts the cash restriction once the balance drops below the limit', async () => {
    const { service, tx, notifications } = buildFinance(60, [receivable('r1', 60, '2026-09-01')]);
    await service.applyPayableSettlement(tx as never, { taskerId: 31, settlementId: 's3', amount: 60, currency: 'USD', reference: 'ref' });
    expect(tx.taskerPlatformAccount.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ cashBookingsRestricted: false }) }));
    expect(notifications.create.mock.calls.some((c) => c[1].type === 'cash_bookings_unrestricted')).toBe(true);
  });

  it('refuses a currency mismatch and non-positive amounts', async () => {
    const { service, tx } = buildFinance(10, []);
    await expect(service.applyPayableSettlement(tx as never, { taskerId: 31, settlementId: 's4', amount: 5, currency: 'MAD', reference: 'r' })).rejects.toThrow(/currency/);
    await expect(service.applyPayableSettlement(tx as never, { taskerId: 31, settlementId: 's5', amount: 0, currency: 'USD', reference: 'r' })).rejects.toThrow(/positive/);
  });
});

describe('PlatformPayableSettlementsService.create guards', () => {
  const build = (account: Row | null, open: Row | null = null, replay: Row | null = null) => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      taskerPlatformAccount: { findUnique: jest.fn().mockResolvedValue(account) },
      taskerPlatformSettlement: { findFirst: jest.fn().mockResolvedValue(open), create: jest.fn(), findUniqueOrThrow: jest.fn() },
    };
    const prisma = {
      taskerPlatformSettlement: { findUnique: jest.fn().mockResolvedValue(replay) },
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    };
    const service = new PlatformPayableSettlementsService(prisma as never, {} as never, {} as never, { record: jest.fn() } as never, {} as never);
    return { service, tx };
  };
  const account = { currency: 'USD', outstandingPayable: '20.00' };

  it('requires an Idempotency-Key', async () => {
    await expect(build(account).service.create(31, { method: 'wallet' }, '')).rejects.toThrow(/Idempotency-Key/);
  });
  it('refuses when nothing is owed', async () => {
    await expect(build({ currency: 'USD', outstandingPayable: '0.00' }).service.create(31, { method: 'wallet' }, 'k')).rejects.toMatchObject({ response: { code: 'NOTHING_TO_SETTLE' } });
  });
  it('refuses an amount above the outstanding payable', async () => {
    await expect(build(account).service.create(31, { method: 'wallet', amount: 25 }, 'k')).rejects.toMatchObject({ response: { code: 'AMOUNT_EXCEEDS_OUTSTANDING' } });
  });
  it('allows only one open settlement at a time', async () => {
    await expect(build(account, { id: 'open1', status: 'pending_review' }).service.create(31, { method: 'wallet' }, 'k')).rejects.toMatchObject({ response: { code: 'SETTLEMENT_ALREADY_PENDING' } });
  });
  it('requires a reference for a bank transfer', async () => {
    await expect(build(account).service.create(31, { method: 'bank_transfer' }, 'k')).rejects.toThrow(/reference/);
  });
  it('replaying a key with different parameters is refused', async () => {
    const replay = { id: 's', method: 'wallet', status: 'pending_review', amount: '20.00' };
    await expect(build(account, null, replay).service.create(31, { method: 'bank_transfer', reference: 'x' }, 'k')).rejects.toThrow(/different parameters/);
  });
});
