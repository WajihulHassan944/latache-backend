import { TaskerEarningsWorker } from './tasker-earnings.worker';

describe('TaskerEarningsWorker', () => {
  it('can process duplicate scheduler executions without double release', async () => {
    const prisma = {
      taskerEarning: {
        findMany: jest.fn().mockResolvedValue([{ id: 'earning-1' }]),
      },
    };
    const config = {
      get: (_key: string, fallback: unknown) => fallback,
    };
    const finance = {
      markMatureCashReceivablesCleared: jest.fn().mockResolvedValue(0),
      reconcileCashRestrictions: jest.fn().mockResolvedValue(0),
      // The transactional financial service returns false once the persisted
      // release state/unique ledger shows that another execution won.
      releaseMatureEarning: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    };
    const worker = new TaskerEarningsWorker(prisma as never, config as never, finance as never);

    await expect(worker.runOnce()).resolves.toBe(1);
    await expect(worker.runOnce()).resolves.toBe(0);
    expect(finance.releaseMatureEarning).toHaveBeenCalledTimes(2);
  });
});
