# 3.32.0

- Added complete RBAC-managed SEO configuration, localized route metadata, canonical/robots directives, Open Graph/Twitter metadata, structured data, redirects, robots.txt, XML sitemap generation, dynamic service/tasker sitemap inclusion, and explicit sitemap entries.
- Added automatically generated homepage APIs for services, popular projects, recommended jobs, and testimonials backed by authoritative marketplace data.

# v3.30.0 — Customer discovery completion and extensible content management

- Added Tasker discovery `date`, `startTime`, and `endTime` filters. The listing now returns only active Taskers with a genuinely open `UserAvailability` slot covering the requested window.
- Added a generic database-backed Content Management System for homepage sections and future pages, including About, Privacy Policy, Terms of Service, or any future page slug.
- Content pages support draft/published state, versioning, SEO metadata, page metadata, arbitrary block types, structured JSON payloads, ordering, activation, and English/Arabic/Darija translations.
- Added public `GET /api/content/:slug` with locale fallback and admin CRUD/publish/unpublish APIs under `/api/admin/content`; published pages cannot be permanently deleted until unpublished.
- Content management is RBAC-controlled with existing `content.read` / `content.manage` permissions; the built-in Content Administrator role already receives these permissions.
- Content mutations are audit logged and invalidate the shared platform-content cache.
- Existing Service/ServiceOption APIs remain the single canonical dynamic catalogue; Admin/Content permissions do not create a second service source of truth. Service minimum/maximum Tasker rates remain enforced in onboarding and narrowing a service range is blocked when existing Tasker rates would become invalid.
- Added additive migration `20260825120000_content_management_and_tasker_discovery_filters`.
- Build, lint, Jest, E2E and Prisma validation/generation were not run at the requester’s instruction.

# v3.29.0 - Verified on-site work start/completion flow

- New bookings require a Tasker front-door photo after arrival, followed by a six-digit Customer start OTP before the work timer can start. Existing pre-migration bookings retain the previous completion behavior.
- The Tasker must attach an immutable completed-work photo when the job is done. Persisting that proof freezes the billable timer immediately so time spent waiting for the final OTP is not charged.
- The Customer then issues a six-digit completion OTP; the Tasker verifies it to complete the booking and unlock final payment orchestration. The authenticated Customer can use the existing completion endpoint as a fallback after completed-work proof is present.
- Work OTPs are keyed-hash stored, expire, enforce bounded attempts, and are returned only to the authenticated Customer. Work images are verified against Latache-managed Cloudinary resources and protected from independent deletion after persistence.
- New verification-required bookings do not enter the legacy automatic completion-review worker. Online Tasker earnings still enter the existing configured clearance/hold flow after genuine payment settlement.
- Taskers can extend an active task through the shared booking extension endpoint; `extensionMinutes` increments and final billing remains based on the persisted timer with the resulting authorized-duration ceiling.
- Customer Management now supports phone, booking-location, and joined-date (`from`/`to`) filters. Full international phone values are matched against the separately stored country-code/local-number fields.
- Customer wallet responses now include real saved Stripe cards/default card and the existing SetupIntent endpoint needed to attach a new card. Stripe bookings continue requiring a real saved Customer card.
- Added additive migration `20260820194500_booking_work_verification_flow`.
- Added optional `BOOKING_WORK_OTP_TTL_MINUTES` (default 15) and `BOOKING_WORK_OTP_MAX_ATTEMPTS` (default 5).
- Build, lint, Jest, E2E and Prisma validation/generation were not run at the requester’s instruction.

# v3.28.3 - Railway PostgreSQL advisory-lock compatibility hotfix

- Replaced PostgreSQL advisory-lock calls that used Prisma `$queryRaw` with `$executeRaw`.
- Fixes Railway signup 500 errors caused by Prisma attempting to deserialize PostgreSQL `void` returned by `pg_advisory_xact_lock`.
- Applied consistently to Customer registration, Tasker registration, social-auth identity locking, and service slug locking.
- No API, schema, migration, or environment-variable changes.
- Build/tests/lint/Prisma validation were not run per request.

