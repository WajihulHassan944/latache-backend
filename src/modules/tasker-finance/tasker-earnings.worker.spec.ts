import { TaskerEarningsWorker } from './tasker-earnings.worker';

const flushMicrotasks = async (): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

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

  describe('onModuleInit crash safety', () => {
    it('never lets a failing tick become an unhandled promise rejection', async () => {
      const prisma = { taskerEarning: { findMany: jest.fn() } };
      const config = { get: (_key: string, fallback: unknown) => fallback };
      const finance = {
        markMatureCashReceivablesCleared: jest.fn().mockRejectedValue(new Error('db unavailable')),
        reconcileCashRestrictions: jest.fn(),
        releaseMatureEarning: jest.fn(),
      };
      const worker = new TaskerEarningsWorker(prisma as never, config as never, finance as never);

      const unhandled = jest.fn();
      process.on('unhandledRejection', unhandled);
      try {
        worker.onModuleInit();
        await flushMicrotasks();
      } finally {
        worker.onModuleDestroy();
        process.off('unhandledRejection', unhandled);
      }

      expect(unhandled).not.toHaveBeenCalled();
      expect(finance.markMatureCashReceivablesCleared).toHaveBeenCalled();
    });

    it('still lets a direct runOnce() call reject, so BullMQ can retry the job', async () => {
      const prisma = { taskerEarning: { findMany: jest.fn() } };
      const config = { get: (_key: string, fallback: unknown) => fallback };
      const finance = {
        markMatureCashReceivablesCleared: jest.fn().mockRejectedValue(new Error('db unavailable')),
        reconcileCashRestrictions: jest.fn(),
        releaseMatureEarning: jest.fn(),
      };
      const worker = new TaskerEarningsWorker(prisma as never, config as never, finance as never);

      await expect(worker.runOnce()).rejects.toThrow('db unavailable');
    });
  });
});
