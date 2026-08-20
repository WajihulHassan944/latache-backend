import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
  ValidateNested,
  Matches,
  ArrayMaxSize,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

class CurrencyItemDto {
  @IsString()
  @Length(3, 3)
  code!: string;

  @IsString()
  @Length(1, 80)
  name!: string;

  @IsString()
  @Length(1, 8)
  symbol!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(0.00000001)
  exchangeRate!: number;

  @IsBoolean()
  isActive!: boolean;
}

class TaxJurisdictionDto {
  @IsString()
  @Length(2, 64)
  code!: string;

  @IsString()
  @Length(2, 120)
  name!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  ratePercent!: number;

  @IsBoolean()
  isActive!: boolean;
}

class CommissionOverrideDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  serviceId!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(-100)
  @Max(100)
  deltaPercent!: number;
}

class ServiceRegionDto {
  @IsString()
  @Length(2, 64)
  code!: string;

  @IsString()
  @Length(2, 120)
  name!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.1)
  @Max(500)
  radiusKm!: number;

  @IsBoolean()
  isActive!: boolean;
}

export class GeneralContentTranslationDto {
  @IsString()
  @Matches(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/)
  locale!: string;

  @IsOptional() @IsString() @Length(2, 120) platformName?: string;
  @IsOptional() @IsString() @Length(0, 1000) description?: string;
}

export class GeneralSettingsDto {
  @IsOptional() @IsString() @Length(2, 120) platformName?: string;
  @IsOptional() @IsEmail() supportEmail?: string;
  @IsOptional() @IsUrl({ require_tld: false }) platformUrl?: string;
  @IsOptional() @IsString() @Length(0, 1000) description?: string;
  @IsOptional() @IsBoolean() emailNotificationsEnabled?: boolean;
  @IsOptional() @IsBoolean() smsNotificationsEnabled?: boolean;
  @IsOptional() @IsBoolean() pushNotificationsEnabled?: boolean;
  @IsOptional() @IsBoolean() liveChatEnabled?: boolean;
  @IsOptional() @IsBoolean() maintenanceMode?: boolean;
  @ApiPropertyOptional({
    type: () => GeneralContentTranslationDto,
    isArray: true,
    description:
      'Localized public platform identity/content. Locale codes are checked against SUPPORTED_LOCALES.',
    example: [{ locale: 'ar', platformName: 'Latache', description: 'منصة موثوقة للخدمات.' }],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => GeneralContentTranslationDto)
  translations?: GeneralContentTranslationDto[];
}

export class CurrencySettingsDto {
  @ApiPropertyOptional({ enum: ['us', 'morocco', 'pakistan', 'france', 'spain'], default: 'us' })
  @IsOptional()
  @IsIn(['us', 'morocco', 'pakistan', 'france', 'spain'])
  primaryMarket?: 'us' | 'morocco' | 'pakistan' | 'france' | 'spain';

  @ApiPropertyOptional({ enum: ['USD', 'MAD', 'PKR', 'EUR'], description: 'Derived from primaryMarket; retained for backward compatibility.' })
  @IsOptional() @IsIn(['USD', 'MAD', 'PKR', 'EUR', 'usd', 'mad', 'pkr', 'eur']) primaryCurrency?: string;
  @IsOptional() @IsString() @Length(1, 40) displayFormat?: string;
  @IsOptional() @IsIn(['manual', 'open_exchange_rates']) exchangeRateSource?:
    | 'manual'
    | 'open_exchange_rates';
  @IsOptional() @IsBoolean() multiCurrencyEnabled?: boolean;
  @IsOptional() @IsBoolean() autoRateRefresh?: boolean;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => CurrencyItemDto)
  activeCurrencies?: CurrencyItemDto[];
}

export class TaxSettingsDto {
  @IsOptional() @IsIn(['disabled', 'global']) mode?: 'disabled' | 'global';
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  defaultRatePercent?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  serviceSurchargeAmount?: number;
  @IsOptional() @IsBoolean() inclusivePricing?: boolean;
  @IsOptional() @IsBoolean() receiptsEnabled?: boolean;
  @IsOptional() @IsBoolean() autoReporting?: boolean;
  @IsOptional() @IsBoolean() vatSupport?: boolean;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaxJurisdictionDto)
  jurisdictionOverrides?: TaxJurisdictionDto[];
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  exemptServiceIds?: number[];
}