# v3.28.2 - Railway CORS and Swagger same-origin hotfix

- Added built-in browser origins for `https://latache-web.vercel.app`, `https://latache-be-production.up.railway.app`, and `http://localhost:3000`; additional `CORS_ORIGINS` values are merged rather than replacing these deployment-safe defaults.
- Swagger now declares relative `/` as its first OpenAPI server, so `Try it out` always targets the host serving `/api/docs` and cannot be redirected to a stale localhost `APP_BASE_URL`.
- Kept the configured absolute `APP_BASE_URL` as a secondary OpenAPI server for exported clients.
- Explicitly enabled standard CORS methods/preflight handling.
- No API, Prisma schema, migration, or environment requirement changes.
- Build/tests/lint/Prisma validation were not run for this hotfix.

# v3.28.1 — Railway SMTP IPv4 and automatic public base URL hotfix

- Prefer IPv4 process-wide with Node `dns.setDefaultResultOrder('ipv4first')` before NestJS starts. The same bootstrap is used by `SERVICE_MODE=worker`, so API and BullMQ worker processes receive the fix.
- Railway `RAILWAY_PUBLIC_DOMAIN` is now used automatically as `https://<domain>` when `APP_BASE_URL` is not explicitly configured. Local fallback remains `http://localhost:8080`.
- SMTP bootstrap verification is non-fatal by default. `SMTP_VERIFY_ON_BOOTSTRAP=true` can still verify connectivity, but a transient SMTP/DNS outage no longer terminates the whole API unless `SMTP_VERIFY_ON_BOOTSTRAP_FATAL=true` is explicitly configured.
- Runtime email delivery continues to fail closed with the existing controlled HTTP 503 if SMTP is unavailable; no successful delivery is fabricated.
- No API, Prisma schema, migration, or financial/business-flow change.
- Build, lint, Jest, E2E and Prisma validation/generation were not run at the requester’s instruction.

# v3.28.0 — Complete authentication audit and hardening

- Audited local Customer/Tasker/Admin authentication, email verification, password reset/change, refresh-token rotation, session revocation, multi-role switching/enrollment, Google/Apple authentication/linking and authorization guards.
- Added database-backed local-password failed-login tracking and temporary account-method lockout (`AUTH_MAX_FAILED_LOGIN_ATTEMPTS`, default 5; `AUTH_LOGIN_LOCK_MINUTES`, default 15) so protection is consistent across multiple API instances.
- Added authenticated `POST /api/auth/set-password` for social-only identities. Password reset/change clears local-login lock state; password reset/change continues revoking all existing sessions.
- Enforced the independent Admin JWT signing secret at both token signing and verification; administrative tokens are no longer allowed to fall back to the marketplace JWT secret.
- Enforced `mustChangePassword` at the Admin guard boundary so a newly created Admin/Super Admin must replace the temporary password before any Admin API is usable.
- Hardened Google/Apple OIDC verification with signing-key `alg/use` checks, multi-audience `azp` validation, `nbf` validation, issuer/audience/expiry/issued-at checks, and fail-closed JWKS refresh behavior. Existing optional provider nonce verification remains supported.
- Serialized local/social account creation on the same normalized-email advisory lock and serialized provider linking per User/provider to prevent concurrent duplicate/link races.
- Social provider unlink now revokes all Latache sessions; authentication-method responses expose whether a local password can be enabled and whether each provider can be safely unlinked.
- Added operational marketplace-profile enforcement for dedicated Customer/Tasker routes: pending/rejected Tasker identities may authenticate to inspect onboarding/status but cannot consume Tasker operational APIs until the profile is active.
- Existing identity/role enrollment cannot be used to bypass suspension, deactivation, or an active local-login lock.
- Additive migration `20260820150000_authentication_hardening` adds local-login lockout state and an index for lock expiry queries.
- Build, lint, Jest, E2E, Prisma generation/validation and migration execution were not run at the requester’s instruction.

# v3.27.0 — Google and Apple social authentication

