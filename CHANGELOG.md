# Changelog

## 3.10.0 — Payments, Finance & Platform Settings

- Added one unified finance read endpoint for overview, transactions, refund queue, payout queue, and revenue reporting.
- Kept refund execution inside existing Dispute Management instead of creating a duplicate refund mutation flow.
- Added audited Tasker payout approval/rejection/manual-settlement actions with real wallet reservation/release accounting.
- Added one persistent Platform Settings API for General, Currency, Tax, Booking Rules, Service Radius, Commission, and Referral policy.
- Reused the existing Elite Program API as the sole owner of Elite requirements/benefits while exposing it in the settings read aggregation.
- Commission rules now affect new quotes and final charges using actual Tasker Elite tier and optional service overrides.
- Optional global tax/service surcharge is persisted on bookings and applied to new final charges; the applied commission/tax rates and tax-inclusivity are recorded for audit, and existing settlements are never recalculated.
- Booking policy and service-radius settings are connected to booking validation and Tasker discovery.
- Unsupported FX, referral, routing, SMS/push, maintenance and tax-reporting switches are rejected rather than saved as cosmetic/dummy settings.
- Added `settings.read` / `settings.manage` RBAC permissions and additive migration `20260810173000_add_finance_platform_settings`.
- No fake payment, payout, refund, tax, exchange-rate, referral, or revenue records are seeded.

## 3.9.0 — Admin Booking & Dispute Management

- Added one permission-aware Booking Management list API for All/Pending/Accepted/In Progress/Completed/Cancelled/Disputed views plus filtered CSV export.
- Removed the semantic duplicate admin-wide `/api/admin/customers/bookings` route while preserving per-customer booking drill-down.
- Added safe admin booking detail and cancellation flows; settled/disputed bookings cannot bypass dispute/refund invariants.
- Added one Dispute Management list API for Open, Under Investigation, Escalated, Resolved, Evidence Review and Resolution Actions views.
- Added one dispute action API for assignment, priority, escalation, evidence requests/review, resolution drafts, final resolution and reopening.
- Added normalized dispute evidence and evidence-request persistence, including end-to-end Customer/Tasker responses through existing Cloudinary booking attachments.
- Added real Stripe and customer-wallet refund orchestration with idempotent refund transactions, webhook reconciliation and `partially_refunded`/`refunded` booking states.
- Added proportional, idempotent Tasker earning reversals only after a refund actually settles.
- Refund resolution requires both `support.manage` and `finance.manage`; CSV export additionally requires `reports.read`.
- Added real administrative audit/notification events and explicitly leaves post-dispute satisfaction unavailable until a real survey source exists.
- Added additive migration `20260810130000_add_booking_dispute_management` with no fake complaint, evidence, refund or resolution rows.

## 3.8.0 — Elite Tasker Program

- Added database-backed Gold, Platinum and Diamond Elite tiers.
- Added one unified admin list API for Elite members, tier tabs, applications, upgrades and downgrades.
- Added real Tasker self-service application/upgrade/downgrade requests with one-pending-request concurrency protection.
- Added configurable tier requirements and a real metrics-based eligibility score; no policy thresholds are seeded.
- Snapshotted both Tasker metrics and tier requirements when a request is submitted so later policy edits do not rewrite historical review context.
- Added transactional request decisions, direct administrative tier correction, tier-transition history, notifications and audit events.
- Added bulk tier-benefit configuration without pretending a configured label automatically changes booking/payment behavior.
- Added badge definitions, Cloudinary badge-asset reuse, award/revoke history and tier restrictions.
- Added real Elite performance analytics and JSON/CSV reports; benefit utilization stays explicitly unavailable until usage events exist.
- Added `elite.read` and `elite.manage` RBAC permissions and removed the duplicate `/api/admin/dashboard/elite-taskers` route.
- Added migration `20260810070000_add_elite_tasker_program`.

# 3.7.0

- Added the first Super Admin/Admin dashboard backend slice based on the supplied design screens while keeping existing domain flows authoritative.
- Added permission-aware platform overview, revenue, user, Tasker, Elite Tasker, booking and activity analytics.
- Added Customer Management list/profile/booking/payment/reporting and audited suspend/reactivate/ban flows.
- Added Tasker Management list, pending-verification, detail, approval/rejection, moderation, performance and earnings-monitoring flows.
- Added `AdminAuditLogs` as the only new persistence surface for administrative decisions; existing Users, Bookings, Payments and wallets remain the system of record.
- Reused Auth/RBAC for admin creation, list/detail, profile update, role assignment, suspension and deletion rather than creating duplicate admin-management APIs.
- Allowed delegated administrators with `admins.create`/`admins.update` to create or modify only access that is a subset of their own permissions; canonical super-admin access remains immutable.
- Added admin profile update and soft-delete APIs with session revocation and audit logging.
- Ensured Tasker verification uses real Latache checks and returns null for unintegrated background/insurance providers rather than fake statuses.
- Added additive migration `20260808090000_add_admin_dashboard_foundation` with no seeded dashboard, revenue or activity rows.

