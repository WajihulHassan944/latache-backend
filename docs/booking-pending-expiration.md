# Pending booking expiration

## Lifecycle

1. A Customer creates a booking (`POST /api/bookings`). `book()` never charges Stripe, debits the wallet, or holds cash at this point — it only stores the selected payment source/method. The booking starts `pending`.
2. If the Tasker confirms (`POST /api/bookings/:bookingId/confirm`) or either participant cancels first, the booking leaves `pending` normally and is never touched by expiration.
3. If neither happens, the BullMQ `bookings.expire-pending` job locks the mature row (`FOR UPDATE`, same pattern as `bookings.auto-complete`) and, only if it is still `pending`, transitions it to `cancelled` with `cancelledByRole: 'system'` and a `cancellationReason` explaining the automatic expiration.
4. Because a pending booking was never charged, expiring it is a plain cancellation: the held `UserAvailability` slot is released (`isBooked: false`) so it becomes bookable again, and any referral discount reservation is released defensively (in practice a pending booking never has one — discounts are only reserved during final settlement). No Stripe charge, refund, or wallet movement is ever created by this path.
5. Both the Customer and Tasker are notified (`booking_expired_no_response`), and an `AdminAuditLog` row (`booking_expired_no_response`) is recorded.

## Multi-instance safety

Two BullMQ workers sweeping at the same time, or a sweep racing a Tasker's `POST .../confirm` call, resolve through the same PostgreSQL row lock every other booking transition already uses: whichever transaction commits first wins, and the other observes the already-updated `status` and no-ops. This is the same pattern `autoCompleteDueBookings()`/`autoApproveOne()` already use for the completion-approval sweep.

## Configuration

- `BOOKING_PENDING_EXPIRY_MINUTES=60` — how long a booking may stay `pending` before it is eligible for expiration.
- `BOOKING_EXPIRATION_SWEEP_INTERVAL_MS=60000` — how often the BullMQ scheduler enqueues the sweep.
- `BOOKING_EXPIRATION_BATCH_SIZE=100` — maximum bookings examined per sweep tick.

Run the production API and worker topology documented in `performance-architecture.md`; the sweep only runs when the BullMQ worker/scheduler are enabled (`JOBS_ENABLED`, `JOB_WORKER_ENABLED`, `JOB_SCHEDULER_ENABLED`).
