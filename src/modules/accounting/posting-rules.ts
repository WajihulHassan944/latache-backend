import { bookingRef } from '../../common/utils/booking-ref.util';
import { ACC } from './accounting.constants';

/** amount > 0 is a debit, amount < 0 is a credit. Lines of a draft always sum to zero. */
export interface DraftLine {
  account: string;
  amount: number;
  bookingId?: number | null;
}

export interface Draft {
  sourceType: string;
  sourceKey: string;
  date: Date;
  memo: string;
  currency: string;
  bookingId?: number | null;
  reference?: string | null;
  lines: DraftLine[];
}

type Num = number | string | { toString(): string } | null | undefined;
const n = (value: Num): number => Math.round((Number(value ?? 0) + Number.EPSILON) * 100) / 100;
const ref = (bookingId: number | null) => (bookingId ? ` - booking ${bookingRef(bookingId)}` : '');

export function customerWalletDraft(row: {
  id: string;
  bookingId: number | null;
  kind: string;
  balanceDelta: Num;
  currency: string;
  description: string;
  providerReference: string | null;
  idempotencyKey: string;
  createdAt: Date;
}): Draft {
  const delta = n(row.balanceDelta);
  let counter: string = ACC.Unmatched;
  if (row.kind === 'topup') counter = row.idempotencyKey.startsWith('cmi:') ? ACC.Cmi : ACC.Stripe;
  else if (row.kind === 'booking_debit' || row.kind === 'refund') counter = ACC.BookingFunds;
  else if (row.kind.startsWith('withdrawal_')) counter = ACC.CustomerWithdrawals;
  else if (row.kind.startsWith('referral_')) counter = ACC.ReferralRewards;
  return {
    sourceType: 'customer_wallet',
    sourceKey: `cwl:${row.id}`,
    date: row.createdAt,
    memo: `Customer wallet: ${row.description}`,
    currency: row.currency,
    bookingId: row.bookingId,
    reference: row.providerReference,
    // A wallet increase is a credit to the liability.
    lines: [
      { account: ACC.CustomerWallets, amount: -delta },
      { account: counter, amount: delta },
    ],
  };
}

export function taskerWalletDraft(row: {
  id: string;
  bookingId: number | null;
  kind: string;
  availableDelta: Num;
  pendingDelta: Num;
  currency: string;
  description: string;
  externalReference: string | null;
  createdAt: Date;
}): Draft {
  const available = n(row.availableDelta);
  const pending = n(row.pendingDelta);
  const net = n(available + pending);
  const byKind: Record<string, string> = {
    pending_earning: ACC.BookingFunds,
    earning: ACC.BookingFunds,
    pending_reversal: ACC.BookingFunds,
    refund: ACC.BookingFunds,
    // The only net change on release is cash commission taken from the earning.
    earning_release: ACC.CommissionReceivable,
    withdrawal_paid: ACC.Bank,
    plan_charge: ACC.PlanRevenue,
    plan_refund: ACC.PlanRevenue,
    plan_bonus: ACC.PlanIncentives,
    plan_revenue_share: ACC.PlanIncentives,
    platform_payable_settlement: ACC.SettlementClearing,
    platform_payable_overpayment: ACC.SettlementClearing,
  };
  let counter =
    byKind[row.kind] ??
    (row.kind.startsWith('referral_')
      ? ACC.ReferralRewards
      : row.kind === 'adjustment' && row.bookingId
        ? ACC.BookingFunds
        : ACC.Unmatched);
  if (net === 0) counter = ACC.Unmatched; // pure transfer between the two balances
  const lines: DraftLine[] = [
    { account: ACC.TaskerAvailable, amount: -available },
    { account: ACC.TaskerClearing, amount: -pending },
    { account: counter, amount: net },
  ];
  return {
    sourceType: 'tasker_wallet',
    sourceKey: `twl:${row.id}`,
    date: row.createdAt,
    memo: `Tasker wallet: ${row.description}`,
    currency: row.currency,
    bookingId: row.bookingId,
    reference: row.externalReference,
    lines: lines.filter((line) => line.amount !== 0),
  };
}

