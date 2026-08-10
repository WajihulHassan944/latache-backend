# Tasker dashboard API

Version 3.5 implements only the backend capabilities required by the supplied Tasker dashboard designs. Every route below is scoped to the authenticated Tasker; callers cannot choose another `taskerId`.

## Screen-to-domain mapping

| Design area | Backend behavior |
|---|---|
| Dashboard home | Real setup progress, wallet summary, completion metrics, ratings, settled earnings, monthly settled earnings, next task and recent ledger rows |
| Task management | Booked/ongoing/history pagination and real booking state transitions |
| Location / heading to client | Latest Tasker coordinates plus booking destination and arrival transition; no fabricated ETA or distance |
| Arrival | Persists `arrivedAt` and notifies the customer |
| Task timer | Persistent start/pause/resume/stop state, elapsed duration and notes |
| Complaint | Persists a complaint linked to the booking |
| Personal profile | Tasker-owned editable personal fields; email remains read-only because changing it requires a verified auth flow |
| Business profile / skills | Service catalogue activation, per-service rate changes and safe deactivation |
| Reviews | Received/given lists; Tasker can create a review only for a completed booking and edit/delete only their own review |
| Chats | Booking-backed customer conversations and messages; empty list is returned when no real conversation exists |
| Notifications | Persisted all/unread/category lists, unread count and read state |
| Wallet | Ledger-derived balance, settled earnings and transaction history; zero/empty is valid |
| Billing information | Encrypted payout methods; raw account details are never returned |
| Withdraw flow | Payout capability check, six-digit payout PIN and idempotent withdrawal request |
| Transaction success | No Tasker endpoint fabricates this state; UI should show success only when a future payment/payout integration records a real `paid` result |

## Shared dashboard, tasks and timer

Version 3.6 removes duplicate Tasker controllers for resources that are also used by customers. The authenticated role decides the projection and allowed mutations.

```text
GET    /api/dashboard/overview
GET    /api/bookings?bucket=booked|ongoing|history
GET    /api/bookings/next
GET    /api/bookings/:bookingId
POST   /api/bookings/:bookingId/confirm             # Tasker
POST   /api/bookings/:bookingId/cancel              # Either participant
POST   /api/bookings/:bookingId/navigation/start    # Tasker
GET    /api/bookings/:bookingId/navigation          # Either participant
PUT    /api/bookings/:bookingId/location            # Tasker
POST   /api/bookings/:bookingId/arrival             # Tasker
GET    /api/bookings/:bookingId/timer               # Either participant
POST   /api/bookings/:bookingId/timer/start         # Tasker
POST   /api/bookings/:bookingId/timer/pause         # Tasker
POST   /api/bookings/:bookingId/timer/resume        # Tasker
POST   /api/bookings/:bookingId/timer/stop          # Tasker
PATCH  /api/bookings/:bookingId/timer/notes         # Tasker
POST   /api/bookings/:bookingId/complete            # Either participant; stopped timer required
POST   /api/bookings/:bookingId/complaints          # Either participant
```

Profile fields shared by all roles use `GET/PATCH /api/auth/me`. Tasker-specific business profile and skill/rate configuration remain under `/api/tasker-dashboard/profile`.

Reviews, conversations and notifications are also shared:

```text
/api/reviews/*
/api/conversations/*
/api/notifications/*
```

The old `/api/tasker-dashboard/tasks`, `/messages`, `/notifications`, `/reviews`, and `/overview` routes are intentionally removed instead of retained as aliases.

## Wallet and payout methods

```text
GET    /api/tasker-dashboard/wallet
GET    /api/tasker-dashboard/wallet/transactions
GET    /api/tasker-dashboard/wallet/payout-capabilities
GET    /api/tasker-dashboard/wallet/payout-security
POST   /api/tasker-dashboard/wallet/payout-pin
PATCH  /api/tasker-dashboard/wallet/payout-pin
GET    /api/tasker-dashboard/wallet/payout-methods
POST   /api/tasker-dashboard/wallet/payout-methods
PATCH  /api/tasker-dashboard/wallet/payout-methods/:id/default
DELETE /api/tasker-dashboard/wallet/payout-methods/:id
GET    /api/tasker-dashboard/wallet/withdrawals
POST   /api/tasker-dashboard/wallet/withdrawals
GET    /api/tasker-dashboard/wallet/withdrawals/:id
POST   /api/tasker-dashboard/wallet/withdrawals/:id/cancel
```

### Wallet truth rules

1. The wallet balance is derived from stored wallet/ledger state. A new Tasker legitimately sees zero and no transaction rows.
2. `POST .../complete` does not credit earnings. Work completion and payment settlement are different events.
3. `TaskerWalletService.creditBookingSettlement()` is an internal idempotent integration boundary. A future customer-payment module may call it only after a payment provider/database settlement is verified.
4. Tasker HTTP controllers do not expose that settlement hook.
5. Payout-provider execution is not simulated.

### Withdrawal modes

`TASKER_PAYOUT_EXECUTION_MODE=disabled` is the default. Withdrawal submission returns service-unavailable and does not reserve balance.

`TASKER_PAYOUT_EXECUTION_MODE=manual` allows an operational workflow: the requested amount moves from available to pending in one transaction and the withdrawal is created as `pending_review`. This is not a paid state and no external transfer is claimed.

Google Pay is explicitly rejected as a payout destination in the current backend because it is not implemented as a supported payout rail.

### Payout security

Configure payout details only when `PAYOUT_DATA_ENCRYPTION_KEY` is set to 32 random bytes (base64) or 64 hex characters. Account identifiers are encrypted with AES-256-GCM and responses return masked metadata only.

Before the first withdrawal, the Tasker configures a six-digit payout PIN by confirming their current Latache password. The PIN is bcrypt-hashed. Five incorrect withdrawal PIN attempts cause a 15-minute lock.

Withdrawal creation requires an `Idempotency-Key` header so retries cannot reserve the same funds twice.

## Database migration

Apply:

```bash
npm run prisma:generate
npm run prisma:validate
npm run prisma:migrate:deploy
```

The migration is:

```text
20260807010000_add_tasker_dashboard
```

It is additive and intentionally contains no wallet balance, earnings, review, message or notification seed data.
