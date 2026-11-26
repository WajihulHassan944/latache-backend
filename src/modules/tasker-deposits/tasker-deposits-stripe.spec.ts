import { TaskerDepositsService } from './tasker-deposits.service';

const pending = { id: 'dep1', taskerId: 7, amount: '100.00', currency: 'MAD', status: 'pending', providerReference: 'cs_test_1' };
const paidSession = {
  id: 'cs_test_1',
  payment_status: 'paid',
  metadata: { purpose: 'tasker_deposit', depositId: 'dep1', taskerId: '7' },
  amount_total: 10000,
  currency: 'mad',
  payment_intent: 'pi_1',
};

function build(session: unknown, stripeEnabled = true) {
  const retrieve = session instanceof Error ? jest.fn().mockRejectedValue(session) : jest.fn().mockResolvedValue(session);
  const transaction = { taskerDeposit: { updateMany: jest.fn() } };
  const prisma = {
    $transaction: jest.fn((run: (tx: unknown) => unknown) => run(transaction)),
    taskerDeposit: { findUnique: jest.fn().mockResolvedValue(pending) },
  };
  const stripe = { isEnabled: () => stripeEnabled, client: () => ({ checkout: { sessions: { retrieve } } }) };
  const service = new TaskerDepositsService(prisma as never, {} as never, {} as never, {} as never, {} as never, stripe as never, {} as never);
  const markPaid = jest.spyOn(service, 'markPaid').mockResolvedValue({ ...pending, status: 'paid' } as never);
  const reconcile = (row: unknown) => (service as unknown as { reconcileStripe(r: unknown): Promise<{ status: string }> }).reconcileStripe(row);
  return { reconcile, markPaid, retrieve };
}

describe('signup deposit paid through Stripe Checkout', () => {
  it('marks the deposit paid with exactly what Stripe collected', async () => {
    const { reconcile, markPaid } = build(paidSession);
    await expect(reconcile(pending)).resolves.toMatchObject({ status: 'paid' });
    expect(markPaid).toHaveBeenCalledWith(7, { amount: 100, currency: 'MAD', method: 'stripe', reference: 'pi_1' }, expect.anything());
  });

  it.each([
    ['not paid yet', { ...paidSession, payment_status: 'unpaid' }],
    ['a session for another deposit', { ...paidSession, metadata: { purpose: 'tasker_deposit', depositId: 'other' } }],
    ['a session for something else', { ...paidSession, metadata: { purpose: 'wallet_topup', depositId: 'dep1' } }],
  ])('stays pending when the session is %s', async (_label, session) => {
    const { reconcile, markPaid } = build(session);
    await expect(reconcile(pending)).resolves.toMatchObject({ status: 'pending' });
    expect(markPaid).not.toHaveBeenCalled();
  });

  it('keeps working when Stripe is unreachable', async () => {
    const { reconcile, markPaid } = build(new Error('network down'));
    await expect(reconcile(pending)).resolves.toMatchObject({ status: 'pending' });
    expect(markPaid).not.toHaveBeenCalled();
  });

  it('does not call Stripe for settled deposits or non-Checkout references', async () => {
    const { reconcile, retrieve } = build(paidSession);
    await reconcile({ ...pending, status: 'paid' });
    await reconcile({ ...pending, providerReference: 'cmi-order-9' });
    expect(retrieve).not.toHaveBeenCalled();
  });
});
