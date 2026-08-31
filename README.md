# v3.33.0

FCM push notification support is included. See `docs/fcm-push-notifications.md` for server and client setup.

# v3.30.0

Content management and customer discovery completion update.

## v3.28.2 Railway CORS / Swagger

## v3.29.0 verified on-site work flow

New bookings use this authoritative service flow:

```text
Tasker starts navigation -> marks arrival
-> uploads Latache-managed front-door image
-> POST /api/bookings/:bookingId/work/proofs/front-door
-> Customer POST /api/bookings/:bookingId/work/start-code
-> Tasker POST /api/bookings/:bookingId/work/start with the six-digit OTP
-> timer starts; pause/resume/extension remain persisted
-> when work is done, Tasker uploads the completed-work image
-> POST /api/bookings/:bookingId/work/proofs/completion freezes the billable timer
-> Customer POST /api/bookings/:bookingId/work/completion-code
-> Tasker POST /api/bookings/:bookingId/work/finish with the OTP
-> booking completes -> final Stripe/wallet/cash orchestration follows the existing authoritative finance flow
```

The authenticated Customer may call the existing `POST /api/bookings/:bookingId/complete` as the exceptional fallback after the completed-work proof exists. For verification-required bookings, final payment is blocked until front-door/start verification and either completion OTP verification or Customer fallback completion is recorded. Online Tasker earnings are still pending for the configured clearance period after real settlement; physical cash never becomes platform-held wallet money.

Work images are uploaded first through the existing managed Cloudinary upload API using `booking-attachments`; the proof endpoints persist only provider-verified Latache assets. Persisted work-proof images are immutable and cannot be independently deleted.

Optional settings:

```env
BOOKING_WORK_OTP_TTL_MINUTES=15
BOOKING_WORK_OTP_MAX_ATTEMPTS=5
```

Customer Management list filters additionally accept `phone`, `location`, `from`, and `to`. `GET /api/payments/wallet` now includes the Customer's real saved Stripe cards/default card plus `attachCardEndpoint: /api/payments/setup-intent`.


The backend always accepts browser requests from `https://latache-web.vercel.app`, `https://latache-be-production.up.railway.app`, and `http://localhost:3000`. Values supplied through `CORS_ORIGINS` are added to that set. Swagger uses the current browser host as its default OpenAPI server, so production `Try it out` requests stay on the Railway HTTPS domain even when `APP_BASE_URL` is stale or absent.

# Latache Backend — NestJS, Prisma and Nodemailer

Latache backend implemented with NestJS 11, strict TypeScript, Prisma/PostgreSQL, Nodemailer SMTP, Cloudinary uploads, and database-backed RBAC.

### v3.28.1 Railway SMTP/networking hotfix

- Node now prefers IPv4 before NestJS initializes, covering both the API and `SERVICE_MODE=worker`. This avoids intermittent Gmail SMTP `ENETUNREACH` failures caused by an unreachable IPv6 result on hosts without working outbound IPv6.
- On Railway, `APP_BASE_URL` is optional when a public domain exists: the backend automatically uses `https://${RAILWAY_PUBLIC_DOMAIN}`. An explicit `APP_BASE_URL` still overrides the Railway-derived value.
- `SMTP_VERIFY_ON_BOOTSTRAP=true` no longer makes a transient SMTP outage fatal by default. Set `SMTP_VERIFY_ON_BOOTSTRAP_FATAL=true` only when deployment should fail if SMTP verification fails. Actual email sends remain fail-closed and return the existing controlled service-unavailable behavior when SMTP is unreachable.
- No build, lint, Jest, E2E or Prisma validation/generation was run for this release at the requester’s instruction.


### v3.28.0 authentication audit and hardening

- Local login now has PostgreSQL-backed failed-attempt tracking and temporary lockout, making the protection consistent across multiple API instances. Defaults: `AUTH_MAX_FAILED_LOGIN_ATTEMPTS=5`, `AUTH_LOGIN_LOCK_MINUTES=15`.
- Admin/Super Admin access tokens must use `JWT_SECRET_ADMIN`; marketplace access tokens use `JWT_SECRET`. Temporary Admin passwords are enforced by the Admin guard until `PATCH /api/auth/change-password` succeeds.
- Social-only users can enable a local credential with `POST /api/auth/set-password`. Provider unlinking cannot remove the last usable sign-in method and now revokes existing sessions after a provider is disconnected.
- Google/Apple OIDC verification checks RS256 signing-key metadata, issuer, audience, multi-audience authorized party (`azp`), expiry, issue time, not-before time, and an expected nonce when supplied. Expired JWKS cache entries are not accepted when provider key refresh fails.
- Local registration and social identity creation share a normalized-email transaction lock. Provider linking is also serialized per provider/User to avoid concurrent duplicate mappings.
- Dedicated Customer/Tasker operational APIs require an active role profile. Pending/rejected Tasker identities can still authenticate and inspect onboarding/status, but cannot use operational Tasker resources until approval activates the profile.
- Additive migration: `20260820150000_authentication_hardening`.
- No build, lint, Jest, E2E or Prisma validation/generation was run for this release at the requester’s instruction.

### v3.27.0 Google and Apple authentication

