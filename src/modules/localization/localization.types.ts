export type SupportedLocale = string;

export interface LocalizedRequest {
  locale?: SupportedLocale;
  localeSource?: 'user' | 'accept-language' | 'default';
}

export interface TranslationInput {
  locale: string;
  name: string;
  description?: string | null;
}

export interface TranslationValue {
  locale: string;
  name: string;
  description: string | null;
}