- Added `POST /api/auth/social/google` and `POST /api/auth/social/apple` for server-verified social signup/login.
- Added authenticated provider link/unlink endpoints and `GET /api/auth/social/methods`.
- Added `SocialAuthIdentities` with unique provider subject and provider-per-user constraints.
- Preserved the single-User multi-role architecture; social-created identities start with Customer access and use the existing Tasker-role onboarding for service-provider enrollment.
- Added rotating JWKS verification with issuer/audience/expiry/nonce checks and bounded stale-key fallback.
- Added `GOOGLE_AUTH_CLIENT_IDS`, `APPLE_AUTH_CLIENT_IDS`, `SOCIAL_AUTH_JWKS_CACHE_SECONDS`, and `SOCIAL_AUTH_CLOCK_SKEW_SECONDS`.
- Additive migration `20260820143000_google_apple_social_auth`.
- No build/tests/lint/Prisma validation were run per request.

# v3.26.2

- Fixed multi-role dispute/Admin TypeScript role-field typing regressions reported after v3.26.1.
- Disciplinary-action responses now read the persisted `targetRole` field.
- Admin dispute list typing now includes the persisted `filedByRole`.
- Warning-strike target collections are explicitly restricted to Customer/Tasker marketplace roles.
- No API, schema, migration, or environment changes.
- Build/tests/lint/Prisma validation were not run per request.

# v3.26.1 — TypeScript source hotfix

- Fixed participant dispute Prisma payload typing by using a mutable resolution-status filter instead of a readonly tuple in `PARTICIPANT_DISPUTE_INCLUDE`; this restores relation-aware payload inference for dispute list/detail views.
- Fixed legacy dispute-evidence byte aggregation by explicitly using a numeric reducer accumulator for Prisma JSON attachment data.
- Normalized indexed Elite tier lookups to `null` so automatic badge synchronization never receives `undefined`.
- Fixed Elite settled-earnings reporting to group ledger totals by currency and normalize them to canonical USD before aggregation, ranking and eligibility metrics.
- Restored the required `settledEarningsCurrency: 'USD'` marker when deserializing Elite metrics snapshots.
- No API, database-schema, migration or environment-setting change.
- Build, lint, Jest, E2E and Prisma generation/validation were not run at the requester’s instruction.

# v3.26.0 — Multi-role Customer/Tasker identity

- Replaced the single-marketplace-role assumption with one canonical User identity plus explicit `roles[]`, `CustomerProfile`, and `TaskerProfile` state. Existing email uniqueness remains identity-wide.
- Added authenticated role enrollment for Customer → Tasker and Tasker → Customer without duplicating credentials, email verification, or User rows.
- Added active-role login/session semantics and Customer/Tasker role switching; refresh-token sessions persist the selected marketplace role.
- Updated role guards, JWT identity handling and profile serialization for role membership rather than permanent `User.role` assumptions.
- Updated booking discovery/dashboard paths for dual-role identities and explicitly reject self-booking where Customer and Tasker resolve to the same User.
- Scoped Customer/Tasker moderation, dispute strikes, ratings/review context and profile lifecycle independently while retaining identity-level audit compatibility.
- Scoped support requester context, notifications, private chat/realtime/WebRTC authorization and retry keys to the active marketplace role/context.
- Preserved separate Customer wallet versus Tasker earning/payout accounting even when both profiles share one User ID.
- Changed referral attribution uniqueness to `(referredUserId, program)` so one identity can participate independently in Customer and Tasker referral programs while self-referral remains prohibited.
- Added additive migration `20260819130000_multi_role_identity_profiles`.
- Build, lint, Jest, E2E, Prisma generation/validation and migration execution were not run at the requester’s instruction.

# v3.25.0 — Super Admin referral policy and enforceable Elite perk catalog