- Added server-verified Google and Sign in with Apple signup/login using provider ID tokens, rotating JWKS signature verification, issuer/audience/expiry validation, and optional nonce matching.
- Provider identities are mapped by immutable provider subject to the existing single Latache User, so social login remains consistent with Customer/Tasker multi-role identities.
- New social users are email-verified by the provider and start with Customer access. If Tasker access is requested but not yet enabled, the response returns the existing `POST /api/auth/roles/tasker` onboarding as the next action.
- Existing accounts may safely link/unlink Google or Apple. Unlinking the last usable authentication method is blocked. Authenticated linking supports Apple private-relay cases without guessing identity from email.
- Google automatic email linking is restricted to authoritative Gmail/Google Workspace identities; other Google emails must be linked from an authenticated Latache account.
- Configuration: `GOOGLE_AUTH_CLIENT_IDS` and `APPLE_AUTH_CLIENT_IDS` are comma-separated accepted OAuth/OIDC audiences. Optional `SOCIAL_AUTH_JWKS_CACHE_SECONDS` and `SOCIAL_AUTH_CLOCK_SKEW_SECONDS` tune verification caching/skew.
- Additive migration: `20260820143000_google_apple_social_auth`. No provider access/refresh tokens or client secrets are stored by this login-only integration.
- Build, lint, Jest, E2E and Prisma validation/generation were not run at the requester’s instruction.

### v3.26.2 TypeScript source hotfix

- Corrected the reported strict-TypeScript source issues in participant dispute Prisma payload typing, dispute evidence byte aggregation and Elite multi-currency earnings/metrics handling.
- No API route, Prisma schema, migration, environment variable or business-flow change was introduced by this hotfix.
- Build, lint, Jest, E2E and Prisma validation/generation were not run for this release at the requester’s instruction.

### v3.26.0 multi-role marketplace identity

- One verified `User` remains the canonical email/password identity while marketplace access is represented by `roles[]` plus separate `CustomerProfile` and `TaskerProfile` records.
- Existing Customers can add Tasker capability on the same identity; existing Taskers can add Customer capability without creating a duplicate email/account.
- Login accepts an optional active role and returns available roles; dual-role identities can switch Customer/Tasker context using a dedicated authenticated role-switch endpoint. Sessions/refresh tokens are role-scoped.
- Customer and Tasker profile lifecycle, moderation, ratings, dispute discipline, notifications, support context and Admin views are role/profile-scoped so one marketplace role does not incorrectly suspend or contaminate the other.
- Bookings, conversations, unread state, realtime rooms and WebRTC authorization respect the active booking role; self-booking is rejected even when the same identity owns both profiles.
- Customer wallet and Tasker earnings/payout accounting remain separate financial domains under the same User identity.
- Referral attribution is scoped by referral program so a dual-role identity can participate once as a Customer and once as a Tasker while self-referral remains blocked.
- Existing users are migrated additively into role membership and matching profile rows by `20260819130000_multi_role_identity_profiles`.
- Build, lint, Jest, E2E and Prisma validation/generation were not run for this release at the requester’s instruction.

### v3.25.0 Super Admin referral/reward and Elite perk policy

- Referral/Rewards commercial values are managed only by Super Admin through the existing `referral` section of `PUT /api/admin/platform-settings`; the policy remains snapshotted on each new attribution.
- Elite tier rules and perk assignment are Super-Admin-only. Operational Admin membership review remains on the existing Elite APIs.
- Supported enforceable perks are backend-defined: profile badge visibility, default discovery priority, and tier-specific commission/minimum-task-price policy. Removing an active perk assignment stops its backend effect.
- `GET /api/admin/elite-taskers/program/perk-catalog` returns the supported perk catalog; `PUT /api/admin/elite-taskers/program/tiers/:tierCode/benefits` assigns the supported perks to a tier.
- Public Tasker responses expose active Elite entitlement state, and booking quotes disclose whether the Elite commission perk was actually applied.

### v3.24.0 dispute, referral/reward and chat flow audit

- Dispute settlement proposals now expire automatically when their configured participant-response deadline elapses. Participant withdrawal also cancels any still-proposed settlement so closed cases do not expose stale actionable proposals.
- Repeated participant/Admin dispute evidence submissions are de-duplicated by verified Cloudinary `publicId` under the locked dispute and do not consume evidence caps or fulfill requests unless genuinely new evidence is persisted.
- Referral reward clearance is blocked by both internal active disputes and Stripe provider chargebacks. A verified Stripe chargeback loss uses the existing referral revocation and immutable wallet reversal flow.
- Booking cancellation defensively releases any pending referred-Customer discount reservation so the one-time benefit can remain usable on a later eligible booking.
- The existing Chat/Support implementation required no new routes: Customer–Tasker private booking chat, participant–Admin support, Admin internal notes, verified attachments, unread/read state, retry-safe writes, durable realtime events and Customer–Tasker WebRTC signaling remain the canonical flows.

### v3.23.0 Tasker levels, service-rate limits and platform currency

