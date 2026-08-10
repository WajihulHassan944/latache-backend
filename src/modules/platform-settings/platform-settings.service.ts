import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import type { User } from '../../generated/prisma/client';
import { AdminAuditService } from '../admin-audit/admin-audit.service';
import type {
  BookingRulesSettingsDto,
  CommissionSettingsDto,
  CurrencySettingsDto,
  GeneralSettingsDto,
  ReferralSettingsDto,
  ServiceRadiusSettingsDto,
  TaxSettingsDto,
  UpdatePlatformSettingsDto,
} from './dto/platform-settings.dto';
import {
  PLATFORM_SETTING_KEYS,
  type PlatformSettingKey,
  type PricingChargeResult,
} from './platform-settings.types';

const money = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const dateOnly = (value: Date): string => value.toISOString().slice(0, 10);

@Injectable()
export class PlatformSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AdminAuditService,
  ) {}

  async view(sections?: string): Promise<Record<string, unknown>> {
    const requested = this.parseSections(sections);
    const stored = await this.prisma.platformSetting.findMany({
      where: requested.length
        ? { key: { in: requested.filter((key) => key !== 'eliteProgram') } }
        : undefined,
    });
    const storedMap = new Map(
      stored.map((row) => [row.key, row.value as Record<string, unknown>]),
    );
    const defaults = this.defaults();
    const response: Record<string, unknown> = {};

    for (const key of requested) {
      if (key === 'eliteProgram') {
        response.eliteProgram = await this.eliteProgramView();
        continue;
      }
      const typedKey = key as PlatformSettingKey;
      response[typedKey] = {
        ...(defaults[typedKey] as Record<string, unknown>),
        ...(storedMap.get(typedKey) ?? {}),
      };
    }

    response.capabilities = {
      commissionRulesAffectNewFinalBookingCharges: true,
      globalTaxModeAffectsNewFinalBookingCharges: true,
      bookingRulesEnforcedWhenEnabled: true,
      serviceRadiusPolicyAppliedToDiscovery: true,
      jurisdictionTaxOverridesAppliedAutomatically: false,
      automaticExchangeRateRefreshAvailable: false,
      externalExchangeRateProviderAvailable: false,
      referralRewardEngineAvailable: false,
      cancellationSettlementPolicyAvailable: false,
      regionSpecificRadiusResolutionAvailable: false,
      eliteRulesManagedBy: '/api/admin/elite-taskers/program',
      note:
        'Jurisdiction tax overrides are persisted for policy/reporting but are not auto-applied until bookings carry a verified tax jurisdiction. Referral rewards remain disabled until a referral ledger/module exists.',
    };
    return response;
  }

  async update(actor: User, dto: UpdatePlatformSettingsDto) {
    const entries = Object.entries(dto).filter(([, value]) => value !== undefined) as Array<
      [PlatformSettingKey, Record<string, unknown>]
    >;
    if (entries.length === 0) {
      throw new BadRequestException('At least one settings section must be supplied');
    }

    await this.validateCrossField(dto);

    await this.prisma.$transaction(async (transaction) => {
      for (const [key, value] of entries) {
        const existing = await transaction.platformSetting.findUnique({ where: { key } });
        const merged = {
          ...(existing?.value as Record<string, unknown> | undefined),
          ...this.normalizeSection(key, value),
        };
        await transaction.platformSetting.upsert({
          where: { key },
          create: {
            key,
            value: merged as Prisma.InputJsonValue,
            updatedById: actor.id,
          },
          update: {
            value: merged as Prisma.InputJsonValue,
            version: { increment: 1 },
            updatedById: actor.id,
          },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            action: 'platform_settings_updated',
            entityType: 'platform_setting',
            entityId: key,
            metadata: { section: key, fields: Object.keys(value) },
          },
          transaction,
        );
      }
    });

    return this.view(entries.map(([key]) => key).join(','));
  }

  /**
   * Calculates platform fee/tax for a NEW final charge using persisted policy.
   * Existing settled bookings are never retroactively recalculated.
   */
  async calculatePricingCharges(input: {
    serviceAmount: number;
    taskerId: number;
    serviceId: number;
    bookingDate: Date;
    bookingCreatedAt: Date;
  }): Promise<PricingChargeResult> {
    const [commission, tax, tasker] = await Promise.all([
      this.section<CommissionSettingsDto>('commission'),
      this.section<TaxSettingsDto>('tax'),
      this.prisma.user.findUnique({
        where: { id: input.taskerId },
        select: { eliteTier: { select: { code: true } } },
      }),
    ]);

    const tierCode = tasker?.eliteTier?.code?.toLowerCase() ?? 'standard';
    const baseRate =
      tierCode === 'gold'
        ? commission.goldRatePercent
        : tierCode === 'platinum'
          ? commission.platinumRatePercent
          : tierCode === 'diamond'
            ? commission.diamondRatePercent
            : commission.standardRatePercent;

    let rate = Number(baseRate ?? 0);
    if (commission.categoryOverridesEnabled) {
      const override = commission.categoryOverrides?.find(
        (item) => item.serviceId === input.serviceId,
      );
      if (override) rate += Number(override.deltaPercent);
    }
    if (dateOnly(input.bookingDate) === dateOnly(input.bookingCreatedAt)) {
      rate += Number(commission.sameDaySurchargePercent ?? 0);
    }
    const day = input.bookingDate.getUTCDay();
    if (day === 0 || day === 6) {
      rate += Number(commission.weekendSurchargePercent ?? 0);
    }
    rate = Math.max(0, Math.min(100, rate));

    const calculatedFee = money(input.serviceAmount * (rate / 100));
    const platformFeeAmount = money(
      Math.max(calculatedFee, Number(commission.minimumCommissionAmount ?? 0)),
    );

    let taxRatePercent = 0;
    let taxAmount = 0;
    let serviceSurchargeAmount = 0;
    const taxEnabled = tax.mode === 'global';
    const serviceExempt = tax.exemptServiceIds?.includes(input.serviceId) ?? false;
    if (taxEnabled && !serviceExempt) {
      taxRatePercent = Number(tax.defaultRatePercent ?? 0);
      serviceSurchargeAmount = money(Number(tax.serviceSurchargeAmount ?? 0));
      if (taxRatePercent > 0) {
        taxAmount = tax.inclusivePricing
          ? money(input.serviceAmount * (taxRatePercent / (100 + taxRatePercent)))
          : money(input.serviceAmount * (taxRatePercent / 100));
      }
    }

    return {
      platformFeeAmount,
      taxAmount,
      serviceSurchargeAmount,
      commissionRatePercent: rate,
      taxRatePercent,
      taxInclusive: Boolean(tax.inclusivePricing),
    };
  }

  async serviceRadiusPolicy(): Promise<ServiceRadiusSettingsDto> {
    return this.section<ServiceRadiusSettingsDto>('serviceRadius');
  }

  async assertBookingRules(input: { bookingDate: Date; startTime: string; slotMinutes: number }): Promise<void> {
    const rules = await this.section<BookingRulesSettingsDto>('bookingRules');
    if (!rules.enforcementEnabled) return;
    const minDuration = Number(rules.minDurationMinutes ?? 1);
    const maxDuration = Number(rules.maxDurationMinutes ?? 2880);
    if (input.slotMinutes < minDuration || input.slotMinutes > maxDuration) {
      throw new ConflictException(`Booking duration must be between ${minDuration} and ${maxDuration} minutes`);
    }
    const now = new Date();
    const maxAdvanceDays = Number(rules.maxAdvanceDays ?? 365);
    const latest = new Date(now.getTime() + maxAdvanceDays * 24 * 60 * 60 * 1000);
    if (input.bookingDate > latest) {
      throw new ConflictException(`Bookings cannot be scheduled more than ${maxAdvanceDays} days ahead`);
    }
    const [hours, minutes] = input.startTime.split(':').map((value) => Number(value));
    if (Number.isFinite(hours) && Number.isFinite(minutes)) {
      const scheduled = new Date(input.bookingDate);
      scheduled.setUTCHours(hours ?? 0, minutes ?? 0, 0, 0);
      const minimumNotice = Number(rules.minAdvanceNoticeMinutes ?? 0);
      if (minimumNotice > 0 && scheduled.getTime() - now.getTime() < minimumNotice * 60 * 1000) {
        throw new ConflictException(`Booking requires at least ${minimumNotice} minutes advance notice`);
      }
    }
  }

  private async section<T extends object>(
    key: PlatformSettingKey,
  ): Promise<T> {
    const row = await this.prisma.platformSetting.findUnique({ where: { key } });
    return {
      ...(this.defaults()[key] as Record<string, unknown>),
      ...((row?.value as Record<string, unknown> | undefined) ?? {}),
    } as T;
  }

  private parseSections(raw?: string): string[] {
    const all: string[] = [...PLATFORM_SETTING_KEYS, 'eliteProgram'];
    if (!raw?.trim()) return all;
    const requested = [...new Set(raw.split(',').map((item) => item.trim()).filter(Boolean))];
    const invalid = requested.filter((key) => !all.includes(key));
    if (invalid.length) {
      throw new BadRequestException(`Unknown settings section(s): ${invalid.join(', ')}`);
    }
    return requested;
  }

  private defaults(): Record<PlatformSettingKey, Record<string, unknown>> {
    const runtimeCurrency = this.config.get<string>('payments.currency', 'USD').toUpperCase();
    const fallbackCommission = this.config.get<number>('payments.platformFeePercent', 0);
    return {
      general: {
        platformName: 'Latache',
        supportEmail: null,
        platformUrl: this.config.get<string>('app.baseUrl', 'http://localhost:8080'),
        description: null,
        emailNotificationsEnabled: true,
        smsNotificationsEnabled: false,
        pushNotificationsEnabled: false,
        liveChatEnabled: true,
        maintenanceMode: false,
      },
      currency: {
        primaryCurrency: runtimeCurrency,
        displayFormat: '$1,234.56',
        exchangeRateSource: 'manual',
        multiCurrencyEnabled: false,
        autoRateRefresh: false,
        activeCurrencies: [
          {
            code: runtimeCurrency,
            name: runtimeCurrency,
            symbol: runtimeCurrency,
            exchangeRate: 1,
            isActive: true,
          },
        ],
      },
      tax: {
        mode: 'disabled',
        defaultRatePercent: 0,
        serviceSurchargeAmount: 0,
        inclusivePricing: false,
        receiptsEnabled: true,
        autoReporting: false,
        vatSupport: false,
        jurisdictionOverrides: [],
        exemptServiceIds: [],
      },
      bookingRules: {
        enforcementEnabled: false,
        minAdvanceNoticeMinutes: 0,
        maxAdvanceDays: 365,
        minDurationMinutes: this.config.get<number>('payments.minimumBillableMinutes', 120),
        maxDurationMinutes: 1440,
        cancellationWindowHours: 0,
        lateCancellationFeePercent: 0,
        instantBookingEnabled: false,
        requireTaskerConfirmation: true,
        repeatBookingEnabled: false,
        waitlistEnabled: false,
        emergencyBookingEnabled: false,
        groupBookingEnabled: false,
      },
      serviceRadius: {
        enforcementEnabled: true,
        defaultRadiusKm: 20,
        minimumRadiusKm: 1,
        maximumRadiusKm: 500,
        dynamicRadiusAdjustment: false,
        distanceBasedPricing: false,
        regions: [],
      },
      commission: {
        chargeModel: 'customer_platform_fee',
        standardRatePercent: fallbackCommission,
        goldRatePercent: fallbackCommission,
        platinumRatePercent: fallbackCommission,
        diamondRatePercent: fallbackCommission,
        sameDaySurchargePercent: 0,
        weekendSurchargePercent: 0,
        minimumCommissionAmount: 0,
        categoryOverridesEnabled: false,
        categoryOverrides: [],
      },
      referral: {
        clientReferralEnabled: false,
        taskerReferralEnabled: false,
        uniqueCodesEnabled: false,
        leaderboardEnabled: false,
        bonusStackingEnabled: false,
        clientReferralBonus: 0,
        referredClientDiscountPercent: 0,
        referralExpiryDays: 90,
        maxClientReferrals: 0,
        taskerReferralBonus: 0,
        referredTaskerBonus: 0,
        maxTaskerReferrals: 0,
      },
    };
  }

  private normalizeSection(
    key: PlatformSettingKey,
    value: Record<string, unknown>,
  ): Record<string, unknown> {
    if (key === 'currency') {
      const clone = { ...value };
      if (typeof clone.primaryCurrency === 'string') {
        clone.primaryCurrency = clone.primaryCurrency.toUpperCase();
      }
      if (Array.isArray(clone.activeCurrencies)) {
        clone.activeCurrencies = clone.activeCurrencies.map((item) => ({
          ...(item as Record<string, unknown>),
          code: String((item as Record<string, unknown>).code ?? '').toUpperCase(),
        }));
      }
      return clone;
    }
    return value;
  }

  private async validateCrossField(dto: UpdatePlatformSettingsDto): Promise<void> {
    if (dto.currency?.autoRateRefresh) {
      throw new ConflictException(
        'Automatic exchange-rate refresh is not configured. Keep autoRateRefresh=false and submit verified manual rates.',
      );
    }
    if (dto.currency?.exchangeRateSource && dto.currency.exchangeRateSource !== 'manual') {
      throw new ConflictException(
        'An external exchange-rate provider is not configured. exchangeRateSource must remain manual.',
      );
    }
    if (dto.currency?.multiCurrencyEnabled) {
      throw new ConflictException(
        'Multi-currency settlement is not enabled. Keep multiCurrencyEnabled=false until Stripe/customer/tasker ledgers support currency conversion.',
      );
    }
    if (dto.general?.smsNotificationsEnabled || dto.general?.pushNotificationsEnabled) {
      throw new ConflictException(
        'SMS/push notification providers are not configured; these channels cannot be enabled yet.',
      );
    }
    if (dto.general?.maintenanceMode) {
      throw new ConflictException(
        'Maintenance-mode request blocking is not installed; the API will not accept a cosmetic maintenanceMode=true setting.',
      );
    }
    if (dto.referral?.clientReferralEnabled || dto.referral?.taskerReferralEnabled) {
      throw new ConflictException(
        'Referral payouts cannot be enabled until a referral ledger and redemption engine are implemented.',
      );
    }
    if (
      dto.bookingRules?.instantBookingEnabled ||
      dto.bookingRules?.repeatBookingEnabled ||
      dto.bookingRules?.waitlistEnabled ||
      dto.bookingRules?.emergencyBookingEnabled ||
      dto.bookingRules?.groupBookingEnabled
    ) {
      throw new ConflictException(
        'Instant/repeat/waitlist/emergency/group booking modes do not yet have complete lifecycle implementations and cannot be enabled as cosmetic settings.',
      );
    }
    if (dto.bookingRules?.requireTaskerConfirmation === false) {
      throw new ConflictException('Tasker confirmation is required by the current booking lifecycle.');
    }
    if (Number(dto.bookingRules?.lateCancellationFeePercent ?? 0) > 0) {
      throw new ConflictException(
        'Late-cancellation fees cannot be enabled until the cancellation settlement/refund flow supports that charge.',
      );
    }
    if (Number(dto.bookingRules?.cancellationWindowHours ?? 0) > 0) {
      throw new ConflictException(
        'A paid cancellation-window policy is not implemented yet. Keep cancellationWindowHours=0 so the setting cannot imply unsupported settlement behavior.',
      );
    }
    if (dto.serviceRadius?.dynamicRadiusAdjustment || dto.serviceRadius?.distanceBasedPricing) {
      throw new ConflictException(
        'Dynamic radius and distance-based pricing require routing/pricing providers and cannot be enabled yet.',
      );
    }
    if ((dto.serviceRadius?.regions?.length ?? 0) > 0) {
      throw new ConflictException(
        'Region-specific radius rules require a verified region/geocoding resolver and cannot be activated yet. Use the global radius policy for now.',
      );
    }
    if (dto.tax?.autoReporting || dto.tax?.vatSupport) {
      throw new ConflictException(
        'Automated tax reporting/VAT compliance integrations are not configured; these flags cannot be enabled yet.',
      );
    }
    if (dto.serviceRadius) {
      const current = await this.section<ServiceRadiusSettingsDto>('serviceRadius');
      const min = dto.serviceRadius.minimumRadiusKm ?? current.minimumRadiusKm ?? 1;
      const max = dto.serviceRadius.maximumRadiusKm ?? current.maximumRadiusKm ?? 500;
      const def = dto.serviceRadius.defaultRadiusKm ?? current.defaultRadiusKm ?? 20;
      if (min > max || def < min || def > max) {
        throw new BadRequestException(
          'Service radius must satisfy minimumRadiusKm <= defaultRadiusKm <= maximumRadiusKm',
        );
      }
    }
    if (dto.currency?.primaryCurrency) {
      const runtime = this.config.get<string>('payments.currency', 'USD').toUpperCase();
      if (dto.currency.primaryCurrency.toUpperCase() !== runtime) {
        throw new ConflictException(
          `Primary operational currency is currently ${runtime}. Changing it requires a controlled currency migration and PAYMENTS_CURRENCY update; display/exchange currencies may still be configured.`,
        );
      }
    }
  }

  private async eliteProgramView() {
    const tiers = await this.prisma.eliteTier.findMany({
      where: { isActive: true },
      include: { benefits: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
      orderBy: { rank: 'asc' },
    });
    return {
      tiers: tiers.map((tier) => ({
        code: tier.code,
        name: tier.name,
        rank: tier.rank,
        requirements: tier.requirements,
        benefits: tier.benefits.map((benefit) => ({
          code: benefit.code,
          name: benefit.name,
          displayValue: benefit.displayValue,
        })),
      })),
      managedBy: '/api/admin/elite-taskers/program',
      note: 'Elite requirements and benefits remain owned by the existing Elite Program API to avoid duplicate policy storage.',
    };
  }
}
