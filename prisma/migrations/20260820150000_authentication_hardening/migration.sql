-- Authentication hardening: database-backed local-login lockout.
-- Additive only; existing identities, roles, sessions and provider mappings are preserved.

ALTER TABLE "Users"
  ADD COLUMN "loginFailedAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "loginLockedUntil" TIMESTAMPTZ(6),
  ADD COLUMN "lastFailedLoginAt" TIMESTAMPTZ(6);

CREATE INDEX "users_login_locked_until_idx"
  ON "Users"("loginLockedUntil");