- Gold, Platinum and Diamond now have a full lifecycle engine: eligibility checks, request cooldowns, Admin approval revalidation, scheduled promotion, retention grace, demotion/recovery, evaluation history, automatic badges, notifications and audit records.
- Built-in defaults apply only when a tier had no requirements: Gold `4.5 / 20 tasks / 90% / 0 active disputes`, Platinum `4.7 / 75 / 94% / 0`, Diamond `4.85 / 200 / 97% / 0`. Admin-managed requirements remain authoritative.
- Enforced perks are limited to real backend behavior: Elite/tier badge visibility, rank-based default discovery priority, and tier-specific commission/minimum-task-price rules. No unsupported consumable benefit is fabricated.
- `POST /api/services` now requires `minimumHourlyRate` and `maximumHourlyRate`. Tasker onboarding and profile skill rates must stay inside those limits. Existing services migrate conservatively to USD 1–10,000 bounds until Admin adjusts them.
- Service and Tasker catalogue prices are canonically stored in USD and presented/accepted in the selected platform currency. New booking snapshots store the selected operational ISO currency; settled historical rows are never rewritten.
- Super Admin selects one operational market through `PUT /api/admin/platform-settings` using `currency.primaryMarket`: `us`, `morocco`, `pakistan`, `france`, or `spain`. Static presets are USD `$` ×1, MAD `د.م.` ×9, PKR `Rs` ×280, and EUR `€` ×0.86 per USD. France and Spain both use EUR. These are application presets, **not live FX**.
- A cross-ISO currency switch is rejected until active/unsettled financial positions are cleared. Actual Stripe support/settlement for the selected currency must still be verified against the configured Stripe account.
- Elite maintenance is run by the existing job infrastructure. Defaults: `ELITE_WORKER_POLL_MS=21600000` (6 hours) and `ELITE_WORKER_BATCH_SIZE=200`.

Example currency update (Super Admin only):

```json
{
  "currency": {
    "primaryMarket": "morocco"
  }
}
```

### v3.22.0 dispute lifecycle hardening

- Dispute creation is booking-row locked, idempotent, filing-window constrained and database-protected against multiple new active cases.
- Reopen/appeal reapply finance holds; participant withdrawal, settlement responses, comments, appeals and persisted satisfaction are available on the same dispute resource.
- Evidence is Cloudinary-provider verified, deletion-protected and subject to case-wide caps; BullMQ handles reminders, overdue/expiry escalation, SLA escalation and durable dispute email retries.
- Workload-based Admin assignment, participant notifications, en/ar/ary dispute emails, warning strikes/disciplinary state and optional configured auto-suspension are included.
- Confirmed physical-cash refunds use an auditable manual-transfer obligation and accounting reversal rather than fabricated provider execution. Stripe `charge.dispute.*` webhooks are tracked separately and block Tasker finance while active/lost.

See [Dispute lifecycle hardening](docs/dispute-lifecycle-hardening.md).

### v3.21.1 Postman/OpenAPI compatibility hotfix

- Corrected the translated General Settings array schema so OpenAPI validators and Postman's API importer receive a concrete `items` model.
- Added the configured `APP_BASE_URL` as the OpenAPI server origin, keeping imported Postman requests portable across local, staging, and production environments.
- Added a ready-to-import Postman Collection v2.1 snapshot and local environment under `postman/`.

See [Postman setup](docs/postman.md).

### v3.21.0 production referral qualification and rewards

- Stable same-role Customer and Tasker referral codes with one locked attribution per referred account; self-referral, role crossing, cap exhaustion, and post-settlement claims are rejected.
- Referral policy/currency is snapshotted at claim time. Programs remain disabled until Admin supplies real benefits and explicitly enables them.
- Only a real settled Stripe/customer-wallet booking qualifies. Cash bookings do not create wallet funds or referral rewards.
- Referred-Customer discounts preserve configured real-charge/qualification floors. Fixed rewards remain pending through a configurable clearance window and active disputes block release.
- Refunds and Admin fraud revocation cancel pending rewards or create immutable wallet clawbacks; Admin actions require `finance.manage` and are audit-logged.
- Participant/Admin APIs, privacy-limited leaderboards, `en/ar/ary` notifications, transactional `referral:updated` events, and BullMQ expiry/release maintenance are included.

See [Production referral reward system](docs/production-referral-reward-system.md).

### v3.20.0 production chat completion

- Private Customer–Tasker booking chat remains participant-only and now has retry-safe `clientMessageId` writes, total unread counts, bounded read receipts, and last-message activity ordering.
- Customer and Tasker support tickets share one persisted conversation resource with cursor/page history, unread counts, bounded read receipts, retry-safe ticket/message writes, and attachment-only replies.
- Admin and Super Admin support public replies and internal notes are isolated by RBAC and separate realtime rooms. Internal activity is never delivered to the participant room.
- Booking and support attachment references are verified against Cloudinary resource/context metadata before persistence. Referenced assets cannot be independently deleted from immutable chat history.
- Notifications, domain writes, and durable realtime events commit atomically; Socket.IO delivery remains at-least-once and reconnects use REST/PostgreSQL as authority.
- WebRTC voice/video remains Customer–Tasker only, with NestJS providing authenticated signaling and persisted call lifecycle—not media transport or recording.

See [Production chat system](docs/production-chat-system.md) and [Realtime contract](docs/realtime.md).

### v3.19.0 completion approval and authentication hardening

- Tasker completion now enters `awaiting_customer_approval`; it does not charge the customer or create an earning.
- Customer approval finalizes the booking/payment immediately. An undisputed submission auto-approves after a configurable 24-hour default through the multi-instance-safe BullMQ worker.
- PostgreSQL row locks and terminal-state checks prevent duplicate completion, counters, payment finalization, or notifications. An active dispute blocks auto-approval.
- Customer, Tasker, and Admin booking responses expose the same submission, due, approval, actor, and auto-approval timestamps.
- New verification/reset codes are stored as keyed hashes; the short migration transition still accepts an already-issued legacy code, and serializers exclude both hash fields.
- Production startup requires Redis-backed jobs/scheduling, and production seed runs reject development Super Admin credentials without silently resetting an existing password.
- The shared email header logo and security shield use explicit `<center>` markup. The app-download section has been removed from every email.

See [Booking completion approval](docs/booking-completion-approval.md) and [Production readiness](docs/production-readiness.md).

