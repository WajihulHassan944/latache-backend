export const TASKER_BOOKING_STATUS = {
  Pending: 'pending',
  Confirmed: 'confirmed',
  EnRoute: 'en_route',
  Arrived: 'arrived',
  InProgress: 'in_progress',
  AwaitingCustomerApproval: 'awaiting_customer_approval',
  Completed: 'completed',
  Cancelled: 'cancelled',
} as const;

export type TaskerBookingStatus =
  (typeof TASKER_BOOKING_STATUS)[keyof typeof TASKER_BOOKING_STATUS];

export const TASKER_BOOKED_STATUSES = [
  TASKER_BOOKING_STATUS.Pending,
  TASKER_BOOKING_STATUS.Confirmed,
] as const;

export const TASKER_ONGOING_STATUSES = [
  TASKER_BOOKING_STATUS.EnRoute,
  TASKER_BOOKING_STATUS.Arrived,
  TASKER_BOOKING_STATUS.InProgress,
  TASKER_BOOKING_STATUS.AwaitingCustomerApproval,
] as const;

export const TASKER_HISTORY_STATUSES = [
  TASKER_BOOKING_STATUS.Completed,
  TASKER_BOOKING_STATUS.Cancelled,
] as const;

export const TERMINAL_TASK_STATUSES = new Set<string>(TASKER_HISTORY_STATUSES);

export const TASK_TIMER_STATUS = {
  Running: 'running',
  Paused: 'paused',
  Stopped: 'stopped',
} as const;

export const NOTIFICATION_CATEGORY = {
  Messages: 'messages',
  Tasks: 'tasks',
  Wallet: 'wallet',
  System: 'system',
} as const;

export const PAYOUT_METHOD_TYPE = {
  BankTransfer: 'bank_transfer',
  OrangeMoney: 'orange_money',
  Paypal: 'paypal',
  GooglePay: 'google_pay',
} as const;

export type PayoutMethodType = (typeof PAYOUT_METHOD_TYPE)[keyof typeof PAYOUT_METHOD_TYPE];

export const PAYOUT_EXECUTION_MODE = {
  Disabled: 'disabled',
  Manual: 'manual',
} as const;

export const WALLET_ENTRY_KIND = {
  Earning: 'earning',
  Refund: 'refund',
  WithdrawalHold: 'withdrawal_hold',
  WithdrawalRelease: 'withdrawal_release',
  WithdrawalPaid: 'withdrawal_paid',
  Adjustment: 'adjustment',
} as const;

export const WITHDRAWAL_STATUS = {
  PendingReview: 'pending_review',
  Processing: 'processing',
  Paid: 'paid',
  Failed: 'failed',
  Rejected: 'rejected',
  Cancelled: 'cancelled',
} as const;
