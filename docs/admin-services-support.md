# Service Management and Support Center

## Scope

This release implements the Service Management and Support Center screens without creating duplicate business domains.

### Service catalogue

- `Services` is the canonical service-category table.
- `ServiceOptions` are persistent sub-services/booking options.
- `UserServices` remains the only Tasker-to-service assignment/rate source.
- Soft deactivation hides a category/sub-service from future discovery and booking while preserving historical bookings.
- `GET /api/admin/services?view=catalog` powers Service Management summary/cards.
- `GET /api/admin/services/:serviceId` returns the complete category, sub-services, active approved Taskers and booking usage.
- Existing `/api/services/*` mutations remain canonical; no second admin catalogue CRUD family was introduced.

### Pricing

`GET /api/admin/services?view=pricing` is an aggregate/read model over the existing Platform Settings and Elite Program. It does not create a second pricing engine.

- Commission/tax mutations: `PUT /api/admin/platform-settings`
- Elite program rules: `/api/admin/elite-taskers/program/*`
- Per-tier minimum task price is enforced in both quote and final charge.
- Same-day/weekend values are platform-fee surcharges, not fabricated customer-price multipliers.
- Emergency booking and booking-priority routing are reported as unavailable until corresponding runtime flows exist.

## Shared Support API

Customer and Tasker use the same persisted support resource:

- `POST /api/support/tickets`
- `GET /api/support/tickets`
- `GET /api/support/tickets/:id`
- `GET /api/support/tickets/:id/messages`
- `POST /api/support/tickets/:id/messages`
- `POST /api/support/tickets/:id/actions`
- `POST /api/support/tickets/:id/feedback`

`channel=ticket` and `channel=live_chat` are two views of the same case resource. Live chat is persistence-first HTTP messaging; no fake WebSocket presence/online status is returned.

Optional booking, payment transaction and Tasker withdrawal references are ownership-validated. Attachments use the existing Cloudinary upload API with `folder=support-attachments`.

## Admin Support Center

One filtered queue powers the design tabs:

`GET /api/admin/support?view=support_tickets|customer_issues|tasker_issues|escalated|live_chat|reports`

Further routes:

- `GET /api/admin/support/:id`
- `GET /api/admin/support/:id/messages`
- `POST /api/admin/support/:id/messages`
- `POST /api/admin/support/:id/actions`

Admin actions support assignment, unassignment, work start/waiting state, priority, escalation, resolution, close and reopen.

Financial operations are intentionally not executed from Support Center:

- Booking refunds remain in Dispute Management.
- Tasker payout settlement remains in Finance.
- Support resolution records only the support outcome and can reference the real financial record.

## Reporting

Resolution reports are derived only from persisted tickets/messages:

- active/waiting/escalated counts
- resolved in the last 24 hours
- average resolution time
- average first response time
- daily resolution counts
- category breakdown
- top agents
- CSAT only from submitted 1-5 feedback
- first-contact-resolution using the documented rule: resolved without reopen and at most one public administrator response

CSV uses the same reports view and additionally requires `reports.read`.

## RBAC

No new RBAC system is introduced. Existing permissions are authoritative:

- `services.read`
- `services.manage`
- `support.read`
- `support.manage`
- `reports.read` for Support CSV reports

Super Admin continues to bypass permission checks through the existing guard behavior.
