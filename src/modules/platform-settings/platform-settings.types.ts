export const PLATFORM_SETTING_KEYS = [
  'general',
  'currency',
  'tax',
  'bookingRules',
  'serviceRadius',
  'commission',
  'taskerFinance',
  'referral',
] as const;

export type PlatformSettingKey = (typeof PLATFORM_SETTING_KEYS)[number];

export interface PricingChargeResult {
  rawServiceAmount: number;
  serviceAmount: number;
  minimumTaskPrice: number;
  minimumTaskPriceApplied: boolean;
  taskerTierCode: string;
  platformFeeAmount: number;
  taxAmount: number;
  serviceSurchargeAmount: number;
  commissionRatePercent: number;
  taxRatePercent: number;
  taxInclusive: boolean;
}

export interface TaskerFinancePolicy {
  earningClearanceDays: number;
  cashDisputeClearanceDays: number;
  maximumOutstandingPlatformDebt: number;
  blockCashBookingsAtDebtLimit: boolean;
}
