export const TASKER_EARNING_STATUS = {
  Pending: 'pending',
  Available: 'available',
  PartiallyReversed: 'partially_reversed',
  Reversed: 'reversed',
} as const;

export const PLATFORM_RECEIVABLE_STATUS = {
  Outstanding: 'outstanding',
  PartiallySettled: 'partially_settled',
  Settled: 'settled',
  PartiallyReversed: 'partially_reversed',
  Reversed: 'reversed',
} as const;

export const PLATFORM_LEDGER_KIND = {
  CashPayableCreated: 'cash_payable_created',
  EarningDebtOffset: 'earning_debt_offset',
  ReceivableReversal: 'receivable_reversal',
} as const;

export const EARNING_LEDGER_KIND = {
  PendingEarning: 'pending_earning',
  EarningRelease: 'earning_release',
  PendingReversal: 'pending_reversal',
} as const;
