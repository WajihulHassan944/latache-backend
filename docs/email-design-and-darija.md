# Email design and Darija architecture (v3.17)

## Shared transactional email shell

Every current Nodemailer flow uses `src/modules/mail/email-layout.ts`. The shell owns the premium copper/cream design, responsive table structure, RTL direction, security panel, app callout, and footer. Individual TypeScript templates provide only escaped dynamic center content, subject, preheader, and plain-text alternative.

The logo is loaded from the requested canonical URL:

`https://latache-web.vercel.app/images/logo-full.svg`

The original generated header panorama, security shield, and dune footer are stored under `src/modules/mail/assets`. Nodemailer attaches them inline with stable content IDs, so they do not require a public asset host. Nest copies them into `dist/modules/mail/assets` for production builds. No standalone HTML, Handlebars, or EJS templates are used.

Current flows covered by the shell:

- account email verification OTP;
- password-reset OTP;
- administrator welcome/temporary credentials.

New mail flows should call `latacheEmailLayout`, add a typed center-content renderer, and retain both escaped HTML and a meaningful plain-text alternative.

## Moroccan Darija

Darija uses the standard `ary` locale code. Regional input such as `ary-MA` resolves to `ary`. Locale precedence remains saved user preference, supported `Accept-Language`, English default, then canonical resource fallback.

`ary` is supported by:

- unified registration and `PATCH /api/auth/me` preferred-language fields;
- Admin account creation;
- existing translation rows for Services, Service Options, Elite content, and public platform content;
- persisted/realtime backend notification templates;
- all transactional email subjects, HTML content, and text alternatives.

Darija and Arabic email documents are RTL. OTPs, email addresses, temporary passwords, money, and timestamps remain language-neutral/LTR data. Frontend applications remain responsible for UI strings, RTL layout, and localized number/date/currency presentation.

## Configuration and deployment

```env
SUPPORTED_LOCALES=en,ar,ary
DEFAULT_LOCALE=en
```

No Prisma migration is required. `preferredLanguage` is already a configurable BCP-47 string, and translated resources already use `(resourceId, locale)` rows. Existing records remain valid; Darija translations are created only when administrators submit real content.
