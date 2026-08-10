# Latache Backend — NestJS, Prisma and Nodemailer

Latache backend implemented with NestJS 11, strict TypeScript, Prisma/PostgreSQL, Nodemailer SMTP, Cloudinary uploads, and database-backed RBAC. Version 3.10 adds permission-aware Payments & Finance operations plus persistent Platform Settings on top of Booking/Dispute Management, the administrator dashboard, Elite Tasker Program, and unified Customer/Tasker APIs. Stripe/payment state remains provider-driven; analytics read the real operational tables, and administrator decisions are recorded in an audit log rather than shadow copies of business data.

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

SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=Latache <no-reply@latache.local>

OTP_EXPIRES_IN_MINUTES=5
PASSWORD_RESET_OTP_EXPIRES_IN_MINUTES=15
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

| Method | Route | Access |
|---|---|---|
| POST | `/api/auth/customers/register` | Public |
| POST | `/api/auth/taskers/register` | Public |
| POST | `/api/auth/admins/register` | `admins.create` or super admin; delegated creation is non-escalating |
| POST | `/api/auth/login` | Public |
| POST | `/api/auth/refresh` | Public with refresh token |
| POST | `/api/auth/verify-email` | Registration bearer session |
| POST | `/api/auth/resend-verification-email` | Public |
| POST | `/api/auth/forgot-password` | Public |
| POST | `/api/auth/verify-reset-otp` | Public |
| POST | `/api/auth/reset-password` | Public |
| PATCH | `/api/auth/change-password` | Verified bearer session |
| GET | `/api/auth/me` | Verified bearer session |
| PATCH | `/api/auth/me` | Verified bearer session |
| GET | `/api/auth/sessions` | Verified bearer session |
| DELETE | `/api/auth/sessions/:id` | Verified bearer session |
| POST | `/api/auth/logout` | Verified bearer session |
| POST | `/api/auth/sessions/logout-all` | Verified bearer session |

Old aliases such as `sign-up`, `refresh-token`, `verify-otp`, `resend-otp`, `verify-pass-token`, `verify-forgot-password`, `get-loggedin-user`, `verify-token`, and `logout-all` are intentionally not registered.

## Role model

- `super_admin`: seeded canonical platform owner with immutable full access.
- `admin`: linked to a persistent RBAC role; creation requires `admins.create` and delegated creation cannot exceed the caller's own permissions.
- `customer`: standard booking account.
- `tasker`: seven-step application account; email verification moves it to pending approval.

Administrators normally inherit the complete permission set of their RBAC role. Authorized administrators may assign a validated least-privilege subset only within their own effective access; the super admin may assign any non-super-admin access. Role additions do not expand an explicit override automatically, while role removals are enforced so the override can never exceed its parent role.

## RBAC API

| Method | Route | Access |
|---|---|---|
| GET | `/api/rbac/me` | Admin or super admin |
| GET | `/api/rbac/permissions` | `roles.read` or super admin |
| GET | `/api/rbac/roles` | `roles.read` or super admin |
| GET | `/api/rbac/roles/:id` | `roles.read` or super admin |
| POST | `/api/rbac/roles` | Super admin |
| PATCH | `/api/rbac/roles/:id` | Super admin |
| PUT | `/api/rbac/roles/:id/permissions` | Super admin |
| DELETE | `/api/rbac/roles/:id` | Super admin |
| GET | `/api/rbac/admins` | `admins.read` or super admin |
| GET | `/api/rbac/admins/:id` | `admins.read` or super admin |
| PATCH | `/api/rbac/admins/:id` | `admins.update` or super admin |
| PATCH | `/api/rbac/admins/:id/access` | `admins.update` or super admin; no privilege escalation |
| PATCH | `/api/rbac/admins/:id/status` | `admins.suspend`/`admins.delete` or super admin |
| DELETE | `/api/rbac/admins/:id` | `admins.delete` or super admin |

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