export class BookingRulesSettingsDto {
  @IsOptional() @IsBoolean() enforcementEnabled?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10080) minAdvanceNoticeMinutes?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(730) maxAdvanceDays?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1440) minDurationMinutes?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(2880) maxDurationMinutes?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(720) cancellationWindowHours?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  lateCancellationFeePercent?: number;
  @IsOptional() @IsBoolean() instantBookingEnabled?: boolean;
  @IsOptional() @IsBoolean() requireTaskerConfirmation?: boolean;
  @IsOptional() @IsBoolean() repeatBookingEnabled?: boolean;
  @IsOptional() @IsBoolean() waitlistEnabled?: boolean;
  @IsOptional() @IsBoolean() emergencyBookingEnabled?: boolean;
  @IsOptional() @IsBoolean() groupBookingEnabled?: boolean;
  @ApiPropertyOptional({
    example: 24,
    default: 24,
    description:
      'Hours after Tasker completion submission before an undisputed booking is automatically approved and finalized.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  completionApprovalHours?: number;
}

export class ServiceRadiusSettingsDto {
  @IsOptional() @IsBoolean() enforcementEnabled?: boolean;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.1)
  @Max(500)
  defaultRadiusKm?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.1)
  @Max(500)
  minimumRadiusKm?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.1)
  @Max(500)
  maximumRadiusKm?: number;
  @IsOptional() @IsBoolean() dynamicRadiusAdjustment?: boolean;
  @IsOptional() @IsBoolean() distanceBasedPricing?: boolean;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServiceRegionDto)
  regions?: ServiceRegionDto[];
}

export class CommissionSettingsDto {
  @IsOptional() @IsIn(['customer_platform_fee']) chargeModel?: 'customer_platform_fee';
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  standardRatePercent?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  goldRatePercent?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  platinumRatePercent?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  diamondRatePercent?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  standardMinTaskPrice?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  goldMinTaskPrice?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  platinumMinTaskPrice?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  diamondMinTaskPrice?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  sameDaySurchargePercent?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  weekendSurchargePercent?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  minimumCommissionAmount?: number;
  @IsOptional() @IsBoolean() categoryOverridesEnabled?: boolean;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CommissionOverrideDto)
  categoryOverrides?: CommissionOverrideDto[];
}

