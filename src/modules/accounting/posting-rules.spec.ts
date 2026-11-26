import { ACC } from './accounting.constants';
import {
  customerWalletDraft,
  paymentDraft,
  platformLedgerDraft,
  recognitionDraft,
  taskerWalletDraft,
  type Draft,
} from './posting-rules';

const total = (draft: Draft) => Math.round(draft.lines.reduce((sum, line) => sum + line.amount, 0) * 100) / 100;
/** amount > 0 is a debit. */
const on = (draft: Draft, account: string) => draft.lines.find((line) => line.account === account)?.amount ?? 0;
const base = { id: 'x', bookingId: 7, currency: 'MAD', description: 'd', createdAt: new Date('2026-11-01T10:00:00Z') };

describe('accounting posting rules', () => {
  it('books a card wallet top-up against the right gateway', () => {
    const stripe = customerWalletDraft({ ...base, kind: 'topup', balanceDelta: 100, providerReference: null, idempotencyKey: 'stripe:wallet-topup:pi' });
    const cmi = customerWalletDraft({ ...base, kind: 'topup', balanceDelta: 100, providerReference: null, idempotencyKey: 'cmi:wallet-topup:1' });
    expect(on(stripe, ACC.CustomerWallets)).toBe(-100);
    expect(on(stripe, ACC.Stripe)).toBe(100);
    expect(on(cmi, ACC.Cmi)).toBe(100);
    expect(total(stripe)).toBe(0);
  });

  it.each([
    ['pending_earning', 0, 80, ACC.BookingFunds],
    ['earning_release', 70, -80, ACC.CommissionReceivable],
    ['withdrawal_paid', 0, -80, ACC.Bank],
    ['plan_charge', -80, 0, ACC.PlanRevenue],
    ['plan_bonus', 80, 0, ACC.PlanIncentives],
    ['referral_reward', 80, 0, ACC.ReferralRewards],
    ['platform_payable_settlement', -80, 0, ACC.SettlementClearing],
    ['something_new', 80, 0, ACC.Unmatched],
  ])('balances a Tasker %s entry', (kind, available, pending, counter) => {
    const draft = taskerWalletDraft({ ...base, kind, availableDelta: available, pendingDelta: pending, externalReference: null });
    expect(total(draft)).toBe(0);
    expect(on(draft, counter)).toBe(available + pending);
    expect(on(draft, ACC.TaskerAvailable) + 0).toBe(-available + 0);
  });

  it('treats a payout request as a transfer between the two Tasker balances', () => {
    const draft = taskerWalletDraft({ ...base, kind: 'withdrawal_hold', availableDelta: -50, pendingDelta: 50, externalReference: null });
    expect(draft.lines).toEqual([
      { account: ACC.TaskerAvailable, amount: 50 },
      { account: ACC.TaskerClearing, amount: -50 },
    ]);
  });

  it('books cash commission owed against the booking', () => {
    const draft = platformLedgerDraft({ ...base, kind: 'cash_payable_created', payableDelta: 15, externalReference: null });
    expect(on(draft, ACC.CommissionReceivable)).toBe(15);
    expect(on(draft, ACC.BookingFunds)).toBe(-15);
  });

  it('keeps a lost chargeback away from the booking funds', () => {
    const draft = paymentDraft({ ...base, kind: 'chargeback', provider: 'stripe', amount: 30, providerReference: 'dp' });
    expect(on(draft, ACC.Chargebacks)).toBe(30);
    expect(on(draft, ACC.Stripe)).toBe(-30);
    expect(draft.lines.find((line) => line.account === ACC.Chargebacks)?.bookingId).toBeNull();
  });

  const settle = { id: 7, status: 'completed', paymentStatus: 'paid', paymentCurrency: 'MAD', taxAmount: 4, donationAmount: 1, serviceSurchargeAmount: 0, last_date: new Date(), previous: 0, refunded: false };

  it('splits the money left on a completed booking into VAT, donation and fee revenue', () => {
    const draft = recognitionDraft({ ...settle, balance: 20 }, 'MAD');
    expect(total(draft)).toBe(0);
    expect(on(draft, ACC.BookingFunds)).toBe(20);
    expect(on(draft, ACC.VatPayable)).toBe(-4);
    expect(on(draft, ACC.Donations)).toBe(-1);
    expect(on(draft, ACC.ServiceFees)).toBe(-15);
  });

  it('books a kept late-cancellation fee', () => {
    const draft = recognitionDraft({ ...settle, status: 'cancelled', balance: 25 }, 'MAD');
    expect(on(draft, ACC.CancellationFees)).toBe(-25);
  });

  it('charges a later refund to the platform and flags unexplained gaps', () => {
    const later = recognitionDraft({ ...settle, balance: -5, previous: 1, refunded: true }, 'MAD');
    const gap = recognitionDraft({ ...settle, balance: -5 }, 'MAD');
    expect(on(later, ACC.RefundsBorne)).toBe(5);
    expect(on(gap, ACC.Unmatched)).toBe(5);
    expect(total(later)).toBe(0);
    expect(later.sourceKey).toBe('settle:7:1');
  });
});
