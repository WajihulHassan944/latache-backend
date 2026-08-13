# Multilingual backend architecture (v3.17)

Latache localizes dynamic, admin-managed, and backend-generated content. Ordinary UI labels and language-neutral domain codes remain frontend responsibilities. Money stays numeric/decimal, timestamps stay timestamps, and the backend does not perform RTL, date, number, or currency presentation.

## Locale resolution

The centralized `LocaleService` supports configured BCP-47 codes and resolves a request in this order:

1. authenticated user's persisted `preferredLanguage`;
2. best supported `Accept-Language` value (including quality weights and base tags such as `ar-MA` -> `ar` and `ary-MA` -> `ary`);
3. `DEFAULT_LOCALE` (`en` initially).

Resource lookup then uses requested translation -> English translation -> retained canonical value. Responses set `Content-Language` and `Vary: Accept-Language`; localized resources expose `resolvedLocale` and `translationFallback` where relevant. An unsupported `Accept-Language` is ignored and falls back; attempting to persist or manage an unsupported locale returns `400` with `code=UNSUPPORTED_LOCALE`.

A response-localization pass also localizes nested `service`, `services`, and `serviceOption` views in shared booking, dashboard, wallet, and Tasker resources with one batched database lookup. Administrator management responses are excluded so their canonical/all-translation payloads are not rewritten.

## Persistence design

`ServiceTranslations`, `ServiceOptionTranslations`, `EliteTierTranslations`, `EliteBenefitTranslations`, and `EliteBadgeTranslations` use a unique `(resourceId, locale)` key. Adding French later means enabling `fr` and adding rows; it does not add `nameFrench` columns or replace resource IDs.

Canonical fields remain as final fallback and compatibility data. The migration copies existing canonical values into `en` rows without inventing Arabic or Darija content. Existing Service, ServiceOption, Elite, Booking, and finance IDs are unchanged.

General public platform identity/description uses a validated locale-row array in the existing `general` Platform Setting. `GET /api/platform/content` exposes only those public values, not internal platform policy.

The existing Support category values are stable codes, not an administrator-managed customer-facing catalogue. Their UI labels remain frontend-localized. Support messages, reviews, disputes, evidence, chat, and notes are user-authored and are never machine-translated or overwritten.

## Catalogue management

The existing `services.manage` mutations accept optional `translations` and remain the only Service/ServiceOption write APIs. Canonical English is still required on create.

```json
{
  "name": "Home Cleaning",
  "description": "Professional home cleaning services.",
  "slug": "home-cleaning",
  "icon": "https://cdn.example.com/home-cleaning.webp",
  "translations": [
    {
      "locale": "ar",
      "name": "تنظيف المنزل",
      "description": "خدمات تنظيف منزلية احترافية."
    },
    {
      "locale": "ary",
      "name": "تنقية الدار",
      "description": "خدمات احترافية ديال تنقية الديور."
    }
  ]
}
```

`GET /api/admin/services` and `GET /api/admin/services/:serviceId` return all locale rows. Public `GET /api/services*` returns convenient localized `name`/`description` values in each item.

Elite management follows the same pattern through the existing `/api/admin/elite-taskers/program` tier, benefit, and badge requests. Admin program reads include all translations; `GET /api/tasker-dashboard/elite` returns localized values.

## Profile, notifications, and email

Use the existing unified profile mutation:

```http
PATCH /api/auth/me
Authorization: Bearer <token>
Content-Type: application/json

{ "preferredLanguage": "ary" }
```

Persisted notifications retain canonical-English compatibility `title`/`body` fallbacks and also store `templateKey`, structured `templateParams`, and `renderedLocale`. Known templates render in English, Modern Standard Arabic, or Moroccan Darija before realtime outbox enqueue and re-render on inbox reads; an unknown/missing translation safely uses canonical English. Notification type/category/entity codes remain language-neutral.

Verification OTP, password-reset OTP, and administrator welcome emails use the shared premium TypeScript shell with English, Arabic, and Darija subjects/text alternatives, escaped HTML, and RTL direction for `ar`/`ary`. Decorative art uses the supplied versioned Cloudinary URLs and the requested hosted Latache SVG is used as the logo, avoiding heavyweight SMTP attachments. No standalone HTML files are used. See `email-design-and-darija.md`.

## Search

Service translation rows store derived normalized search text while preserving original Unicode. Normalization applies NFKC, lowercasing, Arabic diacritic/tatweel removal, and common Alef/Yeh/Hamza variant folding. Service search checks requested and English fallback rows. Tasker discovery accepts `search` and checks Tasker name/bio plus canonical/localized assigned Service content. No heavyweight search service is required.

## Configuration

```env
SUPPORTED_LOCALES=en,ar,ary
DEFAULT_LOCALE=en
```

`DEFAULT_LOCALE` must be included in `SUPPORTED_LOCALES`. `ary` is the BCP-47/ISO language code used here for Moroccan Darija. Add any future locale to configuration before administrators can persist it.

## Migration

Existing installations apply `20260812190000_add_multilingual_architecture` with `npm run prisma:migrate:deploy`. It is additive and contains no reset or fake translations. v3.17 needs no additional migration because locale codes are strings and translation rows are locale-keyed.
