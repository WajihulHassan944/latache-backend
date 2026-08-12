# Admin Booking & Dispute Management

Version 3.9 adds permission-aware booking and dispute operations for Super Admin and delegated Admin users. The design screens are treated as views over canonical backend resources, not as reasons to create one API per tab.

## Permissions

- `bookings.read`: booking list/details.
- `bookings.manage`: exceptional non-financial booking cancellation.
- `reports.read`: additionally required when `GET /api/admin/bookings?format=csv` is used.
- `support.read`: dispute queues/details.
- `support.manage`: investigation/evidence/resolution mutations.
- `finance.manage`: additionally required when a dispute resolution creates a refund.
- `super_admin`: bypasses permission checks.

## Booking Management

One list endpoint powers every booking tab and the summary cards:

```text
GET /api/admin/bookings?view=all
GET /api/admin/bookings?view=pending
GET /api/admin/bookings?view=accepted
GET /api/admin/bookings?view=in_progress
GET /api/admin/bookings?view=completed
GET /api/admin/bookings?view=cancelled
GET /api/admin/bookings?view=disputed
```

`accepted` maps to the canonical booking status `confirmed`. `disputed` is derived from unresolved complaint records and is not another booking status.

Supported filters include search, service/customer/tasker, payment status, date range and sort. `format=csv` exports the same filtered resource without a second report endpoint.

```text
GET  /api/admin/bookings/:id
POST /api/admin/bookings/:id/actions
```

The only direct admin booking action in this phase is safe cancellation. Paid/refunded bookings and bookings with an active dispute cannot bypass the dispute/refund flow.

The previous semantic duplicate `GET /api/admin/customers/bookings` has been removed. Per-customer drill-down remains available as `GET /api/admin/customers/:id/bookings`.

## Dispute Management

One queue endpoint powers every design tab:

```text
GET /api/admin/disputes?view=open
GET /api/admin/disputes?view=under_investigation
GET /api/admin/disputes?view=escalated
GET /api/admin/disputes?view=resolved
GET /api/admin/disputes?view=evidence_review
GET /api/admin/disputes?view=resolution_actions
GET /api/admin/disputes?view=all
```

The response contains real queue metrics from persisted complaints and resolutions. Post-dispute satisfaction is explicitly unavailable until a survey/event source exists; no percentage is fabricated.

```text
GET  /api/admin/disputes/:id
POST /api/admin/disputes/:id/actions
```

The single mutation endpoint supports:

- `start_investigation`
- `assign`
- `set_priority`
- `escalate`
- `request_evidence`
- `add_evidence`
- `review_evidence`
- `save_resolution_draft`
- `resolve`
- `reopen`

Admins may save a refund resolution draft with `support.manage`, but applying it also requires `finance.manage`. This allows support and finance responsibilities to remain separable.

## Evidence flow

Customer and Tasker evidence is part of the shared booking/dispute resource:

```text
GET  /api/disputes?bookingId=:bookingId
POST /api/bookings/:bookingId/disputes
POST /api/disputes/:disputeId/evidence
```

Files are first uploaded through the existing Cloudinary `booking-attachments` upload category. The participant evidence endpoint accepts the returned Cloudinary metadata and verifies that the `publicId` belongs to the authenticated account namespace and that the URL belongs to the configured Cloudinary account.

When an admin requests evidence from both parties, two persisted evidence requests are created so Customer and Tasker responses can be tracked independently. Evidence shown to a participant is restricted to their own uploads plus requests addressed to their role; admin review notes and the other party's evidence are not leaked.

## Resolution and payment invariants

A resolution with no refund closes/dismisses the complaint and releases any pre-settlement payment hold. If a completed booking was held before payment, normal final-payment orchestration can then resume.

A refund resolution is different:

1. Lock the complaint/booking and verify remaining refundable amount.
2. Persist a resolution and idempotent refund transaction.
3. For a customer-wallet payment, credit the real customer wallet ledger transactionally.
4. For a Stripe payment, create a real Stripe Refund against the persisted PaymentIntent.
5. Keep pending/provider-processing refunds unresolved until provider state confirms success.
6. After successful settlement, update booking refund state and apply the proportional Tasker earning reversal exactly once.
7. Mark the dispute resolved, audit the action and notify the parties only after the refund has actually settled.

A booking becomes `partially_refunded` or `refunded` based on succeeded refund transactions. Failed/pending refund attempts are never represented as successful refunds.

For Stripe, configure the existing webhook endpoint to receive at least:

```text
payment_intent.succeeded
payment_intent.payment_failed
refund.created
refund.updated
refund.failed
```

Webhook IDs remain persisted for deduplication and signatures are verified against the raw body.

## Migration

Apply:

```text
20260810130000_add_booking_dispute_management
```

The migration extends `TaskComplaints` and adds normalized evidence/request/resolution tables. It performs no demo inserts and does not rewrite booking/payment history.

### Evidence queue default

Complaints without submitted/requested evidence start with `evidenceReviewStatus=not_required`. They enter Evidence Review only when evidence exists or an administrator requests more evidence.
