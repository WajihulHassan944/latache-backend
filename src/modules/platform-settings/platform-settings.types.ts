export const PLATFORM_SETTING_KEYS = [
  'general',
  'currency',
  'tax',
  'bookingRules',
  'serviceRadius',
  'commission',
  'taskerFinance',
  'referral',
  'disputes',
] as const;

export type PlatformSettingKey = (typeof PLATFORM_SETTING_KEYS)[number];

export const PLATFORM_MARKETS = ['us', 'morocco', 'pakistan', 'france', 'spain'] as const;
export type PlatformMarket = (typeof PLATFORM_MARKETS)[number];

export interface PlatformCurrencyContext {
  market: PlatformMarket;
  country: string;
  code: 'USD' | 'MAD' | 'PKR' | 'EUR';
  name: string;
  symbol: string;
  rateFromUsd: number;
  staticRateVersion: string;
}

export interface PricingChargeResult {
  rawServiceAmount: number;
  serviceAmount: number;
  minimumTaskPrice: number;
  minimumTaskPriceApplied: boolean;
  taskerTierCode: string;
  eliteCommissionPerkApplied: boolean;
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

export interface ReferralPolicy {
  version: number;
  currency: string;
  clientReferralEnabled: boolean;
  taskerReferralEnabled: boolean;
  uniqueCodesEnabled: boolean;
  leaderboardEnabled: boolean;
  bonusStackingEnabled: boolean;
  clientReferralBonus: number;
  referredClientDiscountPercent: number;
  referredClientDiscountMaxAmount: number;
  taskerReferralBonus: number;
  referredTaskerBonus: number;
  referralExpiryDays: number;
  rewardClearanceDays: number;
  minimumQualifyingBookingAmount: number;
  minimumCustomerChargeAmount: number;
  maxClientReferrals: number;
  maxTaskerReferrals: number;
}

export interface DisputePolicy {
  filingWindowHours: number;
  appealWindowHours: number;
  caseSlaHours: number;
  settlementResponseHours: number;
  evidenceResponseHours: number;
  evidenceReminderHoursBeforeDue: number;
  evidenceOverdueEscalationHours: number;
  maxEvidenceItems: number;
  maxEvidenceBytes: number;
  autoAssignmentEnabled: boolean;
  emailNotificationsEnabled: boolean;
  mobilePushEnabled: boolean;
  automaticModerationEnabled: boolean;
  strikePointsPerWarning: number;
  suspendAtStrikePoints: number;
}
