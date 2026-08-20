# API route inventory — v3.22.0

## v3.22 dispute lifecycle hardening

- Added `POST /api/disputes/:disputeId/actions` for participant withdraw, settlement response, appeal and dispute-thread comments.
- Added `POST /api/disputes/:disputeId/satisfaction` for persisted 1–5 post-case satisfaction.
- Existing `POST /api/bookings/:bookingId/disputes` now supports `Idempotency-Key`, filing-window enforcement and booking-row-locked active-case uniqueness.
- Existing `POST /api/disputes/:disputeId/evidence` now provider-verifies exact Latache Cloudinary assets and enforces case-wide caps.
- Existing `POST /api/admin/disputes/:id/actions` adds proposal/manual-cash-confirmation lifecycle actions and expanded notification/SLA behavior without adding a duplicate Admin resource.
- Existing `GET /api/admin/finance?view=chargebacks` exposes persisted Stripe provider disputes received from verified webhooks.
- Existing `GET/PUT /api/admin/platform-settings` owns dispute filing/SLA/evidence/assignment/email/moderation policy.

The v3.22.0 route count was not revalidated because validation commands were intentionally not run for this handoff. Swagger in `src/main.ts` is versioned 3.22.0 and remains the canonical machine-readable inventory after generation/startup.

## v3.21.1 Postman/OpenAPI compatibility

No routes changed. The OpenAPI schema now provides the missing translated-General-Settings array item model and the configured API server origin, allowing Postman to generate/import the same canonical route inventory.

## v3.21 referral qualification and reward accounting

- `GET /api/referrals/me` returns the authenticated Customer/Tasker code, active policy, received attribution, and real reward totals.
- `POST /api/referrals/claim` creates one same-role attribution before the first settled booking.
- `GET /api/referrals/history?view=invites|rewards` paginates invited participants or immutable reward states.
- `GET /api/referrals/leaderboard` returns masked qualified counts only when Admin enabled it.
- `GET /api/admin/referrals` and `GET /api/admin/referrals/:id` require `finance.read` and inspect the same records users/workers consume.
- `POST /api/admin/referrals/:id/revoke` requires `finance.manage`, a reason, atomic ledger reversal, and audit logging.
- Referral policy remains part of the canonical `GET/PUT /api/admin/platform-settings`; no duplicate settings resource was introduced.

## v3.20 production chat completion

- `GET /api/conversations/unread-count` returns the current participant's total unread private booking messages.
- `POST /api/conversations/:bookingId/messages` accepts `clientMessageId`; safe retries return the original message and conflicting reuse returns `409`.
- `POST /api/conversations/:bookingId/read` accepts optional `throughMessageId` for bounded read receipts.
- `GET /api/support/tickets/unread-count` returns unread public agent replies for the authenticated Customer or Tasker.
- `GET /api/support/tickets/capabilities` returns live-chat availability, attachment limits, idempotency fields, and realtime integration details.
- `GET /api/support/tickets/:id/messages` and `GET /api/admin/support/:id/messages` support cursor or page pagination and never expose internal notes to participants.
- `POST /api/support/tickets/:id/read` and `POST /api/admin/support/:id/read` persist audience-correct read receipts.
- Support ticket creation accepts `clientRequestId`; participant and Admin support messages accept `clientMessageId`.
- Upload APIs remain shared. Support and booking-chat references are now revalidated against Cloudinary ownership/context metadata before persistence, and a referenced chat asset cannot be independently deleted.

Customer–Tasker booking chat remains private. Admin and Super Admin participate only in support public replies and RBAC-controlled internal support notes; booking read permission does not grant private-chat access.

## v3.19 completion and authentication changes

`POST /api/bookings/:bookingId/complete` remains the single role-aware endpoint: a Tasker call submits completion for Customer review, while a Customer call approves it and starts payment finalization. Mature undisputed submissions are completed by the existing worker queue; no duplicate public route was added. Booking reads expose the persisted review deadline and approval actor.

Newly issued verification and password-reset OTPs are stored only as keyed hashes. Auth route names and frontend payloads are unchanged.

## v3.18 permanent deletion changes

- Added `DELETE /api/admin/customers/:id` with `customers.delete`.
- Added `DELETE /api/admin/taskers/:id` with `taskers.delete`.
- Existing `DELETE /api/rbac/admins/:id` is now an irreversible purge with `admins.delete`.
- Delete requests require `confirmation=PERMANENT_DELETE` and an audit reason; protected financial/shared records return `ACCOUNT_PURGE_BLOCKED`.
- Existing Service, Service Option, custom RBAC role, Elite badge, payout-method, and Tasker-skill DELETE routes now physically delete eligible records instead of writing a soft-delete state.

## v3.17 email and Darija changes

