import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import type { User } from '../../generated/prisma/client';
import { AdminAuditService } from '../admin-audit/admin-audit.service';
import { LocaleService } from '../localization/locale.service';
import type {
  BookingRulesSettingsDto,
  CommissionSettingsDto,
  DisputeSettingsDto,
  ReferralSettingsDto,
  ServiceRadiusSettingsDto,
  TaskerFinanceSettingsDto,
  TaxSettingsDto,
  UpdatePlatformSettingsDto,
} from './dto/platform-settings.dto';
import {
  PLATFORM_SETTING_KEYS,
  type PlatformSettingKey,
  type PricingChargeResult,
  type DisputePolicy,
  type ReferralPolicy,
  type TaskerFinancePolicy,
  type PlatformCurrencyContext,
  type PlatformMarket,
} from './platform-settings.types';
import { AppCacheService, CacheNamespace } from '../../infrastructure/redis/app-cache.service';
import { UserRole } from '../../common/enums/user-role.enum';
import {
  PLATFORM_CURRENCY_PRESETS,
  STATIC_RATE_VERSION,
} from './platform-currency.presets';

const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const dateOnly = (value: Date): string => value.toISOString().slice(0, 10);



@Injectable()
export class PlatformSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AdminAuditService,
    private readonly locales: LocaleService,
    private readonly cache: AppCacheService,
  ) {}

  async view(sections?: string): Promise<Record<string, unknown>> {
    const requested = this.parseSections(sections);
    return this.cache.getOrLoad(
      CacheNamespace.PlatformContent,
      { operation: 'settings-view', sections: [...requested].sort() },
      this.config.get<number>('cache.settingsTtlSeconds', 300),
      () => this.loadView(requested),
    );
  }

  private async loadView(requested: string[]): Promise<Record<string, unknown>> {
    const storedKeys = requested.length
      ? [
          ...new Set([
            ...requested.filter((key) => key !== 'eliteProgram'),
            ...(requested.some((key) => key !== 'eliteProgram' && key !== 'currency')
              ? ['currency']
              : []),
          ]),
        ]
      : [];
    const stored = await this.prisma.platformSetting.findMany({
      where: storedKeys.length ? { key: { in: storedKeys } } : undefined,
    });
    const storedMap = new Map(stored.map((row) => [row.key, row.value as Record<string, unknown>]));
    const defaults = this.defaults();
    const response: Record<string, unknown> = {};
    const rawCurrency = {
      ...(defaults.currency as Record<string, unknown>),
      ...(storedMap.get('currency') ?? {}),
    };
    const viewCurrency = this.currencyContextFromSettings(rawCurrency);

    for (const key of requested) {
      if (key === 'eliteProgram') {
        response.eliteProgram = await this.eliteProgramView();
        continue;
      }
      const typedKey = key as PlatformSettingKey;
      const merged = {
        ...(defaults[typedKey] as Record<string, unknown>),
        ...(storedMap.get(typedKey) ?? {}),
      };
      response[typedKey] =
        typedKey === 'currency'
          ? this.serializeCurrencySettings(merged)
          : this.serializeMonetarySection(typedKey, merged, viewCurrency);
    }

    response.capabilities = {
      commissionRulesAffectNewFinalBookingCharges: true,
      globalTaxModeAffectsNewFinalBookingCharges: true,
      bookingRulesEnforcedWhenEnabled: true,
      bookingCompletionApprovalAvailable: true,
      bookingAutoCompletionRequiresWorker: true,
      serviceRadiusPolicyAppliedToDiscovery: true,
      jurisdictionTaxOverridesAppliedAutomatically: false,
      automaticExchangeRateRefreshAvailable: false,
      externalExchangeRateProviderAvailable: false,
      platformCurrencyMarketsAvailable: 5,
      staticCurrencyPresetMode: true,
      referralRewardEngineAvailable: true,
      referralCustomerDiscountAvailable: true,
      referralPolicyOwner: 'super_admin',
      commissionPolicyOwner: 'super_admin',
      eliteTierPolicyOwner: 'super_admin',
      disputeLifecycleAutomationAvailable: true,
      disputeEmailDeliveryAvailable: true,
      disputeMobilePushProviderConfigured: false,
      cancellationSettlementPolicyAvailable: false,
      taskerEarningClearanceAvailable: true,
      cashPlatformPayableAccountingAvailable: true,
      regionSpecificRadiusResolutionAvailable: false,
      eliteRulesManagedBy: '/api/admin/elite-taskers/program',
      contentManagementAvailable: true,
      contentManagementPublicRead: '/api/content/:slug',
      contentManagementAdminRead: '/api/admin/content',
      contentBlockTypesExtensible: true,
      supportedContentLocales: ['en', 'ar', 'ary'],
      note: 'Completion approval and referral expiry/reward clearance require the production worker. Referral rules are disabled by default and affect only new attributions; their policy is snapshotted and rewards require a real settled online booking. Jurisdiction tax overrides remain reporting-only until bookings carry a verified jurisdiction.',
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

    const general = dto.general as Record<string, unknown> | undefined;
    const translations = general?.translations as Array<Record<string, unknown>> | undefined;
    if (translations) {
      const localeCodes = translations.map((translation) =>
        this.locales.requireSupported(String(translation.locale)),
      );
      if (new Set(localeCodes).size !== localeCodes.length) {
        throw new BadRequestException({
          code: 'DUPLICATE_TRANSLATION_LOCALE',
          message: 'Each locale may appear only once in general.translations',
        });
      }
      translations.forEach((translation, index) => {
        translation.locale = localeCodes[index];
      });
    }

    if (dto.currency && actor.role !== UserRole.SuperAdmin) {
      throw new ForbiddenException('Only Super Admin can change the platform currency');
    }
    if (dto.referral && actor.role !== UserRole.SuperAdmin) {
      throw new ForbiddenException('Only Super Admin can change referral and reward policy');
    }
    if (dto.commission && actor.role !== UserRole.SuperAdmin) {
      throw new ForbiddenException('Only Super Admin can change commission and Elite pricing policy');
    }

    const currentCurrency = await this.currencyContext();
    const normalizedCurrency = dto.currency
      ? this.normalizeSection('currency', dto.currency as unknown as Record<string, unknown>)
      : null;
    const effectiveCurrency = normalizedCurrency
      ? this.currencyContextFromSettings({
          primaryMarket: normalizedCurrency.primaryMarket ?? currentCurrency.market,
          primaryCurrency: normalizedCurrency.primaryCurrency ?? currentCurrency.code,
        })
      : currentCurrency;
    if (effectiveCurrency.code !== currentCurrency.code) {
      await this.assertCurrencySwitchSafe();
    }

    await this.validateCrossField(dto);

    await this.prisma.$transaction(async (transaction) => {
      for (const [key, value] of entries) {
        const existing = await transaction.platformSetting.findUnique({ where: { key } });
        const normalizedValue =
          key === 'currency'
            ? this.normalizeSection(key, value)
            : this.normalizeMonetarySectionInput(key, value, effectiveCurrency);
        const merged = {
          ...(existing?.value as Record<string, unknown> | undefined),
          ...normalizedValue,
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
      if (effectiveCurrency.code !== currentCurrency.code) {
        await Promise.all([
          transaction.customerWallet.updateMany({ data: { currency: effectiveCurrency.code } }),
          transaction.taskerWallet.updateMany({ data: { currency: effectiveCurrency.code } }),
          transaction.taskerPlatformAccount.updateMany({ data: { currency: effectiveCurrency.code } }),
        ]);
      }
    });

    await Promise.all([
      this.cache.invalidate(CacheNamespace.PlatformContent),
      this.cache.invalidate(CacheNamespace.AdminAnalytics),
      ...(dto.currency ? [this.cache.invalidate(CacheNamespace.Services)] : []),
    ]);

    return this.view(entries.map(([key]) => key).join(','));
  }

  async publicContent(locale: string): Promise<Record<string, unknown>> {
    const response = await this.view('general,currency');
    const general = response.general as Record<string, unknown>;
    const currency = response.currency as Record<string, unknown>;
    const translations = (general.translations ?? []) as Array<{
      locale: string;
      platformName?: string;
      description?: string;
    }>;
    const requested = translations.find((translation) => translation.locale === locale);
    const english = translations.find(
      (translation) => translation.locale === this.locales.defaultLocale,
    );
    const selected = requested ?? english;
    return {
      platformName: selected?.platformName ?? general.platformName,
      description: selected?.description ?? general.description,
      supportEmail: general.supportEmail,
      platformUrl: general.platformUrl,
      resolvedLocale: selected?.locale ?? 'canonical',
      translationFallback: !requested,
      currency: {
        market: currency.primaryMarket,
        country: currency.country,
        code: currency.primaryCurrency,
        symbol: currency.symbol,
        rateFromUsd: currency.rateFromUsd,
        staticRateVersion: currency.staticRateVersion,
      },
    };
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
    const [commission, tax, tasker, currency] = await Promise.all([
      this.section<CommissionSettingsDto>('commission'),
      this.section<TaxSettingsDto>('tax'),
      this.prisma.user.findUnique({
        where: { id: input.taskerId },
        select: {
          eliteTier: {
            select: {
              code: true,
              benefits: {
                where: { code: 'tier_commission_policy', isActive: true },
                select: { id: true },
                take: 1,
              },
            },
          },
        },
      }),
      this.currencyContext(),
    ]);

    const tierCode = tasker?.eliteTier?.code?.toLowerCase() ?? 'standard';
    const eliteCommissionPerkApplied = Boolean(tasker?.eliteTier?.benefits?.length);
    const pricingTierCode = eliteCommissionPerkApplied ? tierCode : 'standard';
    const baseRate =
      pricingTierCode === 'gold'
        ? commission.goldRatePercent
        : pricingTierCode === 'platinum'
          ? commission.platinumRatePercent
          : pricingTierCode === 'diamond'
            ? commission.diamondRatePercent
            : commission.standardRatePercent;
    const minimumTaskPriceUsd =
      pricingTierCode === 'gold'
        ? Number(commission.goldMinTaskPrice ?? 0)
        : pricingTierCode === 'platinum'
          ? Number(commission.platinumMinTaskPrice ?? 0)
          : pricingTierCode === 'diamond'
            ? Number(commission.diamondMinTaskPrice ?? 0)
            : Number(commission.standardMinTaskPrice ?? 0);
    const minimumTaskPrice = this.convertUsdAmount(minimumTaskPriceUsd, currency);
    const rawServiceAmount = money(input.serviceAmount);
    const effectiveServiceAmount = money(Math.max(rawServiceAmount, minimumTaskPrice));

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

    const calculatedFee = money(effectiveServiceAmount * (rate / 100));
    const platformFeeAmount = money(
      Math.max(
        calculatedFee,
        this.convertUsdAmount(Number(commission.minimumCommissionAmount ?? 0), currency),
      ),
    );

    let taxRatePercent = 0;
    let taxAmount = 0;
    let serviceSurchargeAmount = 0;
    const taxEnabled = tax.mode === 'global';
    const serviceExempt = tax.exemptServiceIds?.includes(input.serviceId) ?? false;
    if (taxEnabled && !serviceExempt) {
      taxRatePercent = Number(tax.defaultRatePercent ?? 0);
      serviceSurchargeAmount = this.convertUsdAmount(
        Number(tax.serviceSurchargeAmount ?? 0),
        currency,
      );
      if (taxRatePercent > 0) {
        taxAmount = tax.inclusivePricing
          ? money(effectiveServiceAmount * (taxRatePercent / (100 + taxRatePercent)))
          : money(effectiveServiceAmount * (taxRatePercent / 100));
      }
    }

    return {
      rawServiceAmount,
      serviceAmount: effectiveServiceAmount,
      minimumTaskPrice,
      minimumTaskPriceApplied: effectiveServiceAmount > rawServiceAmount,
      taskerTierCode: tierCode,
      eliteCommissionPerkApplied,
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

  async taskerFinancePolicy(transaction?: Prisma.TransactionClient): Promise<TaskerFinancePolicy> {
    const [section, currency] = await Promise.all([
      this.section<TaskerFinanceSettingsDto>('taskerFinance', transaction),
      this.currencyContext(transaction),
    ]);
    return {
      earningClearanceDays: Number(section.earningClearanceDays ?? 14),
      cashDisputeClearanceDays: Number(section.cashDisputeClearanceDays ?? 14),
      maximumOutstandingPlatformDebt: this.convertUsdAmount(
        Number(section.maximumOutstandingPlatformDebt ?? 0),
        currency,
      ),
      blockCashBookingsAtDebtLimit: Boolean(section.blockCashBookingsAtDebtLimit),
    };
  }

  async referralPolicy(transaction?: Prisma.TransactionClient): Promise<ReferralPolicy> {
    const row = await (transaction ?? this.prisma).platformSetting.findUnique({
      where: { key: 'referral' },
    });
    const section = {
      ...(this.defaults().referral as Record<string, unknown>),
      ...((row?.value as Record<string, unknown> | undefined) ?? {}),
    } as ReferralSettingsDto;
    const currency = await this.currencyContext(transaction);
    return {
      version: row?.version ?? 0,
      currency: String(
        currency.code,
      ).toUpperCase(),
      clientReferralEnabled: Boolean(section.clientReferralEnabled),
      taskerReferralEnabled: Boolean(section.taskerReferralEnabled),
      uniqueCodesEnabled: Boolean(section.uniqueCodesEnabled),
      leaderboardEnabled: Boolean(section.leaderboardEnabled),
      bonusStackingEnabled: Boolean(section.bonusStackingEnabled),
      clientReferralBonus: this.convertUsdAmount(Number(section.clientReferralBonus ?? 0), currency),
      referredClientDiscountPercent: Number(section.referredClientDiscountPercent ?? 0),
      referredClientDiscountMaxAmount: this.convertUsdAmount(
        Number(section.referredClientDiscountMaxAmount ?? 0),
        currency,
      ),
      taskerReferralBonus: this.convertUsdAmount(Number(section.taskerReferralBonus ?? 0), currency),
      referredTaskerBonus: this.convertUsdAmount(Number(section.referredTaskerBonus ?? 0), currency),
      referralExpiryDays: Number(section.referralExpiryDays ?? 90),
      rewardClearanceDays: Number(section.rewardClearanceDays ?? 14),
      minimumQualifyingBookingAmount: this.convertUsdAmount(
        Number(section.minimumQualifyingBookingAmount ?? 0),
        currency,
      ),
      minimumCustomerChargeAmount: this.convertUsdAmount(
        Number(section.minimumCustomerChargeAmount ?? 0),
        currency,
      ),
      maxClientReferrals: Number(section.maxClientReferrals ?? 0),
      maxTaskerReferrals: Number(section.maxTaskerReferrals ?? 0),
    };
  }


  async disputePolicy(transaction?: Prisma.TransactionClient): Promise<DisputePolicy> {
    const section = await this.section<DisputeSettingsDto>('disputes', transaction);
    return {
      filingWindowHours: Number(section.filingWindowHours ?? 72),
      appealWindowHours: Number(section.appealWindowHours ?? 72),
      caseSlaHours: Number(section.caseSlaHours ?? 72),
      settlementResponseHours: Number(section.settlementResponseHours ?? 48),
      evidenceResponseHours: Number(section.evidenceResponseHours ?? 48),
      evidenceReminderHoursBeforeDue: Number(section.evidenceReminderHoursBeforeDue ?? 24),
      evidenceOverdueEscalationHours: Number(section.evidenceOverdueEscalationHours ?? 24),
      maxEvidenceItems: Number(section.maxEvidenceItems ?? 30),
      maxEvidenceBytes: Number(section.maxEvidenceBytes ?? 50 * 1024 * 1024),
      autoAssignmentEnabled: section.autoAssignmentEnabled !== false,
      emailNotificationsEnabled: section.emailNotificationsEnabled !== false,
      mobilePushEnabled: Boolean(section.mobilePushEnabled),
      automaticModerationEnabled: Boolean(section.automaticModerationEnabled),
      strikePointsPerWarning: Number(section.strikePointsPerWarning ?? 1),
      suspendAtStrikePoints: Number(section.suspendAtStrikePoints ?? 3),
    };
  }

  async bookingCompletionPolicy(transaction?: Prisma.TransactionClient): Promise<{
    approvalHours: number;
  }> {
    const section = await this.section<BookingRulesSettingsDto>('bookingRules', transaction);
    return {
      approvalHours: Number(
        section.completionApprovalHours ??
          this.config.get<number>('bookingCompletion.approvalHours', 24),
      ),
    };
  }

  async assertBookingRules(input: {
    bookingDate: Date;
    startTime: string;
    slotMinutes: number;
  }): Promise<void> {
    const rules = await this.section<BookingRulesSettingsDto>('bookingRules');
    if (!rules.enforcementEnabled) return;
    const minDuration = Number(rules.minDurationMinutes ?? 1);
    const maxDuration = Number(rules.maxDurationMinutes ?? 2880);
    if (input.slotMinutes < minDuration || input.slotMinutes > maxDuration) {
      throw new ConflictException(
        `Booking duration must be between ${minDuration} and ${maxDuration} minutes`,
      );
    }
    const now = new Date();
    const maxAdvanceDays = Number(rules.maxAdvanceDays ?? 365);
    const latest = new Date(now.getTime() + maxAdvanceDays * 24 * 60 * 60 * 1000);
    if (input.bookingDate > latest) {
      throw new ConflictException(
        `Bookings cannot be scheduled more than ${maxAdvanceDays} days ahead`,
      );
    }
    const [hours, minutes] = input.startTime.split(':').map((value) => Number(value));
    if (Number.isFinite(hours) && Number.isFinite(minutes)) {
      const scheduled = new Date(input.bookingDate);
      scheduled.setUTCHours(hours ?? 0, minutes ?? 0, 0, 0);
      const minimumNotice = Number(rules.minAdvanceNoticeMinutes ?? 0);
      if (minimumNotice > 0 && scheduled.getTime() - now.getTime() < minimumNotice * 60 * 1000) {
        throw new ConflictException(
          `Booking requires at least ${minimumNotice} minutes advance notice`,
        );
      }
    }
  }

  private async section<T extends object>(
    key: PlatformSettingKey,
    transaction?: Prisma.TransactionClient,
  ): Promise<T> {
    const row = await (transaction ?? this.prisma).platformSetting.findUnique({
      where: { key },
    });
    return {
      ...(this.defaults()[key] as Record<string, unknown>),
      ...((row?.value as Record<string, unknown> | undefined) ?? {}),
    } as T;
  }

  private parseSections(raw?: string): string[] {
    const all: string[] = [...PLATFORM_SETTING_KEYS, 'eliteProgram'];
    if (!raw?.trim()) return all;
    const requested = [
      ...new Set(
        raw
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ];
    const invalid = requested.filter((key) => !all.includes(key));
    if (invalid.length) {
      throw new BadRequestException(`Unknown settings section(s): ${invalid.join(', ')}`);
    }
    return requested;
  }

  private defaults(): Record<PlatformSettingKey, Record<string, unknown>> {
    const runtimeCurrency = this.config.get<string>('payments.currency', 'USD').toUpperCase();
    const defaultMarket = this.marketForCurrency(runtimeCurrency);
    const defaultCurrency = PLATFORM_CURRENCY_PRESETS[defaultMarket];
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
        primaryMarket: defaultMarket,
        primaryCurrency: defaultCurrency.code,
        displayFormat: this.displayFormatFor(defaultCurrency),
        exchangeRateSource: 'manual',
        multiCurrencyEnabled: false,
        autoRateRefresh: false,
        activeCurrencies: this.currencyPresetList(defaultMarket),
        staticRateVersion: STATIC_RATE_VERSION,
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
        completionApprovalHours: this.config.get<number>('bookingCompletion.approvalHours', 24),
      },
      serviceRadius: {
        enforcementEnabled: true,
        defaultRadiusKm: 100,
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
        standardMinTaskPrice: 0,
        goldMinTaskPrice: 0,
        platinumMinTaskPrice: 0,
        diamondMinTaskPrice: 0,
        sameDaySurchargePercent: 0,
        weekendSurchargePercent: 0,
        minimumCommissionAmount: 0,
        categoryOverridesEnabled: false,
        categoryOverrides: [],
      },
      taskerFinance: {
        earningClearanceDays: this.config.get<number>('taskerFinance.defaultClearanceDays', 14),
        cashDisputeClearanceDays: this.config.get<number>(
          'taskerFinance.defaultCashDisputeDays',
          14,
        ),
        maximumOutstandingPlatformDebt: 0,
        blockCashBookingsAtDebtLimit: false,
      },
      referral: {
        clientReferralEnabled: false,
        taskerReferralEnabled: false,
        uniqueCodesEnabled: true,
        leaderboardEnabled: false,
        bonusStackingEnabled: false,
        clientReferralBonus: 0,
        referredClientDiscountPercent: 0,
        referralExpiryDays: 90,
        maxClientReferrals: 0,
        taskerReferralBonus: 0,
        referredTaskerBonus: 0,
        maxTaskerReferrals: 0,
        rewardClearanceDays: 14,
        minimumQualifyingBookingAmount: 0,
        minimumCustomerChargeAmount: 0,
        referredClientDiscountMaxAmount: 0,
      },
      disputes: {
        filingWindowHours: 72,
        appealWindowHours: 72,
        caseSlaHours: 72,
        settlementResponseHours: 48,
        evidenceResponseHours: 48,
        evidenceReminderHoursBeforeDue: 24,
        evidenceOverdueEscalationHours: 24,
        maxEvidenceItems: 30,
        maxEvidenceBytes: 50 * 1024 * 1024,
        autoAssignmentEnabled: true,
        emailNotificationsEnabled: true,
        mobilePushEnabled: false,
        automaticModerationEnabled: false,
        strikePointsPerWarning: 1,
        suspendAtStrikePoints: 3,
      },
    };
  }

  private normalizeSection(
    key: PlatformSettingKey,
    value: Record<string, unknown>,
  ): Record<string, unknown> {
    if (key !== 'currency') return value;
    const requestedMarket = value.primaryMarket as PlatformMarket | undefined;
    const requestedCurrency =
      typeof value.primaryCurrency === 'string' ? value.primaryCurrency.toUpperCase() : undefined;
    const market = requestedMarket ?? (requestedCurrency ? this.marketForCurrency(requestedCurrency) : undefined);
    if (!market) return value;
    const preset = PLATFORM_CURRENCY_PRESETS[market];
    return {
      ...value,
      primaryMarket: market,
      primaryCurrency: preset.code,
      displayFormat: this.displayFormatFor(preset),
      exchangeRateSource: 'manual',
      multiCurrencyEnabled: false,
      autoRateRefresh: false,
      activeCurrencies: this.currencyPresetList(market),
      staticRateVersion: STATIC_RATE_VERSION,
    };
  }

  async currencyContext(transaction?: Prisma.TransactionClient): Promise<PlatformCurrencyContext> {
    const section = await this.section<{ primaryMarket?: PlatformMarket; primaryCurrency?: string }>(
      'currency',
      transaction,
    );
    const market = section.primaryMarket ?? this.marketForCurrency(section.primaryCurrency ?? 'USD');
    return PLATFORM_CURRENCY_PRESETS[market];
  }

  convertUsdAmount(value: number | Prisma.Decimal, context: PlatformCurrencyContext): number {
    return money(Number(value) * context.rateFromUsd);
  }

  convertPlatformAmountToUsd(value: number, context: PlatformCurrencyContext): number {
    return money(value / context.rateFromUsd);
  }

  convertCurrencyAmountToUsd(value: number | Prisma.Decimal, currencyCode: string): number {
    const normalized = currencyCode.toUpperCase();
    const preset = Object.values(PLATFORM_CURRENCY_PRESETS).find(
      (candidate) => candidate.code === normalized,
    );
    if (!preset) {
      throw new ConflictException(`Unsupported platform currency ${normalized}`);
    }
    return money(Number(value) / preset.rateFromUsd);
  }

  convertCurrencyAmount(
    value: number | Prisma.Decimal,
    sourceCurrencyCode: string,
    target: PlatformCurrencyContext,
  ): number {
    return this.convertUsdAmount(
      this.convertCurrencyAmountToUsd(value, sourceCurrencyCode),
      target,
    );
  }

  private serializeCurrencySettings(value: Record<string, unknown>): Record<string, unknown> {
    const requestedMarket = value.primaryMarket as PlatformMarket | undefined;
    const market = requestedMarket ?? this.marketForCurrency(String(value.primaryCurrency ?? 'USD'));
    const current = PLATFORM_CURRENCY_PRESETS[market];
    return {
      ...value,
      primaryMarket: current.market,
      primaryCurrency: current.code,
      symbol: current.symbol,
      country: current.country,
      rateFromUsd: current.rateFromUsd,
      staticRateVersion: STATIC_RATE_VERSION,
      displayFormat: this.displayFormatFor(current),
      exchangeRateSource: 'manual_static',
      multiCurrencyEnabled: false,
      autoRateRefresh: false,
      activeCurrencies: this.currencyPresetList(current.market),
      availableMarkets: this.currencyPresetList(current.market),
      note: 'Rates are fixed application presets, not live FX. Exactly one market is operational at a time; France and Spain both use EUR.',
    };
  }

  private currencyPresetList(selectedMarket: PlatformMarket = 'us') {
    return (Object.keys(PLATFORM_CURRENCY_PRESETS) as PlatformMarket[]).map((market) => {
      const preset = PLATFORM_CURRENCY_PRESETS[market];
      return {
        market: preset.market,
        country: preset.country,
        code: preset.code,
        name: preset.name,
        symbol: preset.symbol,
        exchangeRate: preset.rateFromUsd,
        isActive: market === selectedMarket,
      };
    });
  }

  private marketForCurrency(code: string): PlatformMarket {
    const normalized = code.toUpperCase();
    if (normalized === 'MAD') return 'morocco';
    if (normalized === 'PKR') return 'pakistan';
    if (normalized === 'EUR') return 'france';
    return 'us';
  }

  private displayFormatFor(context: PlatformCurrencyContext): string {
    return `${context.symbol}1,234.56`;
  }

  private currencyContextFromSettings(value: Record<string, unknown>): PlatformCurrencyContext {
    const market =
      (value.primaryMarket as PlatformMarket | undefined) ??
      this.marketForCurrency(String(value.primaryCurrency ?? 'USD'));
    return PLATFORM_CURRENCY_PRESETS[market];
  }

  private monetaryFields(key: PlatformSettingKey): string[] {
    if (key === 'commission') {
      return [
        'standardMinTaskPrice',
        'goldMinTaskPrice',
        'platinumMinTaskPrice',
        'diamondMinTaskPrice',
        'minimumCommissionAmount',
      ];
    }
    if (key === 'tax') return ['serviceSurchargeAmount'];
    if (key === 'taskerFinance') return ['maximumOutstandingPlatformDebt'];
    if (key === 'referral') {
      return [
        'clientReferralBonus',
        'referredClientDiscountMaxAmount',
        'taskerReferralBonus',
        'referredTaskerBonus',
        'minimumQualifyingBookingAmount',
        'minimumCustomerChargeAmount',
      ];
    }
    return [];
  }

  private normalizeMonetarySectionInput(
    key: PlatformSettingKey,
    value: Record<string, unknown>,
    currency: PlatformCurrencyContext,
  ): Record<string, unknown> {
    const normalized = { ...value };
    for (const field of this.monetaryFields(key)) {
      if (typeof normalized[field] === 'number') {
        normalized[field] = this.convertPlatformAmountToUsd(Number(normalized[field]), currency);
      }
    }
    return normalized;
  }

  private serializeMonetarySection(
    key: PlatformSettingKey,
    value: Record<string, unknown>,
    currency: PlatformCurrencyContext,
  ): Record<string, unknown> {
    const serialized = { ...value };
    for (const field of this.monetaryFields(key)) {
      if (typeof serialized[field] === 'number') {
        serialized[field] = this.convertUsdAmount(Number(serialized[field]), currency);
      }
    }
    if (this.monetaryFields(key).length) {
      serialized.currency = currency.code;
      serialized.currencySymbol = currency.symbol;
    }
    return serialized;
  }

  private async assertCurrencySwitchSafe(): Promise<void> {
    const [activeBookings, customerWallets, taskerWallets, platformAccounts, earnings, receivables, withdrawals] =
      await Promise.all([
        this.prisma.booking.count({
          where: {
            OR: [
              { status: { in: ['pending', 'confirmed', 'en_route', 'arrived', 'in_progress', 'awaiting_customer_approval'] } },
              { paymentStatus: { in: ['ready', 'processing', 'requires_action', 'on_hold_dispute', 'cash_confirmation_required'] } },
            ],
          },
        }),
        this.prisma.customerWallet.count({ where: { availableBalance: { not: 0 } } }),
        this.prisma.taskerWallet.count({
          where: { OR: [{ availableBalance: { not: 0 } }, { pendingBalance: { not: 0 } }] },
        }),
        this.prisma.taskerPlatformAccount.count({ where: { outstandingPayable: { not: 0 } } }),
        this.prisma.taskerEarning.count({
          where: { status: { in: ['pending', 'available', 'partially_reversed'] } },
        }),
        this.prisma.taskerPlatformReceivable.count({ where: { outstandingAmount: { gt: 0 } } }),
        this.prisma.taskerWithdrawal.count({ where: { status: { in: ['pending_review', 'processing'] } } }),
      ]);
    const blockers = {
      activeBookings,
      customerWallets,
      taskerWallets,
      platformAccounts,
      earnings,
      receivables,
      withdrawals,
    };
    if (Object.values(blockers).some((count) => count > 0)) {
      throw new ConflictException({
        code: 'PLATFORM_CURRENCY_SWITCH_BLOCKED',
        message:
          'Settle active bookings, wallet balances, earnings, receivables and withdrawals before changing the operational currency.',
        blockers,
      });
    }
  }

  private async validateCrossField(dto: UpdatePlatformSettingsDto): Promise<void> {
    if (dto.currency?.activeCurrencies !== undefined) {
      throw new ConflictException(
        'Supported currency presets and static rates are application-managed. Select primaryMarket instead of supplying activeCurrencies.',
      );
    }
    if (dto.currency?.autoRateRefresh) {
      throw new ConflictException(
        'Automatic exchange-rate refresh is not configured. Platform currency uses fixed application presets.',
      );
    }
    if (dto.currency?.exchangeRateSource && dto.currency.exchangeRateSource !== 'manual') {
      throw new ConflictException(
        'An external exchange-rate provider is not configured. Platform currency uses fixed application presets.',
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
    if (dto.referral) {
      const current = await this.section<ReferralSettingsDto>('referral');
      const referral = { ...current, ...dto.referral };
      if (referral.bonusStackingEnabled) {
        throw new ConflictException(
          'Referral bonus stacking requires a promotion engine and cannot be enabled yet.',
        );
      }
      if (
        (referral.clientReferralEnabled || referral.taskerReferralEnabled) &&
        !referral.uniqueCodesEnabled
      ) {
        throw new BadRequestException(
          'Unique referral codes are required while referrals are enabled',
        );
      }
      if (
        referral.clientReferralEnabled &&
        Number(referral.clientReferralBonus ?? 0) <= 0 &&
        Number(referral.referredClientDiscountPercent ?? 0) <= 0
      ) {
        throw new BadRequestException(
          'Customer referrals require a referrer bonus or referred-customer discount',
        );
      }
      if (
        referral.taskerReferralEnabled &&
        Number(referral.taskerReferralBonus ?? 0) <= 0 &&
        Number(referral.referredTaskerBonus ?? 0) <= 0
      ) {
        throw new BadRequestException('Tasker referrals require at least one configured bonus');
      }
      if (
        referral.clientReferralEnabled &&
        Number(referral.referredClientDiscountPercent ?? 0) > 0 &&
        Number(referral.minimumCustomerChargeAmount ?? 0) <= 0
      ) {
        throw new BadRequestException(
          'minimumCustomerChargeAmount must be greater than zero when a referral discount is enabled',
        );
      }
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
      throw new ConflictException(
        'Tasker confirmation is required by the current booking lifecycle.',
      );
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
      const def = dto.serviceRadius.defaultRadiusKm ?? current.defaultRadiusKm ?? 100;
      if (min > max || def < min || def > max) {
        throw new BadRequestException(
          'Service radius must satisfy minimumRadiusKm <= defaultRadiusKm <= maximumRadiusKm',
        );
      }
    }
    if (dto.disputes?.mobilePushEnabled === true) {
      throw new ConflictException(
        'Dispute mobile push cannot be enabled until a real APNs/FCM provider is configured.',
      );
    }
    if (dto.disputes) {
      const current = await this.section<DisputeSettingsDto>('disputes');
      const strikePoints = Number(
        dto.disputes.strikePointsPerWarning ?? current.strikePointsPerWarning ?? 1,
      );
      const suspendAt = Number(
        dto.disputes.suspendAtStrikePoints ?? current.suspendAtStrikePoints ?? 3,
      );
      if (suspendAt < strikePoints) {
        throw new BadRequestException(
          'suspendAtStrikePoints must be greater than or equal to strikePointsPerWarning',
        );
      }
    }

    if (
      dto.taskerFinance?.blockCashBookingsAtDebtLimit === true &&
      Number(dto.taskerFinance.maximumOutstandingPlatformDebt ?? 0) <= 0
    ) {
      const current = await this.section<TaskerFinanceSettingsDto>('taskerFinance');
      const threshold = Number(
        dto.taskerFinance.maximumOutstandingPlatformDebt ??
          current.maximumOutstandingPlatformDebt ??
          0,
      );
      if (threshold <= 0) {
        throw new BadRequestException(
          'maximumOutstandingPlatformDebt must be greater than zero when cash-booking debt blocking is enabled',
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
        autoPromotionEnabled: tier.autoPromotionEnabled,
        autoDemotionEnabled: tier.autoDemotionEnabled,
        retentionGraceDays: tier.retentionGraceDays,
        requestCooldownDays: tier.requestCooldownDays,
        benefits: tier.benefits.map((benefit) => ({
          code: benefit.code,
          name: benefit.name,
          displayValue: benefit.displayValue,
        })),
      })),
      managedBy: '/api/admin/elite-taskers/program',
      note: 'Elite requirements, lifecycle automation, badges, and benefits remain owned by the existing Elite Program API to avoid duplicate policy storage.',
    };
  }
}
