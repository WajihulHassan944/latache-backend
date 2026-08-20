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
} as const;