- Referral/Rewards commercial policy is now Super-Admin-owned. `clientReferralBonus`, referred-Customer discount policy, `taskerReferralBonus`, `referredTaskerBonus`, qualification floors, caps, expiry and clearance remain on the canonical `referral` Platform Settings section; non-Super-Admin writes are rejected.
- Commission/Elite-pricing policy is also Super-Admin-only because it controls the financial value of the `tier_commission_policy` perk.
- Elite tier eligibility/automation policy and tier perk assignment are Super-Admin-only; operational Admins with `elite.manage` can continue reviewing memberships and applying permitted member-level actions without redefining Gold/Platinum/Diamond policy.
- Added a backend-defined Elite perk catalog: `elite_profile_badge`, `search_priority_boost`, and `tier_commission_policy`. Arbitrary unsupported benefit codes can no longer be assigned as if they were functional perks.
- Perk assignment is now authoritative: discovery priority is applied only when the tier has active `search_priority_boost`; tier commission/minimum-task-price rules apply only when `tier_commission_policy` is active; public Tasker responses expose `eliteProfileBadgeVisible`/active perk codes so the profile badge is controlled by the assigned entitlement.
- Added `GET /api/admin/elite-taskers/program/perk-catalog`. The existing `PUT /api/admin/elite-taskers/program/tiers/:tierCode/benefits` remains the single perk-assignment mutation.
- Built-in automatic Elite badges respect the active profile-badge perk assignment. Unsupported historical custom benefit rows are retained but deactivated by additive migration `20260819113000_superadmin_referral_elite_perk_policy`.
- Booking quote pricing policy now exposes `eliteCommissionPerkApplied` so the API explicitly reports whether Elite commission treatment was used.
- Build, lint, tests and Prisma generation/validation were not run for this release, preserving the requester's existing validation workflow.

# v3.24.0 — Dispute, referral/reward and chat flow completion audit

- Audited the current Dispute, Referral/Rewards and Chat/Support backend flows end-to-end without introducing parallel resources.
- Disputes: added automatic expiry for unanswered settlement proposals through the existing durable maintenance job, cancelled stale proposed settlements on participant withdrawal, and made participant/Admin evidence submissions retry-safe by ignoring already-persisted Cloudinary public IDs before consuming case evidence capacity.
- Added an index on dispute resolution status/response deadline for efficient settlement-expiry maintenance.
- Referral/Rewards: referral reward release now treats active/lost Stripe provider chargebacks as financial holds, and a verified Stripe chargeback loss revokes/cancels/reverses the related referral benefits through the existing immutable wallet-ledger logic.
- Referral reward release now locks Booking → Referral → Reward to serialize with provider financial events. Customer referral-discount reservations are defensively released on booking cancellation and can be safely reused for a later eligible booking instead of becoming stranded.
- Chat/Support: audited Customer↔Tasker private booking chat, Customer/Tasker↔Admin/Super Admin support conversations, Admin/Super Admin internal notes, attachments, unread/read state, transactional realtime outbox and Customer↔Tasker WebRTC signaling. No missing backend flow or new route was required.
- Updated stale static contracts for current Cloudinary dispute verification, satisfaction tracking, provider-chargeback-aware referrals and settlement-proposal expiry.
- Added additive migration `20260819093000_complete_dispute_referral_chat_flows`.
- Build, lint, tests and Prisma generation/validation were not run for this release at the requester's instruction.

# v3.23.0 — Tasker level automation, service-rate governance and platform currency presets

