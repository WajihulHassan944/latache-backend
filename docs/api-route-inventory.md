# API route inventory — v3.18.0

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

`/api/bookings` covers quote, create, list, next, detail, confirm, cancel, reschedule, extend, billing changes, navigation start/read, Tasker live location, arrival, timer read/start/pause/resume/stop/notes, completion, cash-payment confirmation and dispute creation.

Admin Booking Management is `/api/admin/bookings`: one filtered list/export, one complete detail response and one exceptional action endpoint. Paid/disputed lifecycle correction goes through Dispute Management instead of bypassing finance.

## Dispute lifecycle coverage

Participants can list, inspect, open and submit evidence to disputes. Admin uses `/api/admin/disputes` for queue/filter/detail and one guarded action state machine covering investigation, assignment, priority, escalation, evidence requests/review, resolution drafts, refund/warning/dismissal and reopen.

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
