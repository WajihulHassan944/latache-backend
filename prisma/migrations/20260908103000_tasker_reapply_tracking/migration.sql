-- AlterTable
ALTER TABLE "TaskerProfiles" ADD COLUMN "statusReasonCode" VARCHAR(64),
ADD COLUMN "reapplyCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastRejectedAt" TIMESTAMPTZ(6),
ADD COLUMN "lastRejectionReason" VARCHAR(1000),
ADD COLUMN "lastRejectionReasonCode" VARCHAR(64);
