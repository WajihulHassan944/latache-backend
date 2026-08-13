# Permanent deletion architecture

Latache v3.18.0 distinguishes account lifecycle state from deletion. Suspension, ban and user-requested deactivation update `accountStatus`; they do not set `deletedAt`. Every HTTP `DELETE` operation implemented in this release physically removes eligible data.

## Administrative account controls

- `DELETE /api/admin/customers/:id` requires `customers.delete`.
- `DELETE /api/admin/taskers/:id` requires `taskers.delete`.
- `DELETE /api/rbac/admins/:id` requires `admins.delete`.
- The body must contain `confirmation: "PERMANENT_DELETE"` and a 10–1000 character audit reason.
- Super Admin receives the two new permissions through the additive migration. Other administrators receive them only through the existing RBAC role/permission management flow.
- An administrator cannot delete their own account. The canonical Super Admin cannot be deleted.

Deletion is intentionally blocked with `409 ACCOUNT_PURGE_BLOCKED` when the account owns booking, payment, wallet, earning, receivable, withdrawal, dispute, review, conversation, or other protected history. Those records are shared with another user or are provider/ledger-backed sources of truth; destroying them would violate financial reconciliation and platform audit guarantees. The response lists each blocker and its real count. Once blockers do not exist, PostgreSQL locks and rechecks the target, writes the audit event, queues assets, deletes dependent rows, and deletes the user in one transaction.

## Other delete controls

- Custom RBAC roles are permanently deleted when unassigned.
- Services and service options are permanently deleted only when no booking references them.
- Elite badges and their translations/assignments are permanently deleted; managed artwork is queued for deletion.
- Tasker payout methods are permanently deleted only when no withdrawal history references them.
- Tasker skill assignments are physically removed. Tasker account deactivation remains a reversible lifecycle action and is not represented as deletion in the database.

## Object-storage cleanup

Cloudinary cleanup uses `ObjectStorageDeletionTasks` as a durable PostgreSQL outbox. The same database transaction that deletes the resource records every Latache-managed public ID. An immediate cleanup attempt is made after commit. Failed provider deletes remain visible as `failed`, use exponential retry scheduling, and are retried by the BullMQ maintenance job `storage.purge-deleted-assets`. Multiple workers claim tasks using conditional state transitions and unique public-ID constraints, so duplicate workers cannot issue successful deletion twice.

Only public IDs under `CLOUDINARY_FOLDER` are eligible. External image URLs and other tenants' paths are ignored.

Configuration:

```env
OBJECT_STORAGE_PURGE_BATCH_SIZE=100
OBJECT_STORAGE_PURGE_RETRY_BASE_SECONDS=60
OBJECT_STORAGE_PURGE_WORKER_INTERVAL_MS=60000
OBJECT_STORAGE_PURGE_LOCK_TIMEOUT_MS=300000
```

For reliable provider retry in Railway, keep the existing worker service running with `JOBS_ENABLED=true`, `JOB_WORKER_ENABLED=true`, Redis configured, and one API/worker instance with `JOB_SCHEDULER_ENABLED=true` (BullMQ scheduler registration is idempotent).