- No new or duplicate API routes were introduced.
- Existing registration/Admin-create requests and `PATCH /api/auth/me` accept `preferredLanguage=en|ar|ary`; `ary` is Moroccan Darija.
- Existing translated Service, Service Option, Elite, and public Platform Setting mutations accept `locale=ary` when it is enabled in `SUPPORTED_LOCALES`.
- All current transactional mail methods use the same responsive design shell and hosted Cloudinary artwork without SMTP image attachments.

## v3.16 performance changes

- No duplicate or replacement resource routes were introduced.
- `GET /api/notifications`, `GET /api/conversations/:bookingId/messages`, and `GET /api/tasker-dashboard/wallet/transactions` add optional `cursor` input plus `nextCursor`/`hasMore` output while retaining page/limit.
- `GET /api/health` now reports PostgreSQL, Redis, BullMQ worker/backlog, realtime outbox, cache, and process metric state.

This document highlights the canonical resource families after the consistency audit. Swagger remains the complete machine-readable inventory.

## Shared role-aware resources

- Dashboard: `/api/dashboard/*`
- Services: `/api/services/*`
- Tasker discovery: `/api/taskers/*`
- Bookings/tasks: `/api/bookings/*`
- Participant disputes: `/api/disputes/*` plus dispute creation under a booking
- Conversations: `/api/conversations/*`
- Notifications: `/api/notifications/*`
- Reviews: `/api/reviews/*`
- Support: `/api/support/*`
- Realtime contract: `/api/realtime/session` + Socket.IO namespace `/realtime`

## Booking lifecycle coverage

`/api/bookings` covers quote, create, list, next, detail, confirm, cancel, reschedule, extend, billing changes, navigation start/read, Tasker live location, arrival, timer read/start/pause/resume/stop/notes, Tasker completion submission, Customer approval/automatic undisputed completion, cash-payment confirmation and dispute creation.

Admin Booking Management is `/api/admin/bookings`: one filtered list/export, one complete detail response and one exceptional action endpoint. Paid/disputed lifecycle correction goes through Dispute Management instead of bypassing finance.

## Dispute lifecycle coverage

Participants can list, inspect, open, submit verified evidence, comment, withdraw, respond to proposed settlements, appeal and submit post-case satisfaction. Admin uses `/api/admin/disputes` for queue/filter/detail and one guarded action state machine covering investigation, assignment, priority, escalation, evidence requests/review, resolution drafts/proposals, provider-backed refunds, auditable manual-cash refund confirmation, warning/dismissal and reopen.

## User-visible data vs management

- Service catalogue/sub-services → managed with `services.manage` on `/api/services`.
- Tasker identity/verification → `/api/admin/taskers`.
- Customer accounts → `/api/admin/customers`.
- Bookings → `/api/admin/bookings`.
- Disputes → `/api/admin/disputes`.
- Public reviews → `/api/admin/reviews` moderation.
- Support → `/api/admin/support`.
- Finance/payouts → `/api/admin/finance`.
- Platform policy → `/api/admin/platform-settings`.
- Elite program → `/api/admin/elite-taskers`.
- Roles/admin access → `/api/rbac` and canonical Auth admin registration.

## v3.14 financial additions

- Tasker earning clearance: `GET /api/tasker-dashboard/wallet/earnings`
- Tasker cash platform payables: `GET /api/tasker-dashboard/wallet/platform-payables`
- Tasker cash confirmation: `POST /api/bookings/:bookingId/cash-payment/confirm`
- Admin earning/receivable views: `GET /api/admin/finance?view=earnings|cash_receivables`
- Admin pending-earning hold action: `POST /api/admin/finance/earnings/:id/actions`
- Finance policy remains unified under `GET/PUT /api/admin/platform-settings` section `taskerFinance`.

Private favorites and booking chat are intentionally not general Admin resources. Their privacy boundary is not weakened merely to make APIs symmetrical.

## v3.15 localization changes

- `PATCH /api/auth/me` accepts `preferredLanguage=en|ar|ary`.
- `GET /api/services*`, `GET /api/taskers*`, `GET /api/tasker-dashboard/elite`, and `GET /api/notifications` honor centralized locale resolution.
- Existing `POST/PATCH /api/services*` mutations accept `translations[]`; `/api/admin/services*` returns all translations.
- Existing `/api/admin/elite-taskers/program*` resources manage and return all Elite translations.
- Existing `GET/PUT /api/admin/platform-settings` manages localized general public content.
- `GET /api/platform/content` is the only new public content read and uses that same Platform Setting.

No translation-only Service, booking, notification, finance, or support resource was introduced.

## v3.13 conversation media additions

- Capability discovery: `GET /api/conversations/capabilities`
- Call history: `GET /api/conversations/:bookingId/calls`
- Call detail: `GET /api/conversations/:bookingId/calls/:callId`
- Attachment upload remains unified through `POST /api/uploads/single` and `POST /api/uploads/multiple` with `folder=conversation-attachments`.
- Voice/video signaling remains on the existing Socket.IO namespace `/realtime`; it does not introduce duplicate REST mutation endpoints.
