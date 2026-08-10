-- Finance operations and platform-settings foundation.
-- This migration is additive and does not create synthetic transactions,
-- refunds, payouts, revenue, exchange rates, taxes, or referral activity.

ALTER TABLE "Bookings"
  ADD COLUMN IF NOT EXISTS "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "commissionRatePercent" DECIMAL(7,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "taxRatePercent" DECIMAL(7,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "taxInclusive" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "serviceSurchargeAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "TaskerWithdrawals"
  ADD COLUMN IF NOT EXISTS "reviewedById" INTEGER,
  ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "adminNote" VARCHAR(1000);

CREATE INDEX IF NOT EXISTS "tasker_withdrawals_status_requested_idx"
  ON "TaskerWithdrawals"("status", "requestedAt");

CREATE TABLE IF NOT EXISTS "PlatformSettings" (
  "key" VARCHAR(64) NOT NULL,
  "value" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedById" INTEGER,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("key")
);

CREATE INDEX IF NOT EXISTS "platform_settings_updated_idx"
  ON "PlatformSettings"("updatedAt");

-- Existing RBAC role rows may predate the new settings permission catalogue.
-- Add only the non-escalating read permission to finance/operations roles.
UPDATE "RbacRoles"
SET "permissions" = CASE
  WHEN NOT ('settings.read' = ANY("permissions"))
    THEN array_append("permissions", 'settings.read')
  ELSE "permissions"
END,
"updatedAt" = CURRENT_TIMESTAMP
WHERE "code" IN ('finance_admin', 'operations_admin', 'analytics_admin')
  AND "deletedAt" IS NULL;
