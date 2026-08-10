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
}

export class CurrencySettingsDto {
  @IsOptional() @IsString() @Length(3, 3) primaryCurrency?: string;
  @IsOptional() @IsString() @Length(1, 40) displayFormat?: string;
  @IsOptional() @IsIn(['manual', 'open_exchange_rates']) exchangeRateSource?: 'manual' | 'open_exchange_rates';
  @IsOptional() @IsBoolean() multiCurrencyEnabled?: boolean;
  @IsOptional() @IsBoolean() autoRateRefresh?: boolean;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CurrencyItemDto) activeCurrencies?: CurrencyItemDto[];
}

export class TaxSettingsDto {
  @IsOptional() @IsIn(['disabled', 'global']) mode?: 'disabled' | 'global';
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100) defaultRatePercent?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) serviceSurchargeAmount?: number;
  @IsOptional() @IsBoolean() inclusivePricing?: boolean;
  @IsOptional() @IsBoolean() receiptsEnabled?: boolean;
  @IsOptional() @IsBoolean() autoReporting?: boolean;
  @IsOptional() @IsBoolean() vatSupport?: boolean;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TaxJurisdictionDto) jurisdictionOverrides?: TaxJurisdictionDto[];
  @IsOptional() @IsArray() @Type(() => Number) @IsInt({ each: true }) @Min(1, { each: true }) exemptServiceIds?: number[];
}

export class BookingRulesSettingsDto {
  @IsOptional() @IsBoolean() enforcementEnabled?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10080) minAdvanceNoticeMinutes?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(730) maxAdvanceDays?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1440) minDurationMinutes?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(2880) maxDurationMinutes?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(720) cancellationWindowHours?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) lateCancellationFeePercent?: number;
  @IsOptional() @IsBoolean() instantBookingEnabled?: boolean;
  @IsOptional() @IsBoolean() requireTaskerConfirmation?: boolean;
  @IsOptional() @IsBoolean() repeatBookingEnabled?: boolean;
  @IsOptional() @IsBoolean() waitlistEnabled?: boolean;
  @IsOptional() @IsBoolean() emergencyBookingEnabled?: boolean;
  @IsOptional() @IsBoolean() groupBookingEnabled?: boolean;
}

export class ServiceRadiusSettingsDto {
  @IsOptional() @IsBoolean() enforcementEnabled?: boolean;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.1) @Max(500) defaultRadiusKm?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.1) @Max(500) minimumRadiusKm?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.1) @Max(500) maximumRadiusKm?: number;
  @IsOptional() @IsBoolean() dynamicRadiusAdjustment?: boolean;
  @IsOptional() @IsBoolean() distanceBasedPricing?: boolean;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ServiceRegionDto) regions?: ServiceRegionDto[];
}

export class CommissionSettingsDto {
  @IsOptional() @IsIn(['customer_platform_fee']) chargeModel?: 'customer_platform_fee';
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100) standardRatePercent?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100) goldRatePercent?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100) platinumRatePercent?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100) diamondRatePercent?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100) sameDaySurchargePercent?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100) weekendSurchargePercent?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) minimumCommissionAmount?: number;
  @IsOptional() @IsBoolean() categoryOverridesEnabled?: boolean;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CommissionOverrideDto) categoryOverrides?: CommissionOverrideDto[];
}

export class ReferralSettingsDto {
  @IsOptional() @IsBoolean() clientReferralEnabled?: boolean;
  @IsOptional() @IsBoolean() taskerReferralEnabled?: boolean;
  @IsOptional() @IsBoolean() uniqueCodesEnabled?: boolean;
  @IsOptional() @IsBoolean() leaderboardEnabled?: boolean;
  @IsOptional() @IsBoolean() bonusStackingEnabled?: boolean;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) clientReferralBonus?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) referredClientDiscountPercent?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) referralExpiryDays?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) maxClientReferrals?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) taskerReferralBonus?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) referredTaskerBonus?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) maxTaskerReferrals?: number;
}

export class UpdatePlatformSettingsDto {
  @ApiPropertyOptional({ type: GeneralSettingsDto })
  @IsOptional() @ValidateNested() @Type(() => GeneralSettingsDto) general?: GeneralSettingsDto;

  @ApiPropertyOptional({ type: CurrencySettingsDto })
  @IsOptional() @ValidateNested() @Type(() => CurrencySettingsDto) currency?: CurrencySettingsDto;

  @ApiPropertyOptional({ type: TaxSettingsDto })
  @IsOptional() @ValidateNested() @Type(() => TaxSettingsDto) tax?: TaxSettingsDto;

  @ApiPropertyOptional({ type: BookingRulesSettingsDto })
  @IsOptional() @ValidateNested() @Type(() => BookingRulesSettingsDto) bookingRules?: BookingRulesSettingsDto;

  @ApiPropertyOptional({ type: ServiceRadiusSettingsDto })
  @IsOptional() @ValidateNested() @Type(() => ServiceRadiusSettingsDto) serviceRadius?: ServiceRadiusSettingsDto;

  @ApiPropertyOptional({ type: CommissionSettingsDto })
  @IsOptional() @ValidateNested() @Type(() => CommissionSettingsDto) commission?: CommissionSettingsDto;

  @ApiPropertyOptional({ type: ReferralSettingsDto })
  @IsOptional() @ValidateNested() @Type(() => ReferralSettingsDto) referral?: ReferralSettingsDto;
}

export class PlatformSettingsQueryDto {
  @ApiPropertyOptional({
    example: 'general,currency,tax,bookingRules,serviceRadius,commission,referral,eliteProgram',
    description: 'Comma-separated sections. Omit to return all settings sections.',
  })
  @IsOptional()
  @IsString()
  sections?: string;
}
