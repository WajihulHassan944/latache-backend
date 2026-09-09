# Stripe and customer payment flow

## Configuration

```env
STRIPE_ENABLED=false
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
PAYMENTS_CURRENCY=USD
PAYMENTS_PLATFORM_FEE_PERCENT=0
BOOKING_MINIMUM_BILLABLE_MINUTES=120
CUSTOMER_WALLET_MIN_TOPUP=5
```

Set `STRIPE_ENABLED=true` only after real Stripe keys and the webhook secret are configured.

## Saved card flow

```text
POST /api/payments/setup-intent
frontend confirms SetupIntent with Stripe SDK
GET  /api/payments/methods
PATCH /api/payments/methods/:id/default
```

Creating a SetupIntent does not claim a successful payment. Booking creation validates that the selected PaymentMethod belongs to the authenticated Stripe Customer.

## Booking settlement

A booking stores the payment source but is not marked paid during booking creation.

```text
Tasker stops timer
  -> Tasker completes booking
  -> backend calculates billable duration from persisted work session
  -> open dispute? hold payment
  -> exceeded customer-authorized duration? review_required_duration_exceeded
  -> wallet source: serializable/locked ledger debit
  -> Stripe source: real off-session PaymentIntent
  -> verified succeeded state/webhook
  -> booking paid
  -> Tasker earning created once as pending
  -> mature, undisputed earning released by the database-safe worker
```

Tasker earning excludes Latache platform fee and donation amount. It is not withdrawable until the configured clearance timestamp. Outstanding cash platform payables are offset before the release remainder becomes available.

## Duration-exceeded review

If the actual worked time (persisted timer minus paused time) exceeds `estimatedDurationMinutes + extensionMinutes`, `finalizeCompletedBooking()` never charges automatically. The booking is left `completed` with `paymentStatus = review_required_duration_exceeded`; no Stripe charge, wallet debit, or Tasker earning is created while it stays in this state.

```text
POST /api/bookings/:bookingId/duration-review/approve
```

Customer-only. Re-reads the persisted work session (never a client-supplied duration), raises `extensionMinutes` to cover the actual worked time, resets `paymentStatus` to `ready`, and immediately re-attempts `finalizeCompletedBooking()`. To reject the extra time instead, the customer opens a dispute through the existing `POST /api/bookings/:bookingId/disputes`, which independently holds payment via `on_hold_dispute`.

## Retrying a failed booking charge

```text
POST /api/payments/bookings/:bookingId/retry
```

A synchronously declined off-session charge leaves the booking's PaymentIntent in `requires_payment_method`. Retrying — with the same card once the decline reason is resolved, or with a new `paymentMethodId` — re-confirms that *same* PaymentIntent (`stripe.paymentIntents.confirm`) rather than creating a second one, which is Stripe's documented recovery pattern for a failed off-session attempt. The per-booking idempotency key used for the original `PaymentIntent.create` call stays fixed and is never reused for retries, so a retry is never served a stale cached decline response; a concurrent duplicate retry cannot double-charge because Stripe only allows one confirmation to succeed per PaymentIntent.

## Pending-booking expiration

A booking a Tasker never confirms or rejects does not stay `pending` forever. See `booking-pending-expiration.md`.

## Stripe webhook

```text
POST /api/payments/webhooks/stripe
```

The handler verifies the `Stripe-Signature` against the raw request body and configured endpoint secret. Webhook event IDs are persisted for deduplication.

Customer wallet top-ups do not increase the wallet when the PaymentIntent is merely created. The wallet is credited only after verified `payment_intent.succeeded` processing.

Webhook replay cannot duplicate an earning: Stripe event IDs and booking earning uniqueness are both persisted. A synchronously returned succeeded PaymentIntent is reconciled through the same idempotent settlement path before the API returns; its later webhook is a no-op reconciliation.

## Dispute refunds

Dispute refunds are initiated only by `POST /api/admin/disputes/:id/actions` with a refund resolution and require `finance.manage` in addition to `support.manage`.

For Stripe-settled bookings the backend creates an idempotent Stripe Refund against the original PaymentIntent. Provider `pending`/`requires_action` states remain processing; the dispute is marked resolved only after a succeeded refund is reconciled.

Configure the Stripe endpoint for `refund.created`, `refund.updated`, and `refund.failed` in addition to the existing PaymentIntent events. Customer-wallet refunds use the internal wallet ledger and do not call Stripe.

Pending earnings are reduced before available balance. If the earning was already released, the existing Tasker wallet clawback/negative-balance accounting applies only to the attributable released portion.
