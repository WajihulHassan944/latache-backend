# Performance, Redis, queues, and Railway scaling (v3.16)

## Responsibility boundaries

| Component               | Responsibilities                                                                                                                                                                    | Explicitly not responsible for                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL/Prisma       | Bookings, payments, wallet/receivable ledgers, earning clearance state, notifications, chat/support history, audit logs, realtime outbox, and durable object-storage deletion tasks | Cross-replica socket fanout or disposable cache data                                                                              |
| Redis                   | Versioned read caches, Socket.IO adapter pub/sub, BullMQ transport, cross-replica location-write coalescing                                                                         | Financial balances, provider settlement truth, booking/dispute truth, or durable notifications                                    |
| BullMQ worker           | Retry-safe periodic scans for booking auto-completion, mature earnings, stale calls, dispatched-outbox retention, and Cloudinary deletion tasks                                     | Synchronous booking transactions, Stripe result handling, wallet mutations outside their PostgreSQL transactions, or WebRTC media |
| Socket.IO Redis adapter | Cross-instance delivery to the existing private/public/admin rooms                                                                                                                  | Durable event production; PostgreSQL's transactional outbox keeps that role                                                       |

Redis cache failure therefore falls through to PostgreSQL. If jobs are enabled, Redis/queue/worker failure is surfaced as unhealthy by `/api/health`; the application does not claim that required maintenance was queued or processed.

## Audit findings and implemented cache scope

The audit found repeated reads of localized Services/Service Options, Platform Settings, Elite configuration, and wide Admin aggregate query sets. It also found high-growth chronological tables (notifications, messages, wallet ledgers, audit logs, payment/withdrawal records, and the realtime outbox), per-typing-event authorization reads, GPS write bursts, and outbox retention deletion running in every dispatch poll.

Implemented caches:

- active localized Service lists, Service detail, and Service Options: 300-second default;
- Platform Settings read views/public configured content: 300-second default;
- Admin Elite Program configuration: 120-second default;
- Admin aggregate endpoints except the live activity feed: 30-second private default.

Keys use the `latache:v1` namespace, a stable hash of the complete non-secret input, and a per-resource version. Admin mutations bump the Services, Platform Settings, or Elite namespace after the database transaction commits. A version bump invalidates every locale/page/detail variant immediately without Redis `KEYS` scans; TTL removes older generations later. Concurrent misses on one API instance are coalesced.

Not cached:

- Tasker/customer wallet balances, earning or platform-debt state;
- payment transactions, Stripe webhook state, withdrawals, or provider results;
- active booking, timer, dispute, support-chat, or notification inbox state;
- personalized Tasker discovery/profile responses.

Those exclusions avoid stale state that could change authorization, money, or an active workflow. Public Tasker summaries and additional RBAC catalogue caching should be considered only after production traces show enough reuse and every profile/access mutation has an invalidation path.

The permission catalogue itself is code-backed and already an in-process constant-time read. Persisted roles, effective permissions, and administrator assignments remain uncached so a permission mutation cannot be hidden by stale Redis state.

## BullMQ maintenance jobs

One versioned queue (`latache-maintenance-v1`) has stable scheduler IDs:

