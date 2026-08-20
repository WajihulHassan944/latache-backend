export const REFERRAL_PROGRAM = {
  Customer: 'customer',
  Tasker: 'tasker',
} as const;

export const REFERRAL_STATUS = {
  Claimed: 'claimed',
  Qualified: 'qualified',
  Rewarded: 'rewarded',
  Expired: 'expired',
  Revoked: 'revoked',
} as const;

export const REFERRAL_REWARD_STATUS = {
  Pending: 'pending',
  Settled: 'settled',
  Reversed: 'reversed',
  Cancelled: 'cancelled',
} as const;

export const REFERRAL_REWARD_KIND = {
  CustomerReferrerCredit: 'customer_referrer_credit',
  ReferredCustomerDiscount: 'referred_customer_discount',
  TaskerReferrerCredit: 'tasker_referrer_credit',
  ReferredTaskerCredit: 'referred_tasker_credit',
} as const;

export const REFERRAL_WALLET_ENTRY_KIND = {
  Reward: 'referral_reward',
  Reversal: 'referral_reward_reversal',
} as const;

export const REFERRAL_ONLINE_PAYMENT_SOURCES = ['stripe', 'wallet'] as const;

export type ReferralProgram = (typeof REFERRAL_PROGRAM)[keyof typeof REFERRAL_PROGRAM];
