-- Auth-domain expansion inspired by the reference Gift App architecture.
-- Additive and safe for existing Latache PostgreSQL databases.

ALTER TABLE "Users"
  ADD COLUMN IF NOT EXISTS "phoneCountryCode" VARCHAR(8) DEFAULT '',
  ADD COLUMN IF NOT EXISTS "otpAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "passwordResetAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "accountStatus" VARCHAR(32) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "adminRole" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "permissions" VARCHAR(100)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(100)[],
  ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "acceptedTermsAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "acceptedPrivacyAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "createdById" INTEGER,
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "hourlyRate" DECIMAL(10,2);

ALTER TABLE "RefreshTokens"
  ADD COLUMN IF NOT EXISTS "ipAddress" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "userAgent" VARCHAR(512),
  ADD COLUMN IF NOT EXISTS "lastUsedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Preserve existing records while assigning coherent auth states.
UPDATE "Users"
SET "accountStatus" = CASE
  WHEN "isVerified" = false THEN 'pending_verification'
  WHEN "role" = 'tasker' AND COALESCE("onboardingStatus", '') IN ('submitted', 'pending_review') THEN 'pending_approval'
  ELSE COALESCE(NULLIF("accountStatus", ''), 'active')
END
WHERE "accountStatus" NOT IN ('suspended', 'deactivated');

UPDATE "Users"
SET "adminRole" = 'custom_admin'
WHERE "role" = 'admin' AND "adminRole" IS NULL;

CREATE INDEX IF NOT EXISTS "users_role_status_idx"
  ON "Users"("role", "accountStatus");

CREATE INDEX IF NOT EXISTS "users_created_by_idx"
  ON "Users"("createdById");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Users_createdById_fkey'
  ) THEN
    ALTER TABLE "Users" ADD CONSTRAINT "Users_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "Users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
