export const PLATFORM_SETTING_KEYS = [
  'general',
  'currency',
  'tax',
  'bookingRules',
  'serviceRadius',
  'commission',
  'referral',
] as const;

export type PlatformSettingKey = (typeof PLATFORM_SETTING_KEYS)[number];

export interface PricingChargeResult {
  platformFeeAmount: number;
  taxAmount: number;
  serviceSurchargeAmount: number;
  commissionRatePercent: number;
  taxRatePercent: number;
  taxInclusive: boolean;
}
