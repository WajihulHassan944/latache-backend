import { PaymentsService } from '../src/modules/payments/payments.service';

type Stub = Record<string, unknown>;

const build = (booking: Stub, existingLedger: unknown = null) => {
  const transaction = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    booking: { findUniqueOrThrow: jest.fn().mockResolvedValue(booking), update: jest.fn() },
    customerWallet: { update: jest.fn() },
    customerWalletLedgerEntry: { findUnique: jest.fn().mockResolvedValue(existingLedger), create: jest.fn() },
    paymentTransaction: { create: jest.fn() },
  };
  const service = Object.create(PaymentsService.prototype) as PaymentsService;
  const notifications = { create: jest.fn() };
  Object.assign(service, {
    notifications,
    ensureCustomerWallet: jest.fn(),
  });
  return { service, transaction, notifications };
};

const paid = (overrides: Stub = {}) => ({
  id: 12,
  customerId: 3,
  paymentSource: 'wallet',
  paymentStatus: 'ready',
  paymentCurrency: 'USD',
  capturedAt: new Date(),
  capturedAmount: '40.00',
  ...overrides,
});

describe('refund of acceptance payment on cancellation', () => {
  it('returns wallet-paid money to the customer wallet in the same transaction', async () => {
    const { service, transaction, notifications } = build(paid());
    await expect(
      service.refundAcceptanceCaptureOnCancel(12, 'Customer cancelled', transaction as never),
    ).resolves.toBe('wallet_refunded');
    expect(transaction.customerWallet.update).toHaveBeenCalledWith({
      where: { customerId: 3 },
      data: { availableBalance: { increment: '40.00' } },
    });
    expect(transaction.customerWalletLedgerEntry.create.mock.calls[0][0].data).toMatchObject({
      kind: 'refund',
      amount: '40.00',
      idempotencyKey: 'acceptance-refund:12',
    });
    expect(transaction.booking.update).toHaveBeenCalledWith({ where: { id: 12 }, data: { paymentStatus: 'refunded' } });
    expect(notifications.create.mock.calls[0][1].type).toBe('booking_payment_refunded');
  });

  it('marks a card-paid booking refund_pending for the Stripe refund step', async () => {
    const { service, transaction } = build(paid({ paymentSource: 'stripe' }));
    await expect(
      service.refundAcceptanceCaptureOnCancel(12, 'Tasker cancelled', transaction as never),
    ).resolves.toBe('card_refund_pending');
    expect(transaction.booking.update).toHaveBeenCalledWith({ where: { id: 12 }, data: { paymentStatus: 'refund_pending' } });
    expect(transaction.customerWallet.update).not.toHaveBeenCalled();
  });

  it.each([
    ['nothing was captured', { capturedAt: null, capturedAmount: null }],
    ['it was already refunded', { paymentStatus: 'refunded' }],
    ['a refund is already pending', { paymentStatus: 'refund_pending' }],
  ])('does nothing when %s', async (_label, overrides) => {
    const { service, transaction } = build(paid(overrides));
    await expect(
      service.refundAcceptanceCaptureOnCancel(12, 'x', transaction as never),
    ).resolves.toBe('none');
    expect(transaction.booking.update).not.toHaveBeenCalled();
  });

  it('never refunds the same wallet booking twice', async () => {
    const { service, transaction } = build(paid(), { id: 'ledger' });
    await expect(
      service.refundAcceptanceCaptureOnCancel(12, 'x', transaction as never),
    ).resolves.toBe('none');
    expect(transaction.customerWallet.update).not.toHaveBeenCalled();
  });
});
