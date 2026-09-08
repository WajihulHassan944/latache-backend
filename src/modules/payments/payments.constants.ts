export const PAYMENT_SOURCE = {
  Stripe: 'stripe',
  Wallet: 'wallet',
  Cash: 'cash',
} as const;

export const PAYMENT_STATUS = {
  PaymentMethodRequired: 'payment_method_required',
  Ready: 'ready',
  Processing: 'processing',
  Paid: 'paid',
  Failed: 'failed',
  RequiresAction: 'requires_action',
  OnHoldDispute: 'on_hold_dispute',
  ReviewRequiredDurationExceeded: 'review_required_duration_exceeded',
  LegacyUntracked: 'legacy_untracked',
  PartiallyRefunded: 'partially_refunded',
  Refunded: 'refunded',
  CashConfirmationRequired: 'cash_confirmation_required',
  CashConfirmed: 'cash_confirmed',
} as const;

export const PAYMENT_TRANSACTION_KIND = {
  BookingCharge: 'booking_charge',
  WalletTopup: 'wallet_topup',
  Refund: 'refund',
  CashCollection: 'cash_collection',
  Chargeback: 'chargeback',
} as const;

export const CUSTOMER_WALLET_ENTRY_KIND = {
  Topup: 'topup',
  BookingDebit: 'booking_debit',
  Refund: 'refund',
  WithdrawalHold: 'withdrawal_hold',
  WithdrawalRelease: 'withdrawal_release',
} as const;

/** No customer payout provider/destination is configured yet - Stripe only ever charges customers, it never pays them out. */
export const WALLET_WITHDRAWAL_EXECUTION_MODE = {
  Disabled: 'disabled',
  Manual: 'manual',
} as const;

export const CUSTOMER_WITHDRAWAL_STATUS = {
  PendingReview: 'pending_review',
  Processing: 'processing',
  Paid: 'paid',
  Failed: 'failed',
  Rejected: 'rejected',
  Cancelled: 'cancelled',
} as const;
