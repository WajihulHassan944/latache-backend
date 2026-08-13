# v3.18.0 — Permanent deletion controls and email layout correction

- Added explicit RBAC permissions and irreversible Customer/Tasker/Admin purge APIs with confirmation phrases, audit reasons, row locking, blocker rechecks, and stable `ACCOUNT_PURGE_BLOCKED` responses.
- Added durable PostgreSQL-backed Cloudinary deletion tasks plus immediate cleanup and a retry-safe BullMQ worker job.
- Converted custom-role, unused Service/Service Option, Elite badge, payout-method, and Tasker-skill DELETE flows from soft deactivation to permanent deletion with dependency guards.
- Kept suspension/ban/deactivation as account lifecycle state rather than falsely representing it as deletion.
- Centered the shared email shield using email-client-safe table alignment and made the hosted dunes artwork the direct background of the whole footer.
- Added migration `20260812233000_add_permanent_deletion_controls`, Swagger documentation, tests and static regressions.

# v3.17.2 — Hosted email artwork and verified SMTP acceptance

- Replaced multi-megabyte inline CID artwork with the supplied Cloudinary header, shield, and footer URLs while retaining the hosted Latache logo and shared dynamic email shell.
- Removed local mail artwork and Nest asset-copy configuration, eliminating email asset paths and reducing each SMTP message from several megabytes to a small HTML/text payload.
- Added strict inspection of Nodemailer's accepted-recipient result; the API no longer reports successful delivery when SMTP did not accept the requested recipient.
- Added structured, non-secret SMTP acceptance diagnostics with recipient domain, message ID, and SMTP response code.
- Added configurable connection, greeting, and socket timeouts so SMTP stalls fail predictably instead of holding registration for about 45 seconds.
- Updated Neon examples to `sslmode=verify-full`, preserving certificate and hostname verification while removing the current `pg-connection-string` compatibility warning.
- No API, Prisma migration, financial, realtime, RBAC, or localization behavior changed.

# v3.17.1 — Portable email assets and Swagger login connectivity

- Fixed transactional email CID assets failing with `ENOENT` when compiled JavaScript is emitted under `dist/src/modules/mail` but Nest copies assets to `dist/modules/mail/assets`.
- Restricted the Nest production TypeScript build root to `src`, restoring the canonical `dist/main.js` and colocated `dist/modules/...` layout expected by package scripts and Docker.
- Made `npm run build` clear only the generated `dist` directory first, preventing stale `dist/src` JavaScript from surviving an upgrade and being started accidentally.
- Moved TypeScript incremental build metadata into `dist`, ensuring a clean build cannot incorrectly skip JavaScript emission after `dist` is removed.
- Added ordered runtime resolution for colocated build assets, `dist/modules`, `dist/src/modules`, and source-mode assets on Windows/Linux.
- Added regression coverage for the exact `dist/src` versus `dist/modules` layout and local Windows project layout.
- Normalized configured HTTP origins, included the API/Swagger origin automatically, and made rejected cross-origin requests omit CORS authorization without throwing an application error.
- Locked the Swagger Super Admin example to literal JSON credentials so copied documentation cannot introduce Markdown `mailto:` links or backslash escapes.
- No API, database, financial, realtime, RBAC, or localization behavior changed.

# v3.17.0 — Premium shared email design and Moroccan Darija

- Rebuilt every transactional email on one responsive, Outlook-compatible TypeScript layout matching the supplied premium copper/cream desert design.
- Added generated header, security-shield, and footer artwork as source-controlled CID attachments; the requested hosted Latache SVG is the canonical header logo.
- Preserved dynamic/escaped center content for verification OTP, password-reset OTP, and administrator welcome mail, including text alternatives.
- Added Moroccan Darija (`ary`) to centralized locale configuration, `Accept-Language` resolution, profile/registration/Admin preference Swagger contracts, notification templates, and transactional email copy.
- Kept English as the canonical fallback and retained the scalable translation-row architecture for Darija catalogue/configuration content.
- No Prisma migration is required because locale values and translation rows were already designed for configurable BCP-47 codes.

# v3.16.0 — Redis, queues, multi-instance realtime, and performance

- Added environment-driven Railway Redis infrastructure with graceful cache fallback and required-dependency health semantics.
- Added versioned caches and post-commit invalidation for localized Services/Options, Platform Settings, Elite configuration, and short-TTL Admin aggregates.
- Added BullMQ scheduler/worker mode for retry-safe Tasker earning release, stale-call expiration, and bounded dispatched-outbox cleanup.
- Added the Socket.IO Redis adapter while retaining PostgreSQL's transactional outbox as durable event authority and preserving room privacy boundaries.
- Removed outbox retention deletion from the high-frequency dispatch loop; pending/failed rows are never cleanup candidates.
- Added request compression, safe cache headers, explicit Prisma pool limits, structured latency/error logs, and slow-query metadata without parameters.
- Added compatible cursor pagination for notifications, conversation messages, and Tasker wallet ledger entries.
- Added query-driven PostgreSQL indexes and `pg_trgm` GIN indexes for normalized English/Arabic Service catalogue search.
- Extended `/api/health` with PostgreSQL, Redis, BullMQ worker/backlog, realtime outbox, cache, and baseline metric status.
- Added additive migration `20260812223000_add_performance_indexes`.

