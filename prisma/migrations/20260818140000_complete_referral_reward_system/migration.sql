-- Additive referral attribution, qualification, immutable reward accounting,
-- wallet linkage, and booking-discount snapshots. Existing rows remain valid.

ALTER TABLE "Users"
  ADD COLUMN "referralCode" VARCHAR(20);

CREATE UNIQUE INDEX "Users_referralCode_key" ON "Users"("referralCode");

ALTER TABLE "Bookings"
  ADD COLUMN "referralDiscountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "referralDiscountPercent" DECIMAL(7,4) NOT NULL DEFAULT 0;

ALTER TABLE "Bookings"
  ADD CONSTRAINT "Bookings_referralDiscountAmount_check"
    CHECK ("referralDiscountAmount" >= 0),
  ADD CONSTRAINT "Bookings_referralDiscountPercent_check"
    CHECK ("referralDiscountPercent" >= 0 AND "referralDiscountPercent" <= 100);

CREATE TABLE "Referrals" (
  "id" VARCHAR(40) NOT NULL,
  "referrerId" INTEGER NOT NULL,
  "referredUserId" INTEGER NOT NULL,
  "qualifyingBookingId" INTEGER,
  "program" VARCHAR(24) NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'claimed',
  "codeSnapshot" VARCHAR(20) NOT NULL,
  "policyVersion" INTEGER NOT NULL,
  "policySnapshot" JSONB NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "qualifiedAt" TIMESTAMPTZ(6),
  "rewardedAt" TIMESTAMPTZ(6),
  "revokedAt" TIMESTAMPTZ(6),
  "revokedById" INTEGER,
  "revocationReason" VARCHAR(1000),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Referrals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Referrals_program_check" CHECK ("program" IN ('customer', 'tasker')),
  CONSTRAINT "Referrals_status_check"
    CHECK ("status" IN ('claimed', 'qualified', 'rewarded', 'expired', 'revoked')),
  CONSTRAINT "Referrals_distinct_users_check" CHECK ("referrerId" <> "referredUserId")
);

CREATE UNIQUE INDEX "Referrals_referredUserId_key" ON "Referrals"("referredUserId");
CREATE INDEX "referrals_referrer_status_created_idx"
  ON "Referrals"("referrerId", "status", "createdAt");
CREATE INDEX "referrals_program_status_created_idx"
  ON "Referrals"("program", "status", "createdAt");
CREATE INDEX "referrals_expiry_queue_idx"
  ON "Referrals"("status", "expiresAt", "id");
CREATE INDEX "referrals_qualifying_booking_idx"
  ON "Referrals"("qualifyingBookingId");

ALTER TABLE "Referrals"
  ADD CONSTRAINT "Referrals_referrerId_fkey"
    FOREIGN KEY ("referrerId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Referrals_referredUserId_fkey"
    FOREIGN KEY ("referredUserId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Referrals_qualifyingBookingId_fkey"
    FOREIGN KEY ("qualifyingBookingId") REFERENCES "Bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ReferralRewards" (
  "id" VARCHAR(40) NOT NULL,
  "referralId" VARCHAR(40) NOT NULL,
  "recipientId" INTEGER NOT NULL,
  "bookingId" INTEGER NOT NULL,
  "recipientRole" VARCHAR(24) NOT NULL,
  "kind" VARCHAR(48) NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
  "amount" DECIMAL(14,2) NOT NULL,
  "settledAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "reversedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "walletCreditAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "currency" VARCHAR(3) NOT NULL,
  "policySnapshot" JSONB NOT NULL,
  "idempotencyKey" VARCHAR(180) NOT NULL,
  "availableAt" TIMESTAMPTZ(6) NOT NULL,
  "settledAt" TIMESTAMPTZ(6),
  "reversedAt" TIMESTAMPTZ(6),
  "cancellationReason" VARCHAR(1000),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReferralRewards_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReferralRewards_status_check"
    CHECK ("status" IN ('pending', 'settled', 'reversed', 'cancelled')),
  CONSTRAINT "ReferralRewards_amounts_check"
    CHECK (
      "amount" >= 0 AND "settledAmount" >= 0 AND "reversedAmount" >= 0
      AND "walletCreditAmount" >= 0
      AND "settledAmount" <= "amount"
      AND "reversedAmount" <= "settledAmount"
      AND "walletCreditAmount" <= "settledAmount"
    )
);

CREATE UNIQUE INDEX "ReferralRewards_idempotencyKey_key"
  ON "ReferralRewards"("idempotencyKey");
CREATE UNIQUE INDEX "referral_rewards_referral_recipient_kind_unique"
  ON "ReferralRewards"("referralId", "recipientId", "kind");
CREATE INDEX "referral_rewards_release_queue_idx"
  ON "ReferralRewards"("status", "availableAt", "id");
CREATE INDEX "referral_rewards_recipient_created_idx"
  ON "ReferralRewards"("recipientId", "createdAt");
CREATE INDEX "referral_rewards_booking_status_idx"
  ON "ReferralRewards"("bookingId", "status");

ALTER TABLE "ReferralRewards"
  ADD CONSTRAINT "ReferralRewards_referralId_fkey"
    FOREIGN KEY ("referralId") REFERENCES "Referrals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ReferralRewards_recipientId_fkey"
    FOREIGN KEY ("recipientId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ReferralRewards_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "Bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerWalletLedger"
  ADD COLUMN "referralRewardId" VARCHAR(40);

CREATE INDEX "customer_wallet_ledger_referral_reward_idx"
  ON "CustomerWalletLedger"("referralRewardId", "createdAt");

ALTER TABLE "CustomerWalletLedger"
  ADD CONSTRAINT "CustomerWalletLedger_referralRewardId_fkey"
    FOREIGN KEY ("referralRewardId") REFERENCES "ReferralRewards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TaskerWalletLedger"
  ADD COLUMN "referralRewardId" VARCHAR(40);

CREATE INDEX "tasker_wallet_ledger_referral_reward_idx"
  ON "TaskerWalletLedger"("referralRewardId", "createdAt");

ALTER TABLE "TaskerWalletLedger"
  ADD CONSTRAINT "TaskerWalletLedger_referralRewardId_fkey"
    FOREIGN KEY ("referralRewardId") REFERENCES "ReferralRewards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