### v3.18.0 permanent deletion and email layout update

Authorized administrators now have explicit irreversible Customer/Tasker/Admin deletion controls. Protected booking, provider, ledger, payout, dispute, review and shared conversation history returns a detailed `409 ACCOUNT_PURGE_BLOCKED` instead of being silently destroyed. Eligible database rows are hard-deleted and Latache-managed Cloudinary assets use a durable PostgreSQL deletion outbox with BullMQ retries. See [Permanent deletion](docs/permanent-deletion.md).

The shared email shield now uses email-client-safe centering, and the hosted dunes image is the direct footer background behind social/copyright content with no solid footer fill.

### v3.17.2 email delivery hotfix

The shared email design now references the supplied Cloudinary header, shield, and footer assets instead of attaching roughly 4.6 MB of source PNGs to every SMTP message. Registration no longer spends tens of seconds uploading decorative artwork. Nodemailer results are checked to ensure the requested recipient was actually accepted, and a safe `smtp_delivery_accepted` log records only the recipient domain, message ID, and response code. Configurable SMTP timeouts bound provider/network stalls.

### v3.17.1 email asset and Swagger connectivity hotfix

The production TypeScript build is rooted at `src`, so Nest emits the canonical `dist/main.js` expected by the existing package/Docker start commands. `npm run build` first removes only the generated `dist` directory so stale `dist/src` output cannot survive an upgrade. Version 3.17.2 subsequently removed the filesystem mail-asset dependency entirely by using hosted artwork. CORS origins are normalized, the `APP_BASE_URL` origin is allowed for Swagger, and the seeded Super Admin example is documented as literal JSON without Markdown escaping.

## v3.17 email design and Darija

- Every current transactional email uses one responsive TypeScript layout matching the supplied copper/cream desert design; only the center content changes per mail.
- Header, shield, and footer artwork uses the supplied Cloudinary URLs, so SMTP sends no heavyweight image attachments. The canonical header logo uses `https://latache-web.vercel.app/images/logo-full.svg`.
- Verification OTP, password-reset OTP, and administrator welcome mail have escaped dynamic HTML, plain-text alternatives, and localized subjects.
- Moroccan Darija uses `ary`; `ary-MA` resolves to it. User preference, `Accept-Language`, Admin translation management, notifications, and email all support it.
- English remains the default/canonical fallback. No Prisma migration is required because locale persistence was already extensible.

See `docs/email-design-and-darija.md` and `docs/multilingual-architecture.md`.

## v3.16 performance and Railway scaling

- Redis is used for disposable versioned caches, BullMQ transport, Socket.IO pub/sub, and cross-replica location-write coalescing; PostgreSQL remains authoritative.
- Localized Services/Options, Platform Settings content, Elite configuration, and short-lived Admin aggregates are cached with mutation-driven namespace invalidation and DB fallback.
- A separate `SERVICE_MODE=worker` BullMQ process runs retry-safe earning release, stale-call cleanup, and bounded dispatched-outbox retention jobs.
- Socket.IO rooms work across API replicas without changing Customer/Tasker conversation or Admin monitoring privacy boundaries.
- High-growth notification, conversation-message, and Tasker-wallet list APIs add compatible cursor pagination.
- Additive indexes cover cursor reads, Admin filters/aggregates, outbox cleanup, and normalized English/Arabic contains-search.
- `/api/health` now includes PostgreSQL, Redis, queues/workers, outbox backlog, cache counters, and baseline metrics.

See `docs/performance-architecture.md` for Railway API/worker topology and environment configuration.

## v3.15+ English, Arabic, and Darija dynamic content

- Central locale resolution: saved user preference, then `Accept-Language`, then English.
- Related locale rows for Services, Service Options, Elite tiers, benefits, and badges; no language-specific columns or duplicate resources.
- Safe migration of existing canonical catalogue values into English translation rows; no fake Arabic content.
- Unicode/Arabic-normalized Service and Tasker catalogue search without altering original text.
- Persisted template key/parameters for localized notification REST/realtime rendering.
- English/Arabic/Darija TypeScript email content for verification, password reset, and administrator welcome, wrapped by the v3.17 shared design.
- Existing `PATCH /api/auth/me` persists `preferredLanguage`; existing Admin/RBAC management routes own translation changes.

See `docs/multilingual-architecture.md`.

## v3.14 Tasker earning clearance and cash accounting

- Online/card settlement creates one immutable `PENDING` Tasker earning and increments only pending wallet balance.
- The default 14-day clearance is configurable. A PostgreSQL-locking worker releases mature, undisputed earnings once, safely across Railway API replicas.
- Refunds consume unreleased pending liability first; only an already released remainder uses the existing available/negative-balance clawback.
- Cash confirmation records money as physically held by the Tasker and creates a platform receivable/Tasker payable. It never credits a cash earning to the platform wallet.
- Mature online earnings settle the oldest outstanding cash payables before any remainder becomes withdrawable.
- Tasker wallet and Admin Finance read the same earning, receivable, and ledger records. Finance hold actions are audited and generate persisted realtime notifications.

Upgrade without reseeding or resetting the database:

```bash
npm install
npm run prisma:generate
npm run prisma:validate
npm run prisma:migrate:deploy
npm run build
npm run start:dev
```

See `docs/tasker-earnings-clearance-cash-accounting.md`.

## v3.13 conversation attachments and WebRTC calls