| Job                            | Default cadence | Safety                                                                                                                                                                        |
| ------------------------------ | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finance.release-mature`       | 60 seconds      | Existing PostgreSQL advisory/row locks, persisted earning status, unique idempotency keys, and debt-offset transactions prevent double release                                |
| `realtime.expire-calls`        | 5 seconds       | Conditional lifecycle updates make repeat execution a no-op; resulting notifications/events are committed with the state change                                               |
| `realtime.cleanup-outbox`      | 1 hour          | Deletes bounded batches only where `publishedAt` is older than retention; pending/failed rows can never match                                                                 |
| `storage.purge-deleted-assets` | 60 seconds      | Conditionally claims persisted deletion tasks; unique public IDs, provider `not found` success, retry backoff, and stale-lock reclamation make duplicate/crashed workers safe |
| `bookings.auto-complete`       | 60 seconds      | Locks mature `awaiting_customer_approval` rows; active disputes block completion, and terminal-state checks prevent duplicate counters/events/payment finalization            |

BullMQ uses exponential retry, observable failed-job logs, configurable concurrency, and retained success/failure history. With `JOBS_ENABLED=false`, local development retains the existing PostgreSQL-safe earnings/call interval and an hourly bounded cleanup interval; automatic booking completion intentionally does not pretend to run. Staging/production configuration validation requires Redis, jobs, and scheduler registration, and production should use the dedicated worker.

Transactional email remains synchronous in this release. Registration/security endpoints continue to know whether SMTP accepted the message; moving it to a queue safely requires a durable email-intent/outbox record, delivery status API, and product decision about API semantics rather than treating a Redis enqueue as delivery.

## Socket.IO and realtime performance

Every API replica connects a publisher/subscriber pair to the Socket.IO Redis adapter. Existing room names and authorization are unchanged: Customer/Tasker conversation rooms remain separate from Admin booking-monitor rooms, and public support rooms remain separate from Admin support rooms. A PostgreSQL outbox dispatcher claims rows with `FOR UPDATE SKIP LOCKED`; one claiming API replica emits into Socket.IO and Redis fans the event to sockets on all replicas.

Typing requires an already authorized room subscription and is locally throttled (300 ms default), eliminating a Prisma authorization query for every keystroke. WebRTC signaling keeps the existing per-socket rate limit; media remains peer-to-peer/TURN. Location writes are coalesced across replicas to one persisted/outbox update per configured interval (one second default) when Redis is healthy. If Redis is down, location persistence continues normally.

## Database/index and pagination changes

Migration `20260812223000_add_performance_indexes` adds only query-driven indexes:

- `(userId, createdAt, id)` for notification cursor reads;
- `(bookingId, createdAt, id)` for chat messages/call history;
- `(ticketId, createdAt, id)` for support messages;
- `(taskerId, createdAt, id)` for Tasker wallet ledgers;
- global status/date/id indexes for Admin booking, payment, and withdrawal filters;
- `(createdAt, id)` for Admin audit chronology;
- `(publishedAt, createdAt, id)` for bounded outbox cleanup;
- Service/status/date for dashboard service aggregates;
- `pg_trgm` GIN indexes over normalized English/Arabic Service and Service Option names/descriptions used by contains-search.

Notifications, conversation messages, and Tasker wallet transactions now accept an additive `cursor` while retaining page/limit and existing totals. Responses add `nextCursor` and `hasMore`. Cursor ownership is verified so an ID from another user/booking cannot be used as a pagination anchor. Existing support-message reads remain capped at 500 and should move to cursor paging in a coordinated frontend contract update.

## HTTP, connections, and observability

- gzip/deflate response compression is enabled above a configurable threshold;
- Express weak ETags remain available; unauthenticated Service/platform-content GETs receive short public cache headers and `Vary: Accept-Language`; auth, payment, finance, wallet, and notification responses are private/no-store;
- request bodies remain bounded and Stripe raw-body verification is preserved;
- per-replica PostgreSQL pool size, idle timeout, and connection timeout are explicit. `DATABASE_URL` should be the Neon/Railway pooled runtime URL and `DIRECT_URL` the direct migration URL;
- structured request logs include request ID, route, status, latency, and numeric user ID but never bodies, tokens, OTPs, payout details, or provider secrets;
- slow query logs include duration/target/statement type only, never SQL parameters;
- `/api/health` reports PostgreSQL, Redis latency, queue depth/failures, registered worker count, realtime-outbox backlog, cache counters, and baseline request/job metrics without credentials.

Metrics are process-local counters intended as a baseline for logs and health. Production percentile histograms, cross-instance aggregation, traces, alert routing, and database `EXPLAIN (ANALYZE, BUFFERS)` capture should be added with the selected observability vendor after representative load tests.

At the 2026-08-12 verification snapshot, `npm audit --omit=dev` reports a high-severity `js-yaml` advisory inherited through `@nestjs/swagger`, with no fixed transitive version available to npm. It is recorded in `VERIFICATION.json` rather than suppressed. Recheck before deployment and update Nest Swagger/js-yaml as soon as the upstream dependency publishes a compatible fix.

## Railway topology

Deploy the same image twice:

1. API service: `SERVICE_MODE=api`, `JOBS_ENABLED=true`, `JOB_WORKER_ENABLED=false`, `JOB_SCHEDULER_ENABLED=true`.
2. Worker service: `SERVICE_MODE=worker`, `JOBS_ENABLED=true`, `JOB_WORKER_ENABLED=true`, `JOB_SCHEDULER_ENABLED=true` and start command `npm run start:worker`.
3. Both receive the same private `REDIS_URL`, pooled `DATABASE_URL`, application policy configuration, and secrets. Set `REDIS_ENABLED=true` and `REDIS_REQUIRED=true`.
4. Run `npm run prisma:migrate:deploy` once as a release/pre-deploy command using `DIRECT_URL` where the pooled runtime URL cannot run migrations.
5. Scale API replicas horizontally. Scale worker replicas only after measuring queue backlog; PostgreSQL idempotency/locks keep duplicate execution safe.

Do not run migrations independently on every API/worker replica. A worker service does not bind an HTTP port; Railway health checks should target `/api/health` on the API service. Queue health on the API requires at least one registered BullMQ worker when jobs are enabled.

## Load-testing follow-up

Before materially increasing replicas or TTLs, capture production-like p50/p95/p99 latency, pool wait time, Redis hit ratio, queue delay, outbox age, Socket.IO messages/second, and index usage. Use the results to tune per-replica pool limits, cache TTLs, worker concurrency, outbox batch/poll settings, GPS cadence, and whether additional aggregate precomputation is justified. No materialized financial/dashboard source or public Tasker-profile cache was introduced without that evidence.
