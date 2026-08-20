# Production referral reward system

## Scope and safe defaults

Referral programs are disabled by default. Super Admin must explicitly configure real commercial values in the existing `referral` section of `PUT /api/admin/platform-settings`; the backend does not invent bonuses, discounts, successful payments, or payout-provider transfers.

Two isolated programs exist:

- Customer → Customer
- Tasker → Tasker

Codes cannot cross roles. Self-referral, inactive referrers, duplicate attribution, cap exhaustion, and attribution after any settled booking are rejected. One referred account can have exactly one durable attribution. Existing accounts receive a stable unique code lazily through `GET /api/referrals/me`.

## Qualification and accounting flow

1. A verified Customer or Tasker claims a same-role code through `POST /api/referrals/claim` before their first settled booking.
2. The active policy, currency, version, expiry, clearance, benefit amounts, and qualification thresholds are snapshotted on the attribution. Later Super-Admin setting changes do not rewrite it.
3. Only the referred participant’s first eligible Stripe/customer-wallet booking can qualify. Cash bookings never qualify and never create platform-held referral money.
4. A referred-Customer percentage discount is reserved against that booking and persisted on `Booking`. The discount is capped by the configured maximum and by the larger of the minimum real charge and minimum qualifying paid amount.
5. Stripe qualification occurs only inside the verified `payment_intent.succeeded` transaction. Customer-wallet qualification occurs only inside the locked authoritative wallet-debit transaction.
6. Wallet rewards enter `pending` referral state until the snapshotted clearance date. The BullMQ maintenance worker releases only undisputed, still-eligible rewards.
7. Customer credits write `CustomerWalletLedger`; Tasker credits write `TaskerWalletLedger`. Every credit and reversal has a unique idempotency key and a direct `ReferralReward` link.

Tasker referral bonuses are platform promotional credits, not booking earnings. They do not alter the existing 14-day `TaskerEarning` record or cash-receivable accounting. Payout execution remains disabled unless the existing authorized manual/provider process is configured.

## Refunds, disputes, and revocation

- Active disputes pause pending reward release.
- A partial refund preserves eligibility only while the remaining real paid amount satisfies the snapshotted minimum.
- A full refund, or a refund below that threshold, revokes the referral. Pending rewards are cancelled; settled wallet credits receive immutable negative reversal entries.
- Admin may revoke verified abuse with `finance.manage` and a required reason. The action and the financial adjustment are atomic and audit-logged.
- Wallet balances may become negative after a legitimate clawback. This preserves the liability instead of fabricating recovery or silently deleting financial history.
- Referral/reward records block permanent account deletion because they are protected attribution and financial history.

## APIs

Participant APIs:

- `GET /api/referrals/me`
- `POST /api/referrals/claim`
- `GET /api/referrals/history?view=invites|rewards`
- `GET /api/referrals/leaderboard` (only when enabled)

Admin/Super Admin operational APIs:

- `GET /api/admin/referrals` — `finance.read`
- `GET /api/admin/referrals/:id` — `finance.read`
- `POST /api/admin/referrals/:id/revoke` — `finance.manage`
- `GET /api/admin/platform-settings` section `referral` — `settings.read`
- `PUT /api/admin/platform-settings` section `referral` — `settings.manage` plus mandatory `super_admin` role

Persisted notifications are rendered in `en`, `ar`, or `ary`. `referral:updated` uses the transactional PostgreSQL outbox and the existing private user room; Redis remains distribution only.


## Policy ownership

Referral/Rewards commercial policy has one source of truth: the `referral` section of Platform Settings. The following fields are writable only by Super Admin: `clientReferralBonus`, referred-Customer discount values, `taskerReferralBonus`, `referredTaskerBonus`, qualification amounts, referral caps, expiry and reward clearance. Operational Admins may inspect/refund/revoke according to their finance permissions but cannot change the commercial reward policy.

## Policy fields

- `clientReferralEnabled`, `taskerReferralEnabled`
- `uniqueCodesEnabled` (required while enabled)
- `leaderboardEnabled`
- `clientReferralBonus`
- `referredClientDiscountPercent`, `referredClientDiscountMaxAmount`
- `taskerReferralBonus`, `referredTaskerBonus`
- `referralExpiryDays`, `rewardClearanceDays`
- `minimumQualifyingBookingAmount`, `minimumCustomerChargeAmount`
- `maxClientReferrals`, `maxTaskerReferrals` (`0` means uncapped)

`bonusStackingEnabled=true` remains rejected because no promotion engine exists. This prevents the setting from claiming behavior that is not implemented.

## Operations

Apply the additive migration without resetting the database:

```bash
npm install
npm run prisma:generate
npm run prisma:validate
npm run prisma:migrate:deploy
npm run build
```

Production keeps the existing Redis/BullMQ requirements. Optional scheduler tuning:

- `REFERRAL_WORKER_POLL_MS=60000`
- `REFERRAL_WORKER_BATCH_SIZE=100`

At least one production worker must have `JOB_WORKER_ENABLED=true` and the scheduler must remain enabled.

## v3.24.0 completion audit

- Reward clearance checks internal active disputes and Stripe provider chargebacks before any wallet settlement.
- A verified Stripe chargeback with final status `lost` revokes the qualifying referral and uses the existing immutable wallet reversal entries for any already-settled reward.
- Reward release serializes on Booking → Referral → Reward.
- Pending referred-Customer discount reservations are cleared on booking cancellation and can be reused for a later eligible booking instead of remaining stranded.