- Completed the Tasker Elite lifecycle with live eligibility enforcement, Admin approval revalidation, automatic entry/next-tier promotion, retention grace periods, one-step demotion, recovery, request cooldowns, persisted evaluation history, notifications and audit records.
- Added automatic Elite badge assignment/revocation and seeded production-safe built-in Gold/Platinum/Diamond requirements only where no Admin requirements already existed.
- Added backend-enforced Elite perks that are real rather than cosmetic: tier/profile badges, rank-based default Tasker discovery priority, and the existing tier-specific commission/minimum-task-price pricing policy.
- Added required Admin Service minimum/maximum hourly rates. Canonical catalogue rates are stored in USD, while Admin/Tasker/public APIs accept and return current platform-currency amounts; Tasker onboarding/profile rates are transactionally rejected outside Service bounds.
- Added Service-row locking so concurrent Admin range edits cannot race Tasker rate writes; Admin cannot narrow a range while existing Tasker rates would become invalid.
- Added Super-Admin-only operational market selection for US/USD, Morocco/MAD, Pakistan/PKR, France/EUR and Spain/EUR using static application presets (`USD 1`, `MAD 9`, `PKR 280`, `EUR 0.86` per USD). France and Spain intentionally share EUR.
- Added safe cross-ISO currency switching: it is blocked while active/unsettled bookings, non-zero wallets, earnings, cash receivables/payables or withdrawals exist. Historical financial/provider rows retain their original ISO currency.
- New bookings/payments, service/catalogue prices, Tasker discovery/profile rates, wallet creation and presentation summaries use the selected platform currency. Historical mixed-currency dashboard totals are display-converted using the same static presets without rewriting ledger rows.
- Added BullMQ Elite maintenance scheduling (`ELITE_WORKER_POLL_MS`, `ELITE_WORKER_BATCH_SIZE`) and additive migration `20260818223000_tasker_levels_service_rate_currency`.
- Build, lint, tests and Prisma generation/validation were not run for this release at the requester's instruction.

# v3.22.0 — Dispute lifecycle, evidence, moderation and chargeback hardening

- Added booking-row-locked/idempotent dispute creation, active-case uniqueness, configurable filing/appeal/SLA windows, reopen/appeal finance re-holds and stale-resolution suppression.
- Added participant withdrawal, proposal accept/reject, appeal, comments and real post-case satisfaction tracking on the canonical dispute resource.
- Hardened participant/Admin evidence against real Latache-owned Cloudinary resources, protected dispute assets from independent deletion, added case-wide evidence caps and BullMQ reminder/overdue/expiry/SLA automation.
- Added workload-based Admin assignment and mandatory participant notification/email coverage for lifecycle actions, with `en`, `ar` and `ary` backend-generated email copy.
- Added idempotent warning strikes/disciplinary state with optional Admin-configured automatic suspension.
- Added auditable confirmed physical-cash refund obligations and proportional cash-commission receivable/reimbursement accounting without fabricating platform-held cash.
- Added verified Stripe `charge.dispute.*` ingestion, Finance chargeback view and Tasker-finance holds while provider disputes are active/lost. Provider-side chargeback contest/evidence submission and APNs/FCM remain intentionally unavailable until real operational/provider configuration exists.
- Added additive migration `20260818190000_harden_dispute_lifecycle`.
- Build, lint, tests and Prisma validation/generation were not run for this release at the requester's instruction.

# v3.21.1 — Postman/OpenAPI compatibility hotfix

- Fixed the invalid `GeneralSettingsDto.translations` OpenAPI array that omitted its required `items` schema and caused Postman's API import to fail with a generic unexpected error.
- Added the configured `APP_BASE_URL` as the OpenAPI server origin so generated clients use the correct local/staging/production host without duplicating `/api`.
- Added validator regression coverage, a directly importable Postman Collection v2.1 snapshot, a credential-free local environment, and setup documentation.
- No API route, database schema, migration, payment, referral, realtime, or RBAC behavior changed.

# v3.21.0 — Production referral qualification and rewards

- Added stable, high-entropy same-role referral codes and one locked attribution per referred Customer or Tasker.
- Snapshotted policy, currency, qualification thresholds, expiry, clearance, and benefit values so later setting changes cannot rewrite historical promises.
- Restricted qualification to verified Stripe success or an authoritative locked customer-wallet debit; cash bookings never qualify.
- Added capped referred-Customer discounts with minimum real-charge and qualifying-payment floors.
- Added pending Customer/Tasker wallet rewards, BullMQ clearance/expiry maintenance, active-dispute blocking, and idempotent ledger settlement.
- Added refund and RBAC-controlled Admin revocation clawbacks using immutable negative wallet entries and audit records.
- Added participant history/leaderboard APIs, Admin investigation APIs, localized notifications, and durable private `referral:updated` outbox events.
- Added additive migration `20260818140000_complete_referral_reward_system`; referral programs remain disabled with zero benefits until real commercial policy is configured.

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
