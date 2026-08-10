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
  -> Tasker earning credited once
```

Tasker earning excludes Latache platform fee and donation amount.

## Stripe webhook

```text
POST /api/payments/webhooks/stripe
```

The handler verifies the `Stripe-Signature` against the raw request body and configured endpoint secret. Webhook event IDs are persisted for deduplication.

Customer wallet top-ups do not increase the wallet when the PaymentIntent is merely created. The wallet is credited only after verified `payment_intent.succeeded` processing.

## Dispute refunds

Dispute refunds are initiated only by `POST /api/admin/disputes/:id/actions` with a refund resolution and require `finance.manage` in addition to `support.manage`.

For Stripe-settled bookings the backend creates an idempotent Stripe Refund against the original PaymentIntent. Provider `pending`/`requires_action` states remain processing; the dispute is marked resolved only after a succeeded refund is reconciled.

Configure the Stripe endpoint for `refund.created`, `refund.updated`, and `refund.failed` in addition to the existing PaymentIntent events. Customer-wallet refunds use the internal wallet ledger and do not call Stripe.
