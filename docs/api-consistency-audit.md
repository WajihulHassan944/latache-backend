# API consistency audit — v3.13.0

This release audits the complete Latache API by domain ownership and role instead of adding endpoints per screen.

## Core rules

1. A business resource has one authoritative write surface.
2. Customer and Tasker share an API when the resource and lifecycle are genuinely the same; JWT identity/role scopes the result.
3. Super Admin/Admin management reuses the same underlying records and requires RBAC permissions; it does not create shadow copies.
4. Financial success is provider/ledger driven, never fabricated.
5. Realtime is a delivery channel for committed state, not a second business-logic path.
6. Private user data is not made admin-readable merely for symmetry. Admin access must have an operational reason and explicit permission.

## Canonical shared user resources

- `/api/dashboard/overview` — Customer/Tasker role-aware overview.
- `/api/services` and `/api/services/:serviceId` — public active catalogue managed by `services.manage` on the same resource.
- `/api/taskers` — public Tasker discovery; Tasker moderation remains `/api/admin/taskers`.
- `/api/bookings/*` — one Customer/Tasker booking/task lifecycle.
- `/api/disputes/*` — one Customer/Tasker dispute inbox/detail/evidence surface; Admin investigation uses `/api/admin/disputes/*`.
- `/api/conversations/*` — private booking conversations shared by Customer/Tasker.
- `/api/notifications/*` — one notification inbox for any authenticated identity.
- `/api/reviews/*` — one booking-backed Customer/Tasker review surface; public visibility is moderated through `/api/admin/reviews`.
- `/api/support/tickets/*` — one Customer/Tasker support surface; Admin queue/actions use `/api/admin/support/*`.

## Booking completeness

The booking resource supports quote, create, list, next, detail, confirmation, role-aware cancellation, reschedule, time extension, billing changes, navigation start/read, Tasker location, arrival, timer read/start/pause/resume/stop/notes, completion, and dispute creation. Payment finalization remains integrated with completion rather than a duplicate booking-payment endpoint.

## Dispute completeness

Participants have list, detail, open-dispute and evidence submission APIs. Admin has list/filter/detail and one action endpoint covering investigation, assignment, priority, escalation, evidence requests/review, resolution draft, final resolution/refund/warning, and reopen. Refund execution remains in the actual Stripe/customer-wallet payment layer.

## Admin-managed user-visible resources

- Services/sub-services: Admin/Super Admin `services.manage`.
- Tasker accounts/verification: `taskers.read/manage`.
- Customers: `customers.read/manage`.
- Bookings: `bookings.read/manage`.
- Disputes/support: `support.read/manage` plus `finance.manage` where money is changed.
- Reviews: `reviews.read/manage`.
- Finance: `finance.read/manage`.
- Platform policy: `settings.read/manage`.
- Elite Program: `elite.read/manage`.
- RBAC/Admin accounts: existing RBAC permissions.

Private favorites are deliberately not admin-managed. Private Customer/Tasker chat is not generally exposed to Admins; dispute/support evidence and support conversations provide the controlled operational review paths.

## Normalized routes in v3.12.0

Legacy-style service routes were removed:

- `GET /api/services/get-services` → `GET /api/services`
- `POST /api/services/add-service` → `POST /api/services`

Participant complaint terminology was removed from HTTP routes:

- booking complaint list → `GET /api/disputes?bookingId=:bookingId`
- create complaint → `POST /api/bookings/:bookingId/disputes`
- complaint evidence → `POST /api/disputes/:disputeId/evidence`

The database may retain historical `TaskComplaint` naming internally; the external API consistently calls the domain a dispute.

- Review creation generates a normal persisted `review_received` notification; no separate review-notification API or socket channel is maintained.

## Missing APIs added in v3.12.0

- `GET /api/realtime/session` — authenticated realtime transport/event contract.
- `GET /api/services/:serviceId` — canonical user-facing service detail for the same service resource managed by Admin/Super Admin.
- `GET /api/disputes` — Customer/Tasker dispute inbox.
- `GET /api/disputes/:disputeId` — Customer/Tasker dispute detail.
- `POST /api/bookings/:bookingId/disputes` — canonical participant dispute creation.
- `POST /api/disputes/:disputeId/evidence` — canonical participant evidence submission.
- `GET /api/admin/reviews` — permission-aware moderation queue for public reputation content.
- `PATCH /api/admin/reviews/:reviewId/moderation` — hide/restore without deleting author content.

No new HTTP endpoints were added for chat or notification writes. Their existing REST APIs remain authoritative; Socket.IO is the delivery/read-receipt/typing channel so realtime does not create a second source of business truth.

## Route audit

The v3.12.0 static route inventory contains 189 method/path pairs and all 189 are unique. The shared booking resource alone exposes 22 participant lifecycle operations, while Admin Booking Management intentionally uses list/detail plus one guarded action endpoint. Admin Dispute Management similarly uses list/detail plus one state-machine action endpoint so refund, evidence, escalation, assignment and resolution rules cannot drift across many mutation controllers.