export class TaskerFinanceSettingsDto {
  @ApiPropertyOptional({ example: 14, default: 14 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  earningClearanceDays?: number;

  @ApiPropertyOptional({ example: 14, default: 14 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  cashDisputeClearanceDays?: number;

  @ApiPropertyOptional({
    example: 250,
    description: 'Zero disables the debt ceiling until Finance configures a real policy.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000)
  maximumOutstandingPlatformDebt?: number;

  @ApiPropertyOptional({ example: true, default: false })
  @IsOptional()
  @IsBoolean()
  blockCashBookingsAtDebtLimit?: boolean;
}


export class DisputeSettingsDto {
  @ApiPropertyOptional({ example: 72, default: 72, description: 'Hours after service completion during which a new participant dispute may be opened.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(2160) filingWindowHours?: number;

  @ApiPropertyOptional({ example: 72, default: 72, description: 'Hours after closure during which a participant may appeal.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(2160) appealWindowHours?: number;

  @ApiPropertyOptional({ example: 72, default: 72, description: 'Default SLA from dispute opening before automatic escalation.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(2160) caseSlaHours?: number;

  @ApiPropertyOptional({ example: 48, default: 48, description: 'Default participant response window for proposed dispute settlements.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(720) settlementResponseHours?: number;

  @ApiPropertyOptional({ example: 48, default: 48, description: 'Default response time for an Admin evidence request when no explicit due date is supplied.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(720) evidenceResponseHours?: number;

  @ApiPropertyOptional({ example: 24, default: 24, description: 'Reminder lead time before an evidence deadline.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(720) evidenceReminderHoursBeforeDue?: number;

  @ApiPropertyOptional({ example: 24, default: 24, description: 'Hours after an evidence deadline before the request expires and the case is escalated.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(720) evidenceOverdueEscalationHours?: number;

  @ApiPropertyOptional({ example: 30, default: 30, description: 'Maximum normalized evidence items stored across the entire dispute.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) maxEvidenceItems?: number;

  @ApiPropertyOptional({ example: 52428800, default: 52428800, description: 'Maximum known evidence bytes stored across the entire dispute.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1048576) @Max(1073741824) maxEvidenceBytes?: number;

  @ApiPropertyOptional({ default: true, description: 'Assign new disputes to the least-loaded active administrator with support.manage.' })
  @IsOptional() @IsBoolean() autoAssignmentEnabled?: boolean;

  @ApiPropertyOptional({ default: true, description: 'Queue dispute lifecycle emails through the durable dispute delivery table.' })
  @IsOptional() @IsBoolean() emailNotificationsEnabled?: boolean;

  @ApiPropertyOptional({ default: false, description: 'Requires a real APNs/FCM provider. Enabling is rejected while none is configured.' })
  @IsOptional() @IsBoolean() mobilePushEnabled?: boolean;

  @ApiPropertyOptional({ default: false, description: 'When enabled, configured strike thresholds can automatically suspend an account.' })
  @IsOptional() @IsBoolean() automaticModerationEnabled?: boolean;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10) strikePointsPerWarning?: number;

  @ApiPropertyOptional({ example: 3, default: 3 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) suspendAtStrikePoints?: number;
}

export class ReferralSettingsDto {
  @ApiPropertyOptional({ description: 'Customer-to-customer program switch.', default: false })
  @IsOptional()
  @IsBoolean()
  clientReferralEnabled?: boolean;
  @ApiPropertyOptional({ description: 'Tasker-to-tasker program switch.', default: false })
  @IsOptional()
  @IsBoolean()
  taskerReferralEnabled?: boolean;
  @ApiPropertyOptional({ description: 'Must remain true while either program is enabled.' })
  @IsOptional()
  @IsBoolean()
  uniqueCodesEnabled?: boolean;
  @IsOptional() @IsBoolean() leaderboardEnabled?: boolean;
  @ApiPropertyOptional({ description: 'Reserved for a future promotion engine; true is rejected.' })
  @IsOptional()
  @IsBoolean()
  bonusStackingEnabled?: boolean;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000)
  clientReferralBonus?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  referredClientDiscountPercent?: number;
  @ApiPropertyOptional({ description: 'Days from attribution to a qualifying paid booking.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  referralExpiryDays?: number;
  @ApiPropertyOptional({ description: 'Zero means no program-level cap.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000000)
  maxClientReferrals?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000)
  taskerReferralBonus?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000)
  referredTaskerBonus?: number;
  @ApiPropertyOptional({ description: 'Zero means no program-level cap.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000000)
  maxTaskerReferrals?: number;
  @ApiPropertyOptional({ example: 14, description: 'Fraud/dispute hold before wallet release.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  rewardClearanceDays?: number;
  @ApiPropertyOptional({ example: 25, description: 'Minimum net paid total that can qualify.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000)
  minimumQualifyingBookingAmount?: number;
  @ApiPropertyOptional({
    example: 5,
    description: 'Minimum real Stripe/wallet charge retained after a referred-customer discount.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000)
  minimumCustomerChargeAmount?: number;
  @ApiPropertyOptional({
    example: 50,
    description: 'Optional discount cap; zero means the percentage and minimum charge are the cap.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000)
  referredClientDiscountMaxAmount?: number;
}

export class UpdatePlatformSettingsDto {
  @ApiPropertyOptional({ type: GeneralSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => GeneralSettingsDto)
  general?: GeneralSettingsDto;

  @ApiPropertyOptional({ type: CurrencySettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CurrencySettingsDto)
  currency?: CurrencySettingsDto;

  @ApiPropertyOptional({ type: TaxSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TaxSettingsDto)
  tax?: TaxSettingsDto;

  @ApiPropertyOptional({ type: BookingRulesSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BookingRulesSettingsDto)
  bookingRules?: BookingRulesSettingsDto;

  @ApiPropertyOptional({ type: ServiceRadiusSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ServiceRadiusSettingsDto)
  serviceRadius?: ServiceRadiusSettingsDto;

  @ApiPropertyOptional({ type: CommissionSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CommissionSettingsDto)
  commission?: CommissionSettingsDto;

  @ApiPropertyOptional({ type: TaskerFinanceSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TaskerFinanceSettingsDto)
  taskerFinance?: TaskerFinanceSettingsDto;

  @ApiPropertyOptional({ type: ReferralSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ReferralSettingsDto)
  referral?: ReferralSettingsDto;

  @ApiPropertyOptional({ type: DisputeSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DisputeSettingsDto)
  disputes?: DisputeSettingsDto;
}

export class PlatformSettingsQueryDto {
  @ApiPropertyOptional({
    example:
      'general,currency,tax,bookingRules,serviceRadius,commission,taskerFinance,referral,disputes,eliteProgram',
    description: 'Comma-separated sections. Omit to return all settings sections.',
  })
  @IsOptional()
  @IsString()
  sections?: string;
}
