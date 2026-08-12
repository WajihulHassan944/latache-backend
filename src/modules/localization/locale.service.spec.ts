import { ConfigService } from '@nestjs/config';
import { LocaleService } from './locale.service';

describe('LocaleService', () => {
  const config = {
    get: jest.fn((key: string, fallback: unknown) => {
      if (key === 'localization.supportedLocales') return ['en', 'ar', 'ary'];
      if (key === 'localization.defaultLocale') return 'en';
      return fallback;
    }),
  } as unknown as ConfigService;
  const locales = new LocaleService(config);

  it('uses saved preference before Accept-Language', () => {
    expect(locales.resolve({ preferredLanguage: 'en', acceptLanguage: 'ar;q=1,en;q=0.5' })).toEqual(
      { locale: 'en', source: 'user' },
    );
  });

  it('parses Accept-Language and falls back to English for unsupported tags', () => {
    expect(locales.resolve({ acceptLanguage: 'fr;q=1, ar;q=0.8' }).locale).toBe('ar');
    expect(locales.resolve({ acceptLanguage: 'ary-MA, ar;q=0.8' }).locale).toBe('ary');
    expect(locales.resolve({ acceptLanguage: 'fr' }).locale).toBe('en');
  });

  it('returns Arabic and English fallback translations consistently', () => {
    const translations = [
      { locale: 'en', name: 'Cleaning', description: 'Home cleaning' },
      { locale: 'ar', name: 'تنظيف', description: 'تنظيف المنزل' },
    ];
    expect(locales.selectTranslation(translations, 'ar')).toMatchObject({
      resolvedLocale: 'ar',
      fallback: false,
      translation: { name: 'تنظيف' },
    });
    expect(locales.selectTranslation(translations.slice(0, 1), 'ar')).toMatchObject({
      resolvedLocale: 'en',
      fallback: true,
      translation: { name: 'Cleaning' },
    });
  });

  it('rejects unsupported persisted locales and normalizes Arabic search safely', () => {
    expect(() => locales.requireSupported('fr')).toThrow('Unsupported locale');
    expect(locales.requireSupported('ary-MA')).toBe('ary');
    expect(locales.normalizeSearchText('إِصْلَاحُ السَّيَّارَات')).toBe('اصلاح السيارات');
  });
});
