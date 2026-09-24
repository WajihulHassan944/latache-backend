-- Follow-up to 20260924120000_user_last_seen_nullable.
-- Users that existed when "lastSeenAt" was first added (20260917080000_add_user_last_seen_at)
-- were filled with that migration's transaction timestamp by the column DEFAULT, not with a
-- real presence time. Anyone who has connected since has a later (heartbeat/connect) value,
-- so a value inside that migration's own run window means "never connected" -> NULL.
-- Keyed to the recorded migration window (no hardcoded timestamp), so it is correct on every
-- database; a no-op where that migration has no finished record.
UPDATE "Users" u
SET "lastSeenAt" = NULL
FROM "_prisma_migrations" m
WHERE m.migration_name = '20260917080000_add_user_last_seen_at'
  AND m.finished_at IS NOT NULL
  AND u."lastSeenAt" BETWEEN m.started_at AND m.finished_at;