# 3.6.1

- Added Customer dashboard APIs based on the supplied Figma screens.
- Unified dashboard, bookings/tasks, conversations, notifications and reviews across Customer and Tasker roles.
- Removed duplicate Tasker task/message/notification/review controllers and old legacy booking list/create routes.
- Added customer favorites, customer wallet ledger and Stripe payment infrastructure.
- Added SetupIntent/saved-card management, Stripe-funded wallet top-ups and webhook-driven booking settlement.
- Added persistent service sub-options used by the customer booking flow.
- Added customer reschedule, explicit time extension, cancellation, shared timer/navigation reads and shared complaint flow.
- Added booking tip, Latache donation and donation-dropoff request fields.
- Added a unified role-aware dashboard overview.
- Added the additive `20260807020000_add_customer_dashboard_and_stripe` migration without fake dashboard or financial data.

# 3.5.0

- Added Tasker dashboard overview APIs mapped to the supplied Figma screens.
- Added real task lifecycle transitions, navigation/location state, arrival, persistent timer, notes, completion and complaints.
- Added Tasker personal/business profile and service-skill/rate management.
- Added booking-backed Tasker conversations/messages without fabricated support or AI conversations.
- Added persisted Tasker notifications with unread/read state.
- Added completed-booking review create/update/delete and received/given review listings.
- Added ledger-backed Tasker wallet, transaction history, encrypted payout methods, payout PIN protection and withdrawal request lifecycle.
- Added a payment-safe settlement boundary: task completion never creates earnings; only a future verified payment settlement can call the internal idempotent credit hook.
- Added disabled/manual payout execution modes; neither mode fabricates provider success, and manual mode creates `pending_review` only.
- Added `20260807010000_add_tasker_dashboard` additive Prisma migration with no demo financial data.
- Added Tasker dashboard Swagger tags, static route/security verification and design-to-API documentation.

# 3.4.0

- Added the persistent `RbacRoles` Prisma model and additive RBAC migration.
- Added grouped read-only permission catalogue API.
- Added role list, details, create, update, permission replacement, and safe soft-delete APIs.
- Added administrator list/details, role assignment, permission subset, effective-access, and status APIs.
- Suspending or deactivating an administrator revokes every active refresh-token session.
- Added role permission inheritance with transactional synchronization of assigned administrators.
- Preserved explicit least-privilege overrides while constraining them to permissions that still exist on the parent role.
- Updated administrator registration to resolve active database role codes and validate permission subsets.
- Seeded and backfilled system roles, including the canonical super-admin assignment.
- Enforced `services.manage` on service creation to demonstrate effective permission guards.
- Added detailed Swagger examples, RBAC documentation, static verification, and security regression tests.

# 3.3.2

- Fixed `JwtIdentityGuard` dependency resolution when used by imported feature modules such as `UploadsModule`.
- Exported `AuthSessionsRepository` from `AuthModule` so route-scoped guard resolution can access the active-session store.
- Added unit and static regression checks for the complete reusable auth guard dependency graph.

# 3.3.1

- Fixed TypeScript declaration generation for upload controller methods by exporting upload response contracts and declaring controller/service return types explicitly.
- No API, Prisma schema, migration, or environment-variable changes.

# Changelog

## 3.2.0 - Canonical auth API only

- Removed every legacy auth route and compatibility alias.
- Removed legacy signup consent fields and signed password-reset link/JWT flow.
- Added authenticated email verification through an active registration session.
- Added database-backed access-session validation for every bearer request.
- Standardized OTP request values as six-digit strings while retaining integer storage.
- Required exactly three expertise services for the tasker signup design.
- Moved logout-all to `POST /auth/sessions/logout-all`.
- Expanded Swagger descriptions, request examples, role requirements and failure responses.
- Updated the super-admin seed to apply `latache.superadmin@yopmail.com` / `Admin@12345` on every seed unless overridden.
- Removed all standalone HTML files and retained escaped TypeScript email templates only.
- Kept pending-verification registration sessions refreshable so an expired access token cannot strand the email-verification flow.
- Aligned verification and logout-all HTTP status codes with their Swagger 200 responses.

## 3.1.0 - Auth domain foundation

- Split registration, login/token, password, profile and session responsibilities.
- Added role-specific customer, tasker and super-admin-controlled admin registration.
- Added account status, permission, OTP-attempt, session metadata and consent fields.