export function platformLedgerDraft(row: {
  id: string;
  bookingId: number | null;
  kind: string;
  payableDelta: Num;
  currency: string;
  description: string;
  externalReference: string | null;
  createdAt: Date;
}): Draft {
  const delta = n(row.payableDelta);
  const counter =
    row.kind === 'cash_payable_created' || row.kind === 'receivable_reversal'
      ? ACC.BookingFunds
      : row.kind === 'settlement_payment'
        ? ACC.SettlementClearing
        : ACC.Unmatched;
  return {
    sourceType: 'cash_commission',
    sourceKey: `tpl:${row.id}`,
    date: row.createdAt,
    memo: `Cash commission: ${row.description}`,
    currency: row.currency,
    bookingId: row.bookingId,
    reference: row.externalReference,
    lines: [
      { account: ACC.CommissionReceivable, amount: delta },
      { account: counter, amount: -delta },
    ],
  };
}

export function paymentDraft(row: {
  id: string;
  bookingId: number | null;
  kind: string;
  provider: string;
  amount: Num;
  currency: string;
  providerReference: string | null;
  createdAt: Date;
}): Draft {
  const amount = n(row.amount);
  const gateway = row.provider === 'cmi' ? ACC.Cmi : ACC.Stripe;
  const isCharge = row.kind === 'booking_charge';
  const isChargeback = row.kind === 'chargeback';
  const counter = isChargeback ? ACC.Chargebacks : ACC.BookingFunds;
  const label = isCharge ? 'Card payment received' : isChargeback ? 'Chargeback lost' : 'Card refund sent';
  return {
    sourceType: `payment_${row.kind}`,
    sourceKey: `pay:${row.id}`,
    date: row.createdAt,
    memo: `${label}${ref(row.bookingId)}`,
    currency: row.currency,
    bookingId: row.bookingId,
    reference: row.providerReference,
    lines: [
      { account: gateway, amount: isCharge ? amount : -amount },
      // A chargeback is the platform's loss and does not touch the booking's held funds.
      { account: counter, amount: isCharge ? -amount : amount, ...(isChargeback ? { bookingId: null } : {}) },
    ],
  };
}

export function recognitionDraft(
  row: {
    id: number;
    status: string;
    taxAmount: Num;
    donationAmount: Num;
    serviceSurchargeAmount: Num;
    paymentCurrency: string;
    balance: Num;
    last_date: Date;
    previous: number;
    refunded: boolean;
  },
  baseCurrency: string,
): Draft {
  // The held balance is already in the books' currency.
  let remaining = n(row.balance);
  const lines: DraftLine[] = [{ account: ACC.BookingFunds, amount: remaining }];
  const take = (account: string, wanted: number) => {
    const amount = n(Math.min(Math.max(0, wanted), remaining));
    if (amount > 0) {
      lines.push({ account, amount: -amount });
      remaining = n(remaining - amount);
    }
  };
  if (row.previous === 0 && remaining > 0) {
    if (row.status === 'completed') {
      take(ACC.VatPayable, n(row.taxAmount));
      take(ACC.Donations, n(row.donationAmount));
      take(ACC.Surcharges, n(row.serviceSurchargeAmount));
      take(ACC.ServiceFees, remaining);
    } else {
      take(ACC.CancellationFees, remaining);
    }
  }
  if (remaining !== 0) {
    // Later changes, or money paid out beyond what was received.
    const account = row.previous > 0 || row.refunded ? ACC.RefundsBorne : ACC.Unmatched;
    lines.push({ account, amount: -remaining });
  }
  return {
    sourceType: 'booking_settlement',
    sourceKey: `settle:${row.id}:${row.previous}`,
    date: row.last_date,
    memo: `${row.previous > 0 ? 'Settlement adjustment' : row.status === 'completed' ? 'Revenue recognised' : 'Cancellation settled'}${ref(row.id)}`,
    currency: baseCurrency,
    bookingId: row.id,
    lines,
  };
}
