# Admin Payments, Finance, and Platform Settings

Version 3.14 extends the permission-aware finance operations with Tasker earning clearance and cash receivables while retaining a single persistent platform-policy surface without duplicating Stripe, dispute, payout, Elite, or RBAC ownership.

## Finance dashboard

`GET /api/admin/finance` is the consolidated read endpoint.

Supported `view` values:

- `overview` — collected/refunded payment volume, wallet liabilities, pending earning clearance, outstanding cash receivables, payout state, recent transactions, and active finance policy.
- `transactions` — customer payment transactions plus Tasker payout requests in one chronological feed.
- `refunds` — refund-bearing dispute resolutions and real provider state. Refund execution remains owned by `POST /api/admin/disputes/:id/actions`.
- `payouts` — Tasker withdrawal queue and payout-method metadata.
- `revenue` — real succeeded booking charges/refunds with daily and service breakdowns.
- `earnings` — immutable online Tasker earning snapshots, maturity, hold, reversal, debt-offset, and release state.
- `cash_receivables` — cash physically held by Taskers and the related platform payable state.

`format=csv` exports transactions/refunds/payouts/revenue and additionally requires `reports.read`. The response includes `X-Export-Truncated` when the safe export cap is reached.

## Payout lifecycle

`POST /api/admin/finance/payouts/:id/actions`

Actions:

- `approve`: `pending_review -> processing`. No funds leave Latache and no provider success is fabricated.
- `reject`: returns reserved pending funds to the Tasker's available wallet.
- `mark_paid`: requires a real external transfer reference, consumes the pending balance, writes an idempotent ledger record, notifies the Tasker, and audit-logs the decision.
- `mark_failed`: returns reserved funds and records the failure reason.

The current payout backend remains manual-provider integration. The API deliberately does not call an imaginary bank/PayPal/Orange Money payout provider.

## Earning clearance controls

`POST /api/admin/finance/earnings/:id/actions` supports `block`, `unblock`, and `extend_clearance` for a pending earning. The action requires `finance.manage`, writes the existing administrator audit log, and updates the same `TaskerEarning` read by Tasker wallet and the release worker. Active disputes prevent unblocking.

## Refunds

Finance does not have a second refund mutation API. Refund processing is still part of Dispute Management so support evidence, the approved resolution, Stripe/wallet settlement, refund webhooks, and Tasker earning clawbacks cannot diverge.

The finance refund view surfaces the same `DisputeResolution` records and includes the canonical dispute action route.

## Platform settings

`GET /api/admin/platform-settings?sections=...`

`PUT /api/admin/platform-settings`

The PUT operation atomically merges all supplied settings sections and audit-logs each changed section. Supported sections are:

- `general`
- `currency`
- `tax`
- `bookingRules`
- `serviceRadius`
- `commission`
- `taskerFinance`
- `referral`

`eliteProgram` is available in the GET aggregation but is intentionally read-only there. Elite requirements and benefits remain owned by `/api/admin/elite-taskers/program` to avoid duplicate policy storage.

## Runtime behavior

The following settings are wired into existing flows:

- Commission rules affect new booking quotes and new final booking charges.
- Gold/Platinum/Diamond rates are resolved from the Tasker's actual Elite tier.
- Category commission overrides use real Service IDs.
- Same-day and weekend commission modifiers can be applied.
- Global tax mode and a fixed service surcharge affect new final charges and are persisted on the Booking.
- Booking-policy enforcement can enforce advance notice, maximum booking horizon, and duration limits.
- Service-radius policy supplies the default/max radius used by public Tasker discovery.
- Tasker Finance policy controls future online earning clearance, cash dispute-clearance timestamps, and the optional cash-debt restriction threshold.

Existing settled bookings are never retroactively recalculated. Quotes are estimates: commission/tax policy is evaluated again when the completed task is finalized, and the rate/tax mode actually used is persisted on the Booking for audit.

## Deliberately unavailable settings

A setting is rejected rather than saved cosmetically when the operational engine does not exist yet. Examples:

- automatic FX refresh
- multi-currency settlement
- referral payout/reward engine
- SMS/push provider activation
- maintenance-mode request blocking
- waitlist/repeat/group/emergency/instant-booking lifecycle modes
- late-cancellation fee settlement
- distance-based pricing/dynamic radius routing
- tax auto-reporting/VAT filing

Jurisdiction tax overrides can be stored for policy/reporting, but are not auto-applied until bookings carry a verified tax jurisdiction field/provider result.

## Permissions

- `finance.read` — finance read APIs
- `finance.manage` — payout decisions and pending-earning hold actions
- `reports.read` — CSV exports
- `settings.read` — platform settings reads
- `settings.manage` — platform settings writes

Super Admin bypasses permission checks as before.

## Explicitly unavailable until integrated

The API rejects enabling external FX refresh, multi-currency settlement, paid cancellation-window rules, region-specific radius routing, referral reward payouts, automatic tax reporting/VAT automation, and unsupported booking modes. This prevents settings from claiming behavior that the runtime does not execute.

- external exchange-rate provider selection until a provider is configured
