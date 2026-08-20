# Dispute lifecycle hardening — v3.22.0

Version 3.22.0 hardens the existing `TaskComplaint` resource instead of introducing a second complaint/dispute API. PostgreSQL remains authoritative for dispute, payment, earning, receivable, disciplinary and delivery state. Provider outcomes are recorded only after verified provider events or an auditable manual confirmation.

## Participant lifecycle

Canonical participant routes remain under the shared booking/dispute resource:

```text
GET  /api/disputes
GET  /api/disputes/:disputeId
POST /api/bookings/:bookingId/disputes
POST /api/disputes/:disputeId/evidence
POST /api/disputes/:disputeId/actions
POST /api/disputes/:disputeId/satisfaction
```

`POST /api/bookings/:bookingId/disputes` accepts the optional `Idempotency-Key` header. The booking row is locked before dispute creation, retries are replay-safe, and only one active dispute may exist for a booking. New disputes must be filed after recorded service completion and before the configured filing deadline.

Participant actions are persisted as immutable case history:

- `comment`
- `withdraw` — only the filer; not permitted while an approved refund is executing
- `accept_proposal`
- `reject_proposal`
- `appeal` — within the configured appeal window; reopens the case and reapplies financial holds

Satisfaction uses a real 1–5 persisted survey after case closure. Admin metrics aggregate those records and no longer fabricate or suppress satisfaction availability.

## Active-case uniqueness and idempotency

Every newly opened/reopened/appealed active case gets `activeBookingKey=booking:<bookingId>`, backed by a unique PostgreSQL index. Application transactions also lock the booking and check active complaints before writes. The migration deliberately does not backfill this key on historical complaints because a production database may already contain legacy duplicate active cases; forcing a backfill could make deployment fail. Legacy duplicates continue to preserve finance holds until all active cases are closed.

`clientRequestKey` is unique per filer when an explicit `Idempotency-Key` is supplied. Reusing that key for the same filing returns the existing dispute; reuse for another booking is rejected. When the header is omitted, booking-row locking plus active-case uniqueness still prevents duplicate active disputes, without permanently fingerprinting the complaint body and blocking a later legitimate filing.

## Configurable dispute policy

Dispute policy is part of the existing Platform Settings resource:

```text
GET /api/admin/platform-settings?sections=disputes
PUT /api/admin/platform-settings
```

Defaults:

- filing window: 72 hours after recorded service completion
- appeal window: 72 hours after closure
- case SLA: 72 hours
- settlement response: 48 hours
- evidence response: 48 hours
- evidence reminder: 24 hours before due
- evidence expiry/escalation: 24 hours overdue
- total evidence cap: 30 items / 50 MiB known bytes
- workload-based automatic assignment: enabled
- dispute lifecycle email: enabled
- mobile push: disabled until a real APNs/FCM provider exists
- automatic account suspension: disabled by default
- warning strike: 1 point
- suspension threshold: 3 points

`mobilePushEnabled=true` is rejected while APNs/FCM is unconfigured. This prevents a cosmetic setting from pretending that mobile push delivery exists.

## Evidence integrity and SLA automation

Dispute evidence must be uploaded through the existing Latache `booking-attachments` Cloudinary namespace. Both participant and Admin submissions are revalidated against Cloudinary before persistence:

1. actor-owned Latache `publicId` namespace;
2. exact resource existence through Cloudinary Admin API;
3. persisted Cloudinary context ownership/folder/mime metadata;
4. exact resource type;
5. exact `secure_url` equality;
6. per-file/request limits and case-wide item/byte caps.

The generic upload deletion endpoint now refuses deletion when an asset is referenced by normalized `DisputeEvidence` or legacy complaint attachments, in addition to chat/support history.

Past Admin evidence deadlines are rejected. The existing BullMQ worker periodically performs dispute maintenance: reminders, `pending -> overdue`, overdue expiry/escalation, case-SLA escalation, and durable dispute-email retries. A stale `sending` email lease is reclaimable after ten minutes so a worker crash cannot strand the delivery forever.

New runtime setting:

```text
DISPUTE_WORKER_POLL_MS=60000
```

Production still requires Redis/jobs/worker configuration already documented for v3.21.1.

## Assignment, Admin actions and notifications

