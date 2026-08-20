# Production readiness

## Code-enforced release gates

- Staging/production require independent access-token, admin-token, and OTP-hash secrets.
- Staging/production require Redis, BullMQ jobs, and scheduler registration; `/api/health` reports a missing worker or required Redis/queue outage.
- Booking completion is customer-approved or auto-approved only after the persisted review deadline and only without an active dispute.
- Provider payment, wallet mutation, earning clearance, cash receivables, refunds, and withdrawals retain PostgreSQL/provider idempotency and locking.
- Referral policy is disabled by default, snapshotted per attribution, qualified only by authoritative online settlement, and released/reversed through immutable wallet ledgers.
- A production seed rejects the documented development Super Admin credentials and never rotates an existing password unless an explicit one-time flag is set.
- Email templates use hosted assets and have no runtime dependency on files copied into `dist`.

## External go-live gates

The backend intentionally cannot manufacture these decisions or credentials:

- Verified live Stripe account/webhook and an approved payout operating model/provider.
- Legal tax/VAT, cancellation-fee, refund, actual referral benefit amounts/eligibility thresholds, and Elite-benefit policies.
- Production SMTP sender domain with SPF, DKIM, and DMARC.
- Client-owned Cloudinary/object-storage account and retention requirements.
- Redis, PostgreSQL, API, and worker deployment with backups and alerting.
- TURN service for reliable WebRTC calls, a maps/routing provider for server-calculated ETA, and APNs/FCM (or another push provider) for offline mobile notifications.
- Privacy terms, deletion/financial-retention obligations, incident contacts, and production Super Admin identity.
- Staging end-to-end payment/refund/payout tests and measured load/restore testing before public launch.

Provider-backed features remain disabled or explicitly unavailable until their real configuration and policy are supplied. Redis is transport/cache infrastructure; PostgreSQL and payment providers remain authoritative.