- Reuses the shared Cloudinary upload APIs for single or multiple conversation documents through `folder=conversation-attachments`.
- Supports JPEG, PNG, WEBP, PDF, TXT, CSV, RTF, DOC/DOCX, XLS/XLSX, and PPT/PPTX with configurable per-file, count, and total-message limits.
- Verifies Cloudinary ownership, resource type, size, MIME type, folder, and duplicate references before persisting a message.
- Adds `GET /api/conversations/capabilities`, `GET /api/conversations/:bookingId/calls`, and `GET /api/conversations/:bookingId/calls/:callId`.
- Adds authenticated Socket.IO/WebRTC signaling for one-to-one voice and video calls between the Customer and Tasker assigned to an eligible booking.
- Persists call lifecycle/history but never records or proxies media; SDP/ICE/media-state signaling remains transient.
- Supports STUN plus either coturn-compatible HMAC TURN credentials or static TURN credentials.

See `docs/chat-attachments-calls.md` and `docs/realtime.md`.

## v3.13 chat documents, voice calls and video calls

- Upload one or multiple chat files through the shared Cloudinary endpoints using `folder=conversation-attachments`.
- Send the verified attachment references through `POST /api/conversations/:bookingId/messages`.
- Discover active limits and supported MIME types through `GET /api/conversations/capabilities`.
- Read persisted call history through `GET /api/conversations/:bookingId/calls` and `GET /api/conversations/:bookingId/calls/:callId`.
- Use the existing Socket.IO namespace `/realtime` for `call:initiate`, `call:accept`, `call:reject`, `call:cancel`, `call:end`, `call:offer`, `call:answer`, `call:ice_candidate`, and `call:media_state`.
- Audio/video media is peer-to-peer WebRTC; the NestJS API handles authenticated signaling and lifecycle state but does not record or proxy media.
- Production/staging requires a TURN relay when calls are enabled. See `docs/conversation-attachments-calls.md` and `docs/realtime.md`.

Upgrade from v3.12 without reseeding:

```powershell
npm install
npm run prisma:generate
npm run prisma:validate
npm run prisma:migrate:deploy
npm run build
npm run start:dev
```

## v3.12 API consistency & realtime

- Canonical Services: `GET/POST /api/services`, `GET /api/services/:serviceId`, nested service options managed with `services.manage`.
- Canonical participant disputes: `GET /api/disputes`, `GET /api/disputes/:disputeId`, `POST /api/bookings/:bookingId/disputes`, `POST /api/disputes/:disputeId/evidence`.
- Realtime contract discovery: `GET /api/realtime/session`; Socket.IO namespace `/realtime`.
- Realtime pushes committed notifications, booking messages/read receipts, support chat/status, booking lifecycle, timer and Tasker location.
- Admin review moderation: `GET /api/admin/reviews`, `PATCH /api/admin/reviews/:reviewId/moderation`.
- Private Customer↔Tasker chat is isolated from admin booking-monitoring rooms.

See `docs/api-consistency-audit.md` and `docs/realtime.md`.

## v3.11 Service Management & Support Center

This release adds persisted Customer/Tasker Support tickets/live chat plus a permission-aware Admin Support Center, and consolidates Service Management around the existing Service/ServiceOption/UserService domain. Pricing remains owned by Platform Settings/Elite Program; Support Center never fabricates refunds or payouts. See `docs/admin-services-support.md`.

Key read APIs:

- `GET /api/admin/services?view=catalog|pricing`
- `GET /api/admin/services/:serviceId`
- `GET /api/admin/support?view=support_tickets|customer_issues|tasker_issues|escalated|live_chat|reports`
- `GET /api/support/tickets` (Customer/Tasker role-aware)

## Requirements

- Node.js 22.12+
- npm 10+
- PostgreSQL 14+ or Neon PostgreSQL
- SMTP credentials, or Mailpit for local development

## Install and run

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:seed
npm run start:dev
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
npm install
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:seed
npm run start:dev
```

Endpoints:

- API: `http://localhost:8080/api`
- Swagger UI: `http://localhost:8080/api/docs`
- OpenAPI JSON: `http://localhost:8080/api/docs-json`
- Health: `GET http://localhost:8080/api/health`

Swagger is enabled when `SWAGGER_ENABLED=true`.

Swagger requests use the API origin declared by `APP_BASE_URL`, which the server permits automatically. Add only separate browser frontend origins to `CORS_ORIGINS` (comma-separated). Login JSON must contain raw values; Markdown `mailto:` notation and backslash escapes copied from formatted chat text are not credentials.

## Required environment configuration

```env
DATABASE_URL=postgresql://latache:latache@localhost:5432/latache?schema=public
JWT_SECRET=<random-secret-at-least-32-characters>
JWT_SECRET_ADMIN=<different-random-secret-at-least-32-characters>
CORS_ORIGINS=http://localhost:3000
SEO_PUBLIC_BASE_URL=http://localhost:3000
SUPPORTED_LOCALES=en,ar,ary
DEFAULT_LOCALE=en
REALTIME_ENABLED=true
REALTIME_OUTBOX_POLL_MS=500
REALTIME_OUTBOX_BATCH_SIZE=100
REALTIME_SESSION_SWEEP_MS=30000

SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=Latache <no-reply@latache.local>
SMTP_CONNECTION_TIMEOUT_MS=10000
SMTP_GREETING_TIMEOUT_MS=10000
SMTP_SOCKET_TIMEOUT_MS=30000

OTP_EXPIRES_IN_MINUTES=5
PASSWORD_RESET_OTP_EXPIRES_IN_MINUTES=15

CHAT_ATTACHMENT_MAX_FILES=5
CHAT_ATTACHMENT_MAX_FILE_SIZE_BYTES=10485760
CHAT_ATTACHMENT_MAX_TOTAL_SIZE_BYTES=26214400
CHAT_CALLS_ENABLED=true
CHAT_CALL_RING_TIMEOUT_SECONDS=45
CHAT_CALL_MAX_DURATION_SECONDS=14400
CHAT_CALL_ALLOWED_BOOKING_STATUSES=confirmed,en_route,arrived,in_progress
WEBRTC_STUN_URLS=
WEBRTC_TURN_URLS=
WEBRTC_TURN_SHARED_SECRET=
WEBRTC_TURN_USERNAME=
WEBRTC_TURN_CREDENTIAL=
```

