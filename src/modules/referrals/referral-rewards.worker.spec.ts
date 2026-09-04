import { ReferralRewardsWorker } from './referral-rewards.worker';
import type { ReferralsService } from './services/referrals.service';

const flushMicrotasks = async (): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

describe('ReferralRewardsWorker.onModuleInit crash safety', () => {
  it('never lets a failing tick become an unhandled promise rejection', async () => {
    const config = { get: (_key: string, fallback: unknown) => fallback } as never;
    const referrals = {
      expireStaleReferrals: jest.fn().mockRejectedValue(new Error('db unavailable')),
      releaseMatureRewards: jest.fn(),
    } as unknown as ReferralsService;
    const worker = new ReferralRewardsWorker(config, referrals);

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
    expect(referrals.expireStaleReferrals).toHaveBeenCalled();
  });

  it('still lets a direct runOnce() call reject, so BullMQ can retry the job', async () => {
    const config = { get: (_key: string, fallback: unknown) => fallback } as never;
    const referrals = {
      expireStaleReferrals: jest.fn().mockRejectedValue(new Error('db unavailable')),
      releaseMatureRewards: jest.fn(),
    } as unknown as ReferralsService;
    const worker = new ReferralRewardsWorker(config, referrals);

    await expect(worker.runOnce()).rejects.toThrow('db unavailable');
  });
});
