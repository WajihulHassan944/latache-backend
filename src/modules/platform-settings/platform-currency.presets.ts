import type { PlatformCurrencyContext, PlatformMarket } from './platform-settings.types';

export const STATIC_RATE_VERSION = '2026-08-static-v1';

export const PLATFORM_CURRENCY_PRESETS: Record<PlatformMarket, PlatformCurrencyContext> = {
  us: {
    market: 'us',
    country: 'United States',
    code: 'USD',
    name: 'US Dollar',
    symbol: '$',
    rateFromUsd: 1,
    staticRateVersion: STATIC_RATE_VERSION,
  },
  morocco: {
    market: 'morocco',
    country: 'Morocco',
    code: 'MAD',
    name: 'Moroccan Dirham',
    symbol: 'د.م.',
    rateFromUsd: 9,
    staticRateVersion: STATIC_RATE_VERSION,
  },
  pakistan: {
    market: 'pakistan',
    country: 'Pakistan',
    code: 'PKR',
    name: 'Pakistani Rupee',
    symbol: 'Rs',
    rateFromUsd: 280,
    staticRateVersion: STATIC_RATE_VERSION,
  },
  france: {
    market: 'france',
    country: 'France',
    code: 'EUR',
    name: 'Euro',
    symbol: '€',
    rateFromUsd: 0.86,
    staticRateVersion: STATIC_RATE_VERSION,
  },
  spain: {
    market: 'spain',
    country: 'Spain',
    code: 'EUR',
    name: 'Euro',
    symbol: '€',
    rateFromUsd: 0.86,
    staticRateVersion: STATIC_RATE_VERSION,
  },
};

export function resolvePlatformCurrencyContext(
  value: Record<string, unknown> | null | undefined,
): PlatformCurrencyContext {
  const requestedMarket = value?.primaryMarket;
  if (typeof requestedMarket === 'string' && requestedMarket in PLATFORM_CURRENCY_PRESETS) {
    return PLATFORM_CURRENCY_PRESETS[requestedMarket as PlatformMarket];
  }

  const requestedCurrency = String(value?.primaryCurrency ?? 'USD').toUpperCase();
  const fallback = Object.values(PLATFORM_CURRENCY_PRESETS).find(
    (preset) => preset.code === requestedCurrency,
  );
  return fallback ?? PLATFORM_CURRENCY_PRESETS.us;
}

export function roundPlatformMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function platformAmountToUsd(value: number, context: PlatformCurrencyContext): number {
  return roundPlatformMoney(value / context.rateFromUsd);
}

export function usdAmountToPlatform(value: number, context: PlatformCurrencyContext): number {
  return roundPlatformMoney(value * context.rateFromUsd);
}