Use `SMTP_SECURE=true` for implicit TLS on port 465. Use `SMTP_SECURE=false` for port 587 so Nodemailer can negotiate STARTTLS.

## Neon PostgreSQL

Keep Neon credentials only in `.env` or the deployment secret manager:

```env
DATABASE_URL=postgresql://neondb_owner:YOUR_PASSWORD@YOUR_NEON_HOST/neondb?sslmode=verify-full
```

For a pooled runtime connection, set the direct migration connection separately:

```env
DATABASE_URL=postgresql://USER:PASSWORD@YOUR_POOLER_HOST/neondb?sslmode=verify-full
DIRECT_URL=postgresql://USER:PASSWORD@YOUR_DIRECT_HOST/neondb?sslmode=verify-full
```

`prisma.config.ts` prefers `DIRECT_URL` for CLI migrations and otherwise uses `DATABASE_URL`.

## Gmail SMTP

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_CONNECTION_TIMEOUT_MS=10000
SMTP_GREETING_TIMEOUT_MS=10000
SMTP_SOCKET_TIMEOUT_MS=30000
SMTP_USER=your-account@gmail.com
SMTP_PASSWORD=your-google-app-password
SMTP_FROM=Latache <your-account@gmail.com>
SMTP_VERIFY_ON_BOOTSTRAP=true
```

Use a Google App Password rather than the normal Gmail password.

### Upgrade to v3.10 Payments, Finance & Platform Settings

If v3.9 is already deployed, apply the additive migration and restart. No reseed is required.

```powershell
npm run prisma:generate
npm run prisma:validate
npm run prisma:migrate:deploy
npm run build
npm run start:dev
```

New admin surfaces:

- `GET /api/admin/finance?view=overview|transactions|refunds|payouts|revenue`
- `POST /api/admin/finance/payouts/:id/actions`
- `GET /api/admin/platform-settings`
- `PUT /api/admin/platform-settings`

See `docs/admin-finance-platform-settings.md` for the policy/runtime boundaries.

### Upgrade to v3.9 Booking & Dispute Management

If v3.8 is already deployed, apply the additive dispute-management migration and restart. No reseed is required.

```bash
npm install
npm run prisma:generate
npm run prisma:validate
npm run prisma:migrate:deploy
npm run build
npm run start:dev
```

The release adds unified admin booking/dispute APIs, normalized evidence requests, persistent resolution history, real Stripe/customer-wallet refunds, conditional `finance.manage` authorization for refunds, and participant evidence submission through the existing Cloudinary upload flow. It does not seed complaints, evidence, refunds, warnings or resolution history.

See `docs/admin-bookings-disputes.md`.

### Upgrade to v3.8 Elite Tasker Program

If v3.7 is already deployed, apply the additive Elite Program migration and restart. No reseed is required.

```bash
npm install
npm run prisma:generate
npm run prisma:validate
npm run prisma:migrate:deploy
npm run build
npm run start:dev
```

The migration creates the tier/request/transition/benefit/badge program tables, adds the Elite tier relation to Taskers, and extends existing RBAC roles with `elite.read` / `elite.manage`. It does not seed fake members, requests, scores, benefits, badges, earnings or history.

See `docs/elite-tasker-program.md` for the consolidated API design.

### Upgrade to v3.7 administrator dashboard

If v3.6.1 is already deployed, apply the additive admin-dashboard migration and restart. No reseed is required.

```bash
npm install
npm run prisma:generate
npm run prisma:validate
npm run prisma:migrate:deploy
npm run build
npm run start:dev
```

The new migration creates only `AdminAuditLogs`; it does not rewrite Customer, Tasker, booking, payment, wallet, Auth, or RBAC data.

### Upgrade from v3.5 Tasker dashboard

If your database already has the v3.5 Tasker dashboard migration, this release needs only the new additive Customer/Stripe migration. Do **not** reseed merely for v3.6.

```bash
npm install
npm run prisma:generate
npm run prisma:validate
npm run prisma:migrate:deploy
npm run build
npm run start:dev
```

Configure Stripe first if customer card/payment endpoints should be active. Keeping `STRIPE_ENABLED=false` leaves those provider-backed endpoints unavailable rather than simulating payment success.

## Existing Latache database

Never run `prisma migrate reset` on an existing database. Take a verified backup first.

When the old schema already exists but the Prisma baseline has not been recorded:

```bash
npm run prisma:generate
npx prisma migrate resolve --applied 20260805000000_baseline
npm run prisma:migrate:status
npm run prisma:migrate:deploy
npm run prisma:seed
npm run start:dev
```

The additive `20260805002000_revamp_auth_module` migration adds auth governance, OTP-attempt, consent, session metadata and administrator fields. `20260805003000_add_rbac_model` creates persistent RBAC roles, adds the user-role relation and permission inheritance flag, and backfills existing administrators. Neither migration recreates existing domain tables. The additive `20260807010000_add_tasker_dashboard` migration adds Tasker dashboard state, work sessions, location, messaging, notifications, reviews, wallet ledger, payout methods and withdrawal records without seeding fake dashboard or financial rows. The additive `20260807020000_add_customer_dashboard_and_stripe` migration adds customer favorites, customer wallet/payment state, Stripe references, service sub-options and customer booking billing fields. The additive `20260808090000_add_admin_dashboard_foundation` migration adds only the administrative audit trail used by moderation and activity feeds. The additive `20260810070000_add_elite_tasker_program` migration adds tiered Elite membership, request/transition history, configurable benefits/badges and Elite RBAC permissions while conservatively mapping pre-tier `isElite` Taskers to Gold. The additive `20260810130000_add_booking_dispute_management` migration extends real complaint records with admin workflow state and adds normalized evidence, evidence-request and resolution history. The additive `20260810173000_add_finance_platform_settings` migration adds platform-policy persistence, booking tax/commission audit fields, and payout-review metadata. None of these migrations seeds fake financial or dashboard activity.

## Canonical auth API

Only the following auth routes are exposed:

| Method | Route                                 | Access                                                               |
| ------ | ------------------------------------- | -------------------------------------------------------------------- |
| POST   | `/api/auth/customers/register`        | Public                                                               |
| POST   | `/api/auth/taskers/register`          | Public                                                               |
| POST   | `/api/auth/admins/register`           | `admins.create` or super admin; delegated creation is non-escalating |
| POST   | `/api/auth/login`                     | Public                                                               |
| POST   | `/api/auth/refresh`                   | Public with refresh token                                            |
| POST   | `/api/auth/verify-email`              | Registration bearer session                                          |
| POST   | `/api/auth/resend-verification-email` | Public                                                               |
| POST   | `/api/auth/forgot-password`           | Public                                                               |
| POST   | `/api/auth/verify-reset-otp`          | Public                                                               |
| POST   | `/api/auth/reset-password`            | Public                                                               |
| PATCH  | `/api/auth/change-password`           | Verified bearer session                                              |
| GET    | `/api/auth/me`                        | Verified bearer session                                              |
| PATCH  | `/api/auth/me`                        | Verified bearer session                                              |
| GET    | `/api/auth/sessions`                  | Verified bearer session                                              |
| DELETE | `/api/auth/sessions/:id`              | Verified bearer session                                              |
| POST   | `/api/auth/logout`                    | Verified bearer session                                              |
| POST   | `/api/auth/sessions/logout-all`       | Verified bearer session                                              |

Old aliases such as `sign-up`, `refresh-token`, `verify-otp`, `resend-otp`, `verify-pass-token`, `verify-forgot-password`, `get-loggedin-user`, `verify-token`, and `logout-all` are intentionally not registered.

## Role model

- `super_admin`: seeded canonical platform owner with immutable full access.
- `admin`: linked to a persistent RBAC role; creation requires `admins.create` and delegated creation cannot exceed the caller's own permissions.
- `customer`: standard booking account.
- `tasker`: seven-step application account; email verification moves it to pending approval.

Administrators normally inherit the complete permission set of their RBAC role. Authorized administrators may assign a validated least-privilege subset only within their own effective access; the super admin may assign any non-super-admin access. Role additions do not expand an explicit override automatically, while role removals are enforced so the override can never exceed its parent role.

## RBAC API

| Method | Route                             | Access                                                  |
| ------ | --------------------------------- | ------------------------------------------------------- |
| GET    | `/api/rbac/me`                    | Admin or super admin                                    |
| GET    | `/api/rbac/permissions`           | `roles.read` or super admin                             |
| GET    | `/api/rbac/roles`                 | `roles.read` or super admin                             |
| GET    | `/api/rbac/roles/:id`             | `roles.read` or super admin                             |
| POST   | `/api/rbac/roles`                 | Super admin                                             |
| PATCH  | `/api/rbac/roles/:id`             | Super admin                                             |
| PUT    | `/api/rbac/roles/:id/permissions` | Super admin                                             |
| DELETE | `/api/rbac/roles/:id`             | Super admin                                             |
| GET    | `/api/rbac/admins`                | `admins.read` or super admin                            |
| GET    | `/api/rbac/admins/:id`            | `admins.read` or super admin                            |
| PATCH  | `/api/rbac/admins/:id`            | `admins.update` or super admin                          |
| PATCH  | `/api/rbac/admins/:id/access`     | `admins.update` or super admin; no privilege escalation |
| PATCH  | `/api/rbac/admins/:id/status`     | `admins.suspend`/`admins.delete` or super admin         |
| DELETE | `/api/rbac/admins/:id`            | `admins.delete` or super admin                          |

The administrator registration endpoint accepts an active role code from `GET /api/rbac/roles`. Omit `permissions` to inherit the role; provide a subset to create an explicit least-privilege override.

See `docs/auth-module.md` for auth flows and `docs/rbac.md` for the RBAC data model, API rules, examples, and migration behavior.

## Administrator dashboard

Version 3.7 introduces permission-aware admin-side views without duplicating the underlying Customer, Tasker, booking, payment, wallet, Auth, or RBAC resources.

- `/api/admin/dashboard/*` provides platform/revenue/user/Tasker/booking analytics and persisted activity.
- `/api/admin/customers/*` provides customer operations, booking/payment history, reports, and moderation.
- `/api/admin/taskers/*` provides Tasker verification, moderation, performance, and earnings monitoring.
- Existing `/api/rbac/*` and `/api/auth/admins/register` remain the only Admin Management/role/permission APIs.
- Super admin bypasses permission checks; normal admins see only endpoints allowed by their effective permissions.
- Background-check/insurance results remain `null` until real providers are integrated.
- Revenue and earnings derive only from persisted paid bookings, payment transactions, wallet ledger entries, and withdrawal records.

See `docs/admin-dashboard.md` for the complete first-slice route map and data definitions.

## Elite Tasker Program

Version 3.8 adds a dedicated but consolidated Elite Tasker domain:

- `GET /api/admin/elite-taskers/overview` powers the program dashboard.
- One `GET /api/admin/elite-taskers` endpoint powers member tiers plus application/upgrade/downgrade queues via query parameters.
- `GET /api/admin/elite-taskers/program` returns tier, benefit and badge settings together.
- Tier eligibility rules are administrator-configured; no rating/job/earning threshold is invented by the backend.
- Request eligibility scores use real metric snapshots and the requirements snapshot captured at submission time.
- Benefits remain configuration-only until the relevant booking/payment/support module explicitly enforces a benefit code.
- Badge assets reuse the existing Cloudinary upload endpoint with folder `elite-badge-assets`.

See `docs/elite-tasker-program.md` for the exact routes and workflow.

## Customer + Tasker dashboards

Version 3.6 intentionally unifies resources that represent the same domain object for both roles:

- `GET /api/dashboard/overview` is role-aware.
- `/api/bookings/*` is the canonical task/booking lifecycle for Customer and Tasker.
- `/api/conversations/*`, `/api/notifications/*` and `/api/reviews/*` are shared and scoped to the authenticated user.
- `/api/auth/me` remains the shared personal-profile contract.
- `/api/favorites/taskers/*` is Customer-specific.
- `/api/payments/*` is Customer payment/card/wallet state.
- `/api/tasker-dashboard/profile/*` remains Tasker-specific business/skills state.
- `/api/tasker-dashboard/wallet/*` remains the Tasker earnings/payout ledger because it has different financial semantics from the Customer spending wallet.

Customer booking flow uses persistent service options, real Tasker availability, transactional slot claiming, Cloudinary attachment metadata, Stripe saved cards/SetupIntents, customer wallet funding and a provider/ledger-backed final settlement after completion. Route ETA remains explicitly unavailable until a real routing provider is configured. Tax remains disabled by default, but v3.10 can apply a configured global tax policy without inventing jurisdiction data.

See `docs/customer-dashboard.md`, `docs/shared-role-api.md`, `docs/payments-stripe.md`, and `docs/tasker-dashboard.md`.

Customer Stripe configuration:

```env
STRIPE_ENABLED=false
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
PAYMENTS_CURRENCY=USD
PAYMENTS_PLATFORM_FEE_PERCENT=0
BOOKING_MINIMUM_BILLABLE_MINUTES=120
CUSTOMER_WALLET_MIN_TOPUP=5
```

Tasker payout configuration remains:

```env
TASKER_WALLET_CURRENCY=USD
TASKER_PAYOUT_EXECUTION_MODE=disabled
TASKER_MIN_WITHDRAWAL_AMOUNT=1
PAYOUT_DATA_ENCRYPTION_KEY=
```

Tasker earning-clearance worker bootstrap defaults:

```env
TASKER_EARNINGS_WORKER_ENABLED=true
TASKER_EARNINGS_WORKER_POLL_MS=60000
TASKER_EARNINGS_WORKER_BATCH_SIZE=100
TASKER_EARNINGS_CLEARANCE_DAYS=14
TASKER_CASH_DISPUTE_CLEARANCE_DAYS=14
```

The Admin Platform Settings `taskerFinance` section is the persisted business-policy source. Environment values initialize defaults only; the optional cash-debt ceiling is disabled until Finance supplies a positive threshold and explicitly enables blocking.

## Super-admin seed

In development, `npm run prisma:seed` upserts the canonical account using:

```text
Email:    latache.superadmin@yopmail.com
Password: Admin@12345
```

Staging/production require client-owned `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD`; the development values are rejected and the initial password must contain at least 12 characters. A new production Super Admin is flagged to change it. Existing production passwords are preserved on later seed runs unless `SUPERADMIN_ROTATE_PASSWORD_ON_SEED=true` is deliberately enabled for a one-time rotation.

## Docker development stack

```bash
docker compose --env-file .env up --build
```

Services:

- PostgreSQL: `localhost:5432`
- Mailpit SMTP: `localhost:1025`
- Mailpit inbox: `http://localhost:8025`
- API: `http://localhost:8080/api`

## Verification

```bash
npm run verify:static
npm run prisma:validate
npm run build
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

The generated Prisma client, `node_modules`, `.env`, `dist`, and coverage output are intentionally excluded from release archives.

- Review creation also uses the shared Notifications service, so review recipients receive the same durable realtime notification pipeline.

## SEO configuration

SEO is managed through the RBAC-controlled `/api/admin/seo/*` APIs. Configure `SEO_PUBLIC_BASE_URL` to the public website origin when it differs from the API origin. The backend exposes `/api/seo/meta`, `/api/seo/robots.txt`, and `/api/seo/sitemap.xml`; the frontend should consume route metadata and apply the resolved canonical, robots, Open Graph, Twitter, alternate-language, and JSON-LD values to rendered pages.