New cases are assigned to the least-loaded active Admin/Super Admin with effective `support.manage` access when auto-assignment is enabled. Assignment, priority changes, investigation start, escalation, evidence lifecycle, reopen/appeal, settlement lifecycle and closure generate persisted notifications plus transactional realtime outbox events. Dispute lifecycle email is durably queued in PostgreSQL and sent by the job worker.

Backend-generated notification/email copy supports `en`, `ar` and `ary`. User/Admin-authored evidence messages, comments, resolution summaries and notes remain in their original language and are never machine-translated.

## Settlement proposals

Admin can use the existing action endpoint with `action=propose_resolution`. Participants may accept or reject an active proposal before its deadline. Both participant acceptances set the proposal to `accepted`, but acceptance does **not** move money. An authorized Admin/Finance resolution still executes the existing provider-backed refund path or creates the manual-cash transfer obligation.

## Reopen and appeal financial safety

Reopen/appeal transitions lock Booking before TaskComplaint, restore `activeBookingKey`, reset stale final-result fields/SLA state, reapply the booking hold where applicable and explicitly block Tasker earning/cash-receivable release. Participant detail exposes an applied final resolution only while the current case is actually closed, so reopened cases do not show the previous result as current.

Tasker earning release and manual unblocking check both active internal disputes and active/lost Stripe chargebacks. One closed internal dispute never releases finance while another valid hold remains.

## Physical-cash refunds

Latache cannot automatically reverse cash that the Customer already handed directly to the Tasker. For a confirmed-cash booking, a refund resolution therefore creates a persisted `DisputeCashRefund` with `pending_manual_transfer`. It is not recorded as successful until a `finance.manage` Admin confirms a real transfer reference and explanatory notes.

After confirmation:

- an immutable `cash_manual` refund transaction records the already-completed external transfer;
- booking refund totals/status are updated;
- the proportional outstanding cash commission receivable is reversed;
- if the Tasker already paid part of that commission to Latache, only that settled commission portion is reimbursed to the Tasker wallet through an idempotent ledger adjustment;
- the physical cash refund amount itself is never credited as platform-held wallet money;
- other active internal/provider holds remain in force.

## Warning strikes and moderation

Warning outcomes create idempotent `DisciplinaryAction` records, increment `User.disputeStrikePoints` and transition the disciplinary state (`clear -> warned -> at_risk`). Optional automatic suspension can be enabled through Platform Settings; it is disabled by default. When enabled and the configured threshold is reached, the account is suspended and active refresh tokens are revoked transactionally. Every action remains Admin-audited.

## Stripe chargebacks

Stripe card-network disputes remain separate from Latache participant complaints. Verified Stripe webhook handling now persists `charge.dispute.created`, `charge.dispute.updated` and `charge.dispute.closed` into `StripeChargeback` records and links them to the booking when possible.

Admin Finance exposes them through the existing resource:

```text
GET /api/admin/finance?view=chargebacks
```

Active provider disputes block Tasker finance release. A Stripe `lost` state remains blocked for financial review and records an idempotent provider chargeback transaction based on the real webhook; it does not fabricate a Tasker clawback or provider recovery. `won`/`warning_closed` only unblocks after all internal/provider holds are rechecked.

This release does not fabricate an automated Stripe evidence-submission/contest workflow. Operational chargeback evidence/contest policy must be authorized before provider-side write actions are added.

## Migration

Apply the additive migration:

```text
20260818190000_harden_dispute_lifecycle
```

It adds lifecycle/idempotency/SLA fields and normalized participant-action, comment, satisfaction, delivery, cash-refund, disciplinary and Stripe-chargeback tables/indexes. It does not delete or rewrite existing booking/payment/dispute history.

## Validation note

Build, lint, tests, Prisma generation/validation and the project static verifier were intentionally **not run for v3.22.0 at the requester's instruction**. Run the commands in `VERIFICATION.json` before deployment.

## v3.24.0 completion audit

- Proposed settlements with an elapsed `proposalResponseDueAt` are expired automatically by the existing dispute maintenance job.
- Withdrawing an active dispute cancels any still-proposed settlement resolution before the finance hold is released.
- Participant and Admin evidence submissions de-duplicate already-persisted verified Cloudinary public IDs under the locked dispute; duplicate retries do not consume the total evidence cap or fulfill an evidence request without new evidence.
