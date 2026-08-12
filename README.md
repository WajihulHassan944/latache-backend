# Latache Backend — NestJS, Prisma and Nodemailer

Latache backend implemented with NestJS 11, strict TypeScript, Prisma/PostgreSQL, Nodemailer SMTP, Cloudinary uploads, and database-backed RBAC. Version 3.17 adds one premium generated-asset email shell plus Moroccan Darija (`ary`) while preserving v3.16 Redis/queue/realtime scaling, v3.15 translation rows, and v3.14 provider-settled Tasker earning clearance/cash accounting.

## v3.17 email design and Darija

- Every current transactional email uses one responsive TypeScript layout matching the supplied copper/cream desert design; only the center content changes per mail.
- Generated header, shield, and footer PNGs are packaged with the application and sent as CID attachments. The canonical header logo uses `https://latache-web.vercel.app/images/logo-full.svg`.
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

## Required environment configuration

```env
DATABASE_URL=postgresql://latache:latache@localhost:5432/latache?schema=public
JWT_SECRET=<random-secret-at-least-32-characters>
JWT_SECRET_ADMIN=<different-random-secret-at-least-32-characters>
CORS_ORIGINS=http://localhost:3000
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
DATABASE_URL=postgresql://neondb_owner:YOUR_PASSWORD@YOUR_NEON_HOST/neondb?sslmode=require
```

For a pooled runtime connection, set the direct migration connection separately:

```env
DATABASE_URL=postgresql://USER:PASSWORD@YOUR_POOLER_HOST/neondb?sslmode=require
DIRECT_URL=postgresql://USER:PASSWORD@YOUR_DIRECT_HOST/neondb?sslmode=require
```

`prisma.config.ts` prefers `DIRECT_URL` for CLI migrations and otherwise uses `DATABASE_URL`.

## Gmail SMTP

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
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

Running `npm run prisma:seed` upserts and resets the canonical account to:

```text
Email:    latache.superadmin@yopmail.com
Password: Admin@12345
```

The values can be overridden with `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD`. Because the seed deliberately reapplies the password, use a secure environment override in staging/production and do not run the seed as part of every application restart.

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
