# Admin Booking & Dispute Management

The Admin booking/dispute design is implemented as views and actions over canonical booking/payment/dispute resources. v3.22.0 extends the existing dispute state machine; it does not create parallel Customer/Tasker/Admin complaint resources.

## Permissions

- `bookings.read`: booking list/details.
- `bookings.manage`: exceptional non-financial booking cancellation.
- `reports.read`: additionally required for CSV exports.
- `support.read`: dispute queues/details.
- `support.manage`: investigation, assignment, evidence, settlement proposal and non-financial resolution mutations.
- `finance.manage`: additionally required for refund execution/manual cash-refund confirmation.
- Super Admin bypasses permission checks.

## Booking Management

One list endpoint powers booking tabs:

```text
GET /api/admin/bookings?view=all|pending|accepted|in_progress|completed|cancelled|disputed
GET /api/admin/bookings/:id
POST /api/admin/bookings/:id/actions
```

`accepted` maps to canonical `confirmed`. `disputed` is derived from unresolved complaints and is not a second booking status. Paid/refunded bookings and bookings with active disputes cannot bypass the dispute/refund flow.

## Dispute Management

```text
GET  /api/admin/disputes?view=open|under_investigation|escalated|resolved|evidence_review|resolution_actions|all
GET  /api/admin/disputes/:id
POST /api/admin/disputes/:id/actions
```

The same action endpoint supports:

- `start_investigation`
- `assign`
- `set_priority`
- `escalate`
- `request_evidence`
- `add_evidence`
- `review_evidence`
- `save_resolution_draft`
- `propose_resolution`
- `resolve`
- `confirm_cash_refund`
- `reopen`

Admin detail includes lifecycle/SLA timestamps, normalized evidence/request state, proposals, participant actions/comments, satisfaction, durable delivery state, manual cash refunds, disciplinary actions and linked Stripe chargebacks.

Satisfaction metrics are now calculated from persisted 1–5 `DisputeSatisfactionSurvey` rows. A percentage/rating is never fabricated when no responses exist.

## Participant lifecycle

```text
GET  /api/disputes
GET  /api/disputes/:disputeId
POST /api/bookings/:bookingId/disputes
POST /api/disputes/:disputeId/evidence
POST /api/disputes/:disputeId/actions
POST /api/disputes/:disputeId/satisfaction
```

Creation locks the Booking before TaskComplaint, applies the configured filing window, supports `Idempotency-Key`, and enforces a single new active case per booking. Participant actions support filer withdrawal, settlement accept/reject, appeal and immutable dispute-thread comments. An appeal reopens the same case and reapplies financial holds. Closed-case satisfaction may be created/updated by each booking participant.

## Evidence flow

Files must first be uploaded with the shared `booking-attachments` upload category. Participant and Admin evidence references are then verified against the actual Cloudinary resource: actor-owned Latache namespace, exact public ID, exact secure URL, Cloudinary context metadata, resource type and mime type. Arbitrary HTTPS evidence URLs are rejected.

Referenced `DisputeEvidence` and legacy complaint attachments are protected from independent upload deletion. Case-wide evidence item/byte limits are enforced in addition to per-request limits.

Evidence request deadlines must be in the future. The dispute BullMQ maintenance job sends reminders, marks overdue requests, expires/escalates them after policy grace, and escalates cases that exceed the case SLA.

## Assignment and notifications

When enabled in Platform Settings, new disputes use workload-based assignment to the least-loaded active Admin/Super Admin with effective `support.manage`. Investigation start, assignment, priority, escalation, evidence lifecycle, settlement lifecycle, reopen/appeal and closure notify participants through persisted notifications + transactional realtime outbox. Dispute-specific email is queued durably and delivered by the worker in `en`, `ar` or `ary` for backend-generated lifecycle copy.

APNs/FCM is not configured. `disputes.mobilePushEnabled=true` is rejected rather than pretending a push was sent.

## Settlement and payment invariants

A proposed settlement is participant consent only; it does not move money. Applying a refund still requires `finance.manage` and the real payment path.

For Stripe/customer-wallet payments:

1. lock authoritative booking/dispute/payment state;
2. validate the remaining refundable amount;
3. persist an idempotent resolution/refund transaction;
4. execute the real provider/wallet refund;
5. keep the dispute active while provider state is pending;
6. apply the Tasker earning adjustment exactly once after real success;
7. close/audit/notify only after settlement succeeds.

For confirmed physical cash, the platform cannot reverse money that was handed directly to the Tasker. The resolution creates `pending_manual_transfer`. Only an authorized Admin confirmation with a real transfer reference and notes records the refund as confirmed and performs the proportional platform-commission receivable accounting. The physical cash amount itself never appears as platform-held Tasker wallet money.

## Reopen and multi-hold behavior

Admin reopen and participant appeal restore `activeBookingKey`, reset stale final-result state/SLA state, and explicitly re-block Tasker finance. Participant detail does not surface an old applied resolution as the current result after reopen.

Release/unblock paths recheck all active internal disputes plus active/lost Stripe chargebacks. Legacy multiple-active-dispute data therefore continues to hold finance until every valid hold is closed.

## Stripe provider chargebacks

The verified Stripe webhook now handles:

```text
charge.dispute.created
charge.dispute.updated
charge.dispute.closed
```

Provider disputes are persisted separately from Latache complaints and exposed through:

```text
GET /api/admin/finance?view=chargebacks
```

Active/lost provider disputes block Tasker finance. A real Stripe `lost` event is recorded for manual financial review; the backend does not fabricate provider recovery or a Tasker clawback. Provider-side contest/evidence-submission automation is intentionally not claimed.

## Platform settings

Dispute policy is managed through the existing canonical Platform Settings resource (`sections=disputes`). See `docs/dispute-lifecycle-hardening.md` for defaults and operational behavior.

## Migration

Apply the original normalized dispute migration plus the new additive hardening migration in normal migration order. The new release migration is:

```text
20260818190000_harden_dispute_lifecycle
```

It contains no operational seed data and does not delete/rewrite booking/payment history.
