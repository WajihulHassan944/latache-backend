# Tasker earning clearance and cash accounting

Version 3.14 introduces one persisted accounting path for online Tasker earnings and a separate, possession-correct path for cash. No endpoint or worker fabricates provider settlement, cash custody, a refund, a payout, or an available balance.

## Online/card flow

1. Task completion calculates and persists the final pricing snapshot, but does not create withdrawable money.
2. Stripe or the real customer-wallet ledger must confirm successful settlement.
3. Settlement creates exactly one `TaskerEarning` for the booking. Its pricing snapshot contains customer gross, service/labor, platform commission, tax, surcharge, tip, donation, and Tasker net.
4. The Tasker wallet pending balance and `TaskerWalletLedger` receive the same liability. Available balance is unchanged.
5. `clearsAt` is `settledAt + earningClearanceDays` (14 days by default).
6. The worker releases only mature, unblocked earnings with no active dispute. It locks the earning, wallet, and platform account in one PostgreSQL transaction.
7. Outstanding cash platform payables are settled oldest-first from the mature earning. Only the remainder increments available balance.

The existing commission policy is `customer_platform_fee`. Tasker net is therefore service/labor less inclusive tax, plus the Tasker tip. Platform fee/commission, surcharge, exclusive tax, and donation remain non-Tasker components. Each settled booking stores its own immutable values, including the Elite tier policy already applied during pricing; later settings changes do not rewrite history.

## Holds, disputes, and refunds

- Opening a dispute blocks a pending earning. Elapsed time alone cannot release it.
- Finance may block, unblock, or extend a pending clearance with an explicit reason. Every action is an `AdminAuditLog` entry.
- An active dispute prevents manual unblocking.
- A settled refund reverses the unreleased pending portion first. Only a refund amount attributable to funds already released decrements available balance and may use the existing negative-balance clawback behavior.
- Earning release and refund adjustment use unique ledger idempotency keys and row locks, so webhook/worker retries cannot double-apply them.

## Cash flow

1. A completed cash booking returns `cash_confirmation_required` and creates no Tasker wallet earning.
2. The assigned Tasker explicitly confirms the exact final cash amount with an `Idempotency-Key`.
3. `TaskerPlatformReceivable` records the physical cash collected, Tasker economic earning, and platform payable snapshot.
4. `TaskerPlatformLedger` records debt creation and every later online-earning offset. `TaskerPlatformAccount` is a locked aggregate of the outstanding receivable ledger.
5. The cash record may remain inside a separate dispute-clearance period, but cash remains in the Tasker's possession throughout.
6. Latache does not charge a card or bank account. No collection state can become successful without an authorized collection provider.

Under the current `customer_platform_fee` policy, a service amount of 100 plus a 15 platform fee produces 115 cash collected, 100 Tasker economic earning, and 15 payable to Latache. This preserves the existing booking price calculation rather than introducing a second commission formula.

Finance can configure a maximum outstanding payable and enable cash-booking restriction. The default threshold is zero and blocking is disabled, so no unapproved business ceiling is invented. The worker reconciles restriction state after policy changes and after debt offsets.

## APIs

### Shared booking/payment resources

- `POST /api/bookings/:bookingId/complete` — online settlement creates pending earnings; cash requires confirmation.
- `POST /api/bookings/:bookingId/cash-payment/confirm` — Tasker-only explicit physical cash confirmation. Requires `Idempotency-Key` and `{ "collectedAmount": number }`.

### Tasker wallet

- `GET /api/tasker-dashboard/wallet` — includes pending/available totals, pending earning count, next expected availability, outstanding platform payable, and cash restriction state.
- `GET /api/tasker-dashboard/wallet/earnings` — paged earning snapshots and pending/available/reversed/held state.
- `GET /api/tasker-dashboard/wallet/platform-payables` — account balance, receivables, and platform ledger.

### Admin Finance and settings

- `GET /api/admin/finance?view=earnings` — the same `TaskerEarning` records visible to Taskers.
- `GET /api/admin/finance?view=cash_receivables` — the same cash receivables and payable values.
- `POST /api/admin/finance/earnings/:id/actions` — `block`, `unblock`, or `extend_clearance`; requires `finance.manage`.
- `GET /api/admin/platform-settings?sections=taskerFinance` — read policy; requires `settings.read`.
- `PUT /api/admin/platform-settings` — update `taskerFinance`; requires `settings.manage`.

Example settings update:

```json
{
  "taskerFinance": {
    "earningClearanceDays": 14,
    "cashDisputeClearanceDays": 14,
    "maximumOutstandingPlatformDebt": 250,
    "blockCashBookingsAtDebtLimit": true
  }
}
```

Enabling restriction requires a positive debt threshold.

## Worker and multi-instance safety

`TaskerEarningsWorker` uses a configurable poll interval only as a wake-up mechanism. Correctness is database-driven:

- maturity and hold state are persisted;
- every release locks the `TaskerEarnings` row with `FOR UPDATE`;
- wallet and platform-account aggregates are locked in the same transaction;
- booking, earning, receivable, wallet-ledger, and platform-ledger uniqueness constraints provide idempotency;
- a second Railway replica finds the row already released and performs no balance movement;
- restart catches up all matured records still awaiting release.

No Redis service is required for this release. Redis remains appropriate for a later queue/cache/pub-sub performance phase, but financial correctness does not depend on a single in-memory scheduler or process.

## Realtime and audit

Persisted notification/outbox delivery is reused for pending settlement, release, block/reversal, cash payable creation/settlement, and cash restriction changes. Private conversation rooms are untouched. Finance hold actions are written to the existing administrator audit log.

## Migration and deployment

Apply additive migration `20260812143000_add_tasker_earning_clearance_cash_accounting`:

```bash
npm install
npm run prisma:generate
npm run prisma:validate
npm run prisma:migrate:deploy
npm run build
npm run start:dev
```

Never run `prisma migrate reset` against an existing database. Existing balances and historical ledgers are not rewritten or backfilled because no provider-backed settlement snapshot can be safely inferred for them.

## Environment bootstrap defaults

```env
TASKER_EARNINGS_WORKER_ENABLED=true
TASKER_EARNINGS_WORKER_POLL_MS=60000
TASKER_EARNINGS_WORKER_BATCH_SIZE=100
TASKER_EARNINGS_CLEARANCE_DAYS=14
TASKER_CASH_DISPUTE_CLEARANCE_DAYS=14
```

Persisted Platform Settings take precedence for business policy. Environment values are safe bootstrap defaults for a new deployment.

## Regression coverage

`test/tasker-earning-clearance-cash-accounting.static.spec.ts` checks settlement-to-pending behavior, no early release, row-lock/idempotent maturity release, pending-first and post-release refunds, cash-without-wallet behavior, payable creation, debt offset, threshold policy, webhook/cash replay protection, and common Admin/Tasker sources. The full Jest suite, Prisma validation/generation, strict TypeScript compilation, build, and route-duplication verifier are part of release verification.
