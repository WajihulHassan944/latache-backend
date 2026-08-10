-- Customer dashboard + shared-role APIs + Stripe payment infrastructure.
-- Additive migration: existing Auth/RBAC/Tasker dashboard data remains intact.

ALTER TABLE "Users"
  ADD COLUMN IF NOT EXISTS "stripeCustomerId" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "defaultStripePaymentMethodId" VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS "Users_stripeCustomerId_key"
  ON "Users"("stripeCustomerId");

CREATE TABLE IF NOT EXISTS "ServiceOptions" (
  "id" SERIAL PRIMARY KEY,
  "serviceId" INTEGER NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "slug" VARCHAR(120) NOT NULL,
  "description" VARCHAR(500),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ServiceOptions_serviceId_fkey"
    FOREIGN KEY ("serviceId") REFERENCES "Services"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "service_options_service_slug_unique"
  ON "ServiceOptions"("serviceId", "slug");
CREATE INDEX IF NOT EXISTS "service_options_service_active_sort_idx"
  ON "ServiceOptions"("serviceId", "isActive", "sortOrder");

ALTER TABLE "Bookings"
  ADD COLUMN IF NOT EXISTS "serviceOptionId" INTEGER,
  ADD COLUMN IF NOT EXISTS "rescheduledAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "estimatedDurationMinutes" INTEGER NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS "extensionMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "paymentSource" VARCHAR(32) NOT NULL DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS "paymentStatus" VARCHAR(48) NOT NULL DEFAULT 'payment_method_required',
  ADD COLUMN IF NOT EXISTS "paymentCurrency" VARCHAR(3) NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS "stripePaymentMethodId" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "stripePaymentIntentId" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "serviceAmount" DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "platformFeeAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "tipAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "donationAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "donationDropoffRequested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "totalChargedAmount" DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "paymentFailureReason" VARCHAR(1000),
  ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMPTZ(6);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Bookings_serviceOptionId_fkey'
  ) THEN
    ALTER TABLE "Bookings"
      ADD CONSTRAINT "Bookings_serviceOptionId_fkey"
      FOREIGN KEY ("serviceOptionId") REFERENCES "ServiceOptions"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Bookings_stripePaymentIntentId_key"
  ON "Bookings"("stripePaymentIntentId");
CREATE INDEX IF NOT EXISTS "bookings_customer_status_date_idx"
  ON "Bookings"("customerId", "status", "bookingDate");
CREATE INDEX IF NOT EXISTS "bookings_payment_status_updated_idx"
  ON "Bookings"("paymentStatus", "updatedAt");
CREATE INDEX IF NOT EXISTS "bookings_service_option_idx"
  ON "Bookings"("serviceOptionId");

-- Existing bookings predate Stripe collection. Mark them explicitly as legacy rather
-- than pretending they have a valid saved payment method.
UPDATE "Bookings"
SET "paymentStatus" = 'legacy_untracked'
WHERE "stripePaymentMethodId" IS NULL
  AND "stripePaymentIntentId" IS NULL
  AND "paymentStatus" = 'payment_method_required';

CREATE TABLE IF NOT EXISTS "FavoriteTaskers" (
  "id" VARCHAR(40) PRIMARY KEY,
  "customerId" INTEGER NOT NULL,
  "taskerId" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FavoriteTaskers_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FavoriteTaskers_taskerId_fkey"
    FOREIGN KEY ("taskerId") REFERENCES "Users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "favorite_taskers_not_self"
    CHECK ("customerId" <> "taskerId")
);

CREATE UNIQUE INDEX IF NOT EXISTS "favorite_taskers_customer_tasker_unique"
  ON "FavoriteTaskers"("customerId", "taskerId");
CREATE INDEX IF NOT EXISTS "favorite_taskers_customer_created_idx"
  ON "FavoriteTaskers"("customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "favorite_taskers_tasker_idx"
  ON "FavoriteTaskers"("taskerId");

CREATE TABLE IF NOT EXISTS "CustomerWallets" (
  "customerId" INTEGER PRIMARY KEY,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
  "availableBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerWallets_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_wallet_non_negative"
    CHECK ("availableBalance" >= 0)
);

CREATE TABLE IF NOT EXISTS "CustomerWalletLedger" (
  "id" VARCHAR(40) PRIMARY KEY,
  "customerId" INTEGER NOT NULL,
  "bookingId" INTEGER,
  "kind" VARCHAR(48) NOT NULL,
  "status" VARCHAR(32) NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "balanceDelta" DECIMAL(14,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "description" VARCHAR(500) NOT NULL,
  "providerReference" VARCHAR(255),
  "idempotencyKey" VARCHAR(180) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerWalletLedger_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CustomerWalletLedger_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "Bookings"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "CustomerWalletLedger_idempotencyKey_key"
  ON "CustomerWalletLedger"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "customer_wallet_ledger_customer_created_idx"
  ON "CustomerWalletLedger"("customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "customer_wallet_ledger_booking_idx"
  ON "CustomerWalletLedger"("bookingId");

CREATE TABLE IF NOT EXISTS "PaymentTransactions" (
  "id" VARCHAR(40) PRIMARY KEY,
  "customerId" INTEGER NOT NULL,
  "bookingId" INTEGER,
  "kind" VARCHAR(48) NOT NULL,
  "provider" VARCHAR(32) NOT NULL DEFAULT 'stripe',
  "providerReference" VARCHAR(255),
  "status" VARCHAR(48) NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "failureReason" VARCHAR(1000),
  "idempotencyKey" VARCHAR(180) NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentTransactions_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PaymentTransactions_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "Bookings"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentTransactions_providerReference_key"
  ON "PaymentTransactions"("providerReference");
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentTransactions_idempotencyKey_key"
  ON "PaymentTransactions"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "payment_transactions_customer_created_idx"
  ON "PaymentTransactions"("customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "payment_transactions_booking_status_idx"
  ON "PaymentTransactions"("bookingId", "status");

CREATE TABLE IF NOT EXISTS "StripeWebhookEvents" (
  "id" VARCHAR(255) PRIMARY KEY,
  "type" VARCHAR(120) NOT NULL,
  "processedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "stripe_webhook_events_processed_idx"
  ON "StripeWebhookEvents"("processedAt");
