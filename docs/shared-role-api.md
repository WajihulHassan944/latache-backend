# Shared customer/tasker API boundaries

Latache v3.6 avoids controller duplication when Customer and Tasker screens represent the same domain resource.

## Unified

- `/api/dashboard/overview`: dispatches by authenticated role.
- `/api/bookings`: role-aware list/detail; shared cancellation, complaints, navigation and timer reads.
- `/api/conversations`: booking participants only.
- `/api/notifications`: current authenticated user only.
- `/api/reviews`: received/given review projection for the current user.
- `/api/auth/me`: personal account/profile fields for every authenticated role.

## Intentionally specialized

- `/api/tasker-dashboard/profile/business` and `/skills`: Tasker-only work configuration.
- `/api/tasker-dashboard/wallet`: Tasker earnings/payout wallet and payout security.
- `/api/payments/wallet`: Customer spending wallet and Stripe funding flow.
- Customer favorites: customers can favorite Taskers; there is no equivalent Tasker action.

A Customer spending wallet and a Tasker payout wallet are separate financial ledgers and are not unified merely because both screens use the word “wallet”.
