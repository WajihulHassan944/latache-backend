# Booking completion approval

## Lifecycle

1. The Tasker stops the persisted work timer and calls `POST /api/bookings/:bookingId/complete`.
2. The booking becomes `awaiting_customer_approval`, with `completionSubmittedAt` and `completionApprovalDueAt`. No payment, cash receivable, Tasker earning, or completed-task counter is created at this point.
3. The Customer calls the same endpoint to approve. The booking becomes `completed`, the Tasker counter increments once, and existing genuine Stripe/customer-wallet/cash finalization runs.
4. If the Customer does nothing, the BullMQ `bookings.auto-complete` job locks the mature row and completes it after the configured review window. Any open, under-investigation, or escalated dispute blocks this transition.
5. Online settlement still creates the existing 14-day pending earning. Cash still requires the Tasker to confirm physical collection and creates only the existing platform receivable.

The default review window is 24 hours, chosen for an on-demand service workflow and configurable through Admin Platform Settings (`bookingRules.completionApprovalHours`) or the environment default `BOOKING_COMPLETION_APPROVAL_HOURS`. Updating the policy affects future submissions; each submission keeps its own immutable deadline.

## Multi-instance safety

The worker uses the existing BullMQ maintenance queue for scheduling and PostgreSQL `FOR UPDATE` locks for authoritative state. Redis transports work but is never the booking/payment source of truth. Repeated workers see `completed` and do not increment the Tasker counter or emit completion notifications again. Existing payment idempotency handles provider retries.

Run the production API and worker topology documented in `performance-architecture.md`. If the required queue is down, `/api/health` remains unhealthy instead of pretending automatic approval is operating.

## Configuration

- `BOOKING_COMPLETION_APPROVAL_HOURS=24` (1–168; Admin setting can override future submissions)
- `BOOKING_COMPLETION_SWEEP_INTERVAL_MS=60000`
- `BOOKING_COMPLETION_BATCH_SIZE=100`
- `OTP_HASH_SECRET` independent random secret of at least 32 characters in staging/production

Apply migrations with `npm run prisma:migrate:deploy`; never reset the production database.