# v3.15.0 — English and Arabic dynamic-content localization

- Added centralized saved-preference/`Accept-Language` locale resolution with English/canonical fallback and stable unsupported-locale errors.
- Added resource-owned translation rows for Services, Service Options, Elite tiers, benefits, and badges without changing IDs or adding language columns.
- Backfilled existing canonical content into English translation rows; no Arabic or operational data is fabricated.
- Extended existing Admin/RBAC mutations and reads to manage all configured translations.
- Added localized public platform informational content through the existing Platform Settings source.
- Added Unicode/Arabic-normalized Service/Tasker catalogue search while preserving original text.
- Added persisted notification template keys/parameters plus localized REST/realtime rendering.
- Added English/Arabic TypeScript templates for verification, password reset, and administrator welcome email.
- Added additive migration `20260812190000_add_multilingual_architecture`.

# v3.14.0 — Tasker earning clearance and cash accounting

- Added immutable per-booking Tasker earning snapshots after genuine online/provider settlement.
- Added configurable pending clearance, defaulting to 14 days, with PostgreSQL row-locking and idempotent release ledgers safe across multiple Railway replicas.
- Added dispute blocking, explicit audited Finance holds/extensions, pending-first refund reversals, and existing-wallet clawback fallback after release.
- Added explicit Tasker cash confirmation and auditable cash platform receivables without platform-held wallet fiction.
- Added transactional offsets of outstanding cash platform payables from mature online earnings.
- Added configurable cash-debt ceiling/restriction policy, persisted realtime notifications, Tasker wallet views, and Admin Finance views/actions over the same records.
- Added additive migration `20260812143000_add_tasker_earning_clearance_cash_accounting`; it does not reset or seed financial data.

# v3.13.0 — Conversation documents, voice calls and video calls

- Added verified single/multiple conversation attachment sharing through the existing Cloudinary upload APIs.
- Added document formats and configurable count, per-file, and total-message size limits.
- Added `GET /api/conversations/capabilities` for frontend capability discovery.
- Added persisted one-to-one voice/video call lifecycle and history under booking conversations.
- Added authenticated WebRTC signaling events over the existing `/realtime` Socket.IO namespace.
- Added STUN/TURN configuration with temporary coturn HMAC credentials or static TURN credentials.
- Added ring timeout, maximum duration, signaling rate limits, active-call concurrency protection, and booking-status eligibility checks.
- Added migration `20260812100000_add_conversation_calls` without fake calls or media records.
- Media remains peer-to-peer and is neither proxied nor recorded by the NestJS API.

# v3.12.0 — API Consistency & Realtime

- Audited and normalized the complete Customer/Tasker/Admin API ownership model.
- Added authenticated Socket.IO realtime delivery for notifications, booking conversations, support chat, booking state, task timer and Tasker location.
- Added a transactional PostgreSQL outbox so persisted realtime events are committed with domain writes and delivered at-least-once.
- Separated booking-state rooms from private Customer↔Tasker conversation rooms so `bookings.read` does not grant chat visibility.
- Added `GET /api/realtime/session` as the authenticated transport contract.
- Normalized Services to `GET/POST /api/services` and added `GET /api/services/:serviceId`; removed legacy `get-services` / `add-service` route names.
- Normalized participant dispute routes to `/api/disputes` and `/api/bookings/:bookingId/disputes`; removed complaint terminology from the HTTP surface.
- Added participant dispute list/detail APIs that were missing from the shared Customer/Tasker contract.
- Review creation now generates the shared persisted `review_received` notification, so recipients receive it through the standard realtime notification channel.
- Administrative booking cancellation now emits the same `booking:updated` realtime event as participant lifecycle changes.
- Added permission-aware Admin review moderation (`reviews.read` / `reviews.manage`) and excluded hidden reviews from public ratings/feeds.
- Added realtime booking invalidation/events for confirmation, cancellation, navigation, location, timer, reschedule, extension, billing, completion, and dispute/evidence changes.
- Hardened Customer billing updates with a booking row lock so a concurrent payment cannot race a tip/donation mutation.
- Added migrations `20260810193000_add_realtime_outbox` and `20260810194500_add_review_moderation`; neither seeds operational data.

# v3.11.1

- Fixed Stripe refund webhook metadata access when Stripe returns `metadata: null`.
- Fixed strict-null TypeScript errors in Support Center resolution/CSAT average calculations.
- No API, Prisma schema, migration, or runtime flow changes.

# Changelog

## 3.11.0 - Service Management & Support Center

- Added persisted Support Tickets and Support Ticket Messages for Customer/Tasker tickets and live-chat cases.
- Added one permission-aware Admin Support Center queue with customer, tasker, escalated, live-chat and report views.
- Added real support assignment, priority, escalation, resolution, reopen, CSAT and response/resolution-time reporting.
- Added Cloudinary `support-attachments` folder policy and ownership validation.
- Added admin Service Management aggregate views while retaining Services/ServiceOptions/UserServices as canonical catalogue/assignment tables.
- Added safe service/sub-service soft deactivation and audit logging.
- Extended the existing pricing engine with per-tier minimum task prices and enforced them at quote and final charge.
- Kept commission/tax mutations in Platform Settings and financial refund/payout mutations in Dispute/Finance modules to avoid duplicate flows.
- Added migration `20260810190000_add_services_support_center`.

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
