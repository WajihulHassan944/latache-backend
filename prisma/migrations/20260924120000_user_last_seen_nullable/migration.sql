-- AlterTable
ALTER TABLE "Users" ALTER COLUMN "lastSeenAt" DROP NOT NULL,
ALTER COLUMN "lastSeenAt" DROP DEFAULT;


-- Users who never connected to realtime still carry the old column default,
-- which was written by the same INSERT as "createdAt" (identical timestamp).
-- They have never been seen, so report null instead of a fake timestamp.
UPDATE "Users" SET "lastSeenAt" = NULL WHERE "lastSeenAt" = "createdAt";
