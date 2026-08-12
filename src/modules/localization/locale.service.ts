import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SupportedLocale, TranslationValue } from './localization.types';

export const normalizeSearchText = (value: string): string =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\u064b-\u065f\u0670\u06d6-\u06ed]/g, '')
    .replace(/\u0640/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();

@Injectable()
export class LocaleService {
  readonly supportedLocales: readonly SupportedLocale[];
  readonly defaultLocale: SupportedLocale;

  constructor(config: ConfigService) {
    this.supportedLocales = config.get<string[]>('localization.supportedLocales', [
      'en',
      'ar',
      'ary',
    ]);
    this.defaultLocale = config.get<string>('localization.defaultLocale', 'en');
  }

  normalize(value: string | null | undefined): string | undefined {
    const normalized = value?.trim().toLowerCase().replace('_', '-');
    if (!normalized) return undefined;
    if (this.supportedLocales.includes(normalized)) return normalized;
    const base = normalized.split('-')[0];
    return base && this.supportedLocales.includes(base) ? base : undefined;
  }

  requireSupported(value: string): SupportedLocale {
    const normalized = this.normalize(value);
    if (!normalized) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_LOCALE',
        message: `Unsupported locale. Supported locales: ${this.supportedLocales.join(', ')}`,
        supportedLocales: this.supportedLocales,
      });
    }
    return normalized;
  }

  resolve(params: { preferredLanguage?: string | null; acceptLanguage?: string | string[] }): {
    locale: SupportedLocale;
    source: 'user' | 'accept-language' | 'default';
  } {
    const preferred = this.normalize(params.preferredLanguage);
    if (preferred) return { locale: preferred, source: 'user' };

    const accepted = this.parseAcceptLanguage(params.acceptLanguage);
    if (accepted) return { locale: accepted, source: 'accept-language' };

    return { locale: this.defaultLocale, source: 'default' };
  }

  selectTranslation<T extends TranslationValue>(
    translations: readonly T[],
    requestedLocale: string,
  ): { translation?: T; resolvedLocale: string; fallback: boolean } {
    const requested = this.normalize(requestedLocale) ?? this.defaultLocale;
    const exact = translations.find((item) => item.locale === requested);
    if (exact) return { translation: exact, resolvedLocale: requested, fallback: false };
    const english = translations.find((item) => item.locale === this.defaultLocale);
    if (english) {
      return { translation: english, resolvedLocale: this.defaultLocale, fallback: true };
    }
    return { translation: translations[0], resolvedLocale: 'canonical', fallback: true };
  }

  normalizeSearchText(value: string): string {
    return normalizeSearchText(value);
  }

  private parseAcceptLanguage(value: string | string[] | undefined): SupportedLocale | undefined {
    const header = Array.isArray(value) ? value.join(',') : value;
    if (!header) return undefined;
    const candidates = header
      .split(',')
      .map((part, index) => {
        const [tag, ...parameters] = part.trim().split(';');
        const qualityParameter = parameters.find((parameter) => parameter.trim().startsWith('q='));
        const quality = qualityParameter ? Number.parseFloat(qualityParameter.trim().slice(2)) : 1;
        return { tag, quality: Number.isFinite(quality) ? quality : 0, index };
      })
      .filter((candidate) => candidate.tag !== '*' && candidate.quality > 0)
      .sort((left, right) => right.quality - left.quality || left.index - right.index);

    for (const candidate of candidates) {
      const locale = this.normalize(candidate.tag);
      if (locale) return locale;
    }
    return undefined;
  }
}
