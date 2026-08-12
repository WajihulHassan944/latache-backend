-- Additive Tasker earnings-clearance and cash platform-payable accounting.
-- Existing wallet balances and historical ledger entries are intentionally untouched.

CREATE TABLE "TaskerEarnings" (
    "id" VARCHAR(40) NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "taskerId" INTEGER NOT NULL,
    "paymentSource" VARCHAR(32) NOT NULL,
    "grossCustomerAmount" DECIMAL(14,2) NOT NULL,
    "serviceAmount" DECIMAL(14,2) NOT NULL,
    "platformCommissionAmount" DECIMAL(14,2) NOT NULL,
    "taxAmount" DECIMAL(14,2) NOT NULL,
    "serviceSurchargeAmount" DECIMAL(14,2) NOT NULL,
    "tipAmount" DECIMAL(14,2) NOT NULL,
    "donationAmount" DECIMAL(14,2) NOT NULL,
    "taskerNetAmount" DECIMAL(14,2) NOT NULL,
    "reversedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "debtOffsetAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "releasedToAvailableAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "blockReason" VARCHAR(1000),
    "blockedAt" TIMESTAMPTZ(6),
    "holdExtendedUntil" TIMESTAMPTZ(6),
    "reversalReason" VARCHAR(1000),
    "providerSettlementReference" VARCHAR(255) NOT NULL,
    "settledAt" TIMESTAMPTZ(6) NOT NULL,
    "clearsAt" TIMESTAMPTZ(6) NOT NULL,
    "releasedAt" TIMESTAMPTZ(6),
    "reversedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskerEarnings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaskerPlatformAccounts" (
    "taskerId" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "outstandingPayable" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cashBookingsRestricted" BOOLEAN NOT NULL DEFAULT false,
    "restrictionReason" VARCHAR(500),
    "restrictionUpdatedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskerPlatformAccounts_pkey" PRIMARY KEY ("taskerId")
);

CREATE TABLE "TaskerPlatformReceivables" (
    "id" VARCHAR(40) NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "taskerId" INTEGER NOT NULL,
    "confirmedById" INTEGER NOT NULL,
    "confirmationIdempotencyKey" VARCHAR(180) NOT NULL,
    "cashCollectedAmount" DECIMAL(14,2) NOT NULL,
    "serviceAmount" DECIMAL(14,2) NOT NULL,
    "platformCommissionAmount" DECIMAL(14,2) NOT NULL,
    "taxAmount" DECIMAL(14,2) NOT NULL,
    "serviceSurchargeAmount" DECIMAL(14,2) NOT NULL,
    "tipAmount" DECIMAL(14,2) NOT NULL,
    "donationAmount" DECIMAL(14,2) NOT NULL,
    "taskerEconomicEarning" DECIMAL(14,2) NOT NULL,
    "originalPayableAmount" DECIMAL(14,2) NOT NULL,
    "outstandingAmount" DECIMAL(14,2) NOT NULL,
    "settledAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "reversedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'outstanding',
    "isDisputed" BOOLEAN NOT NULL DEFAULT false,
    "disputeBlockReason" VARCHAR(1000),
    "disputeBlockedAt" TIMESTAMPTZ(6),
    "disputeClearsAt" TIMESTAMPTZ(6) NOT NULL,
    "confirmedAt" TIMESTAMPTZ(6) NOT NULL,
    "clearedAt" TIMESTAMPTZ(6),
    "settledAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskerPlatformReceivables_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaskerPlatformLedger" (
    "id" VARCHAR(40) NOT NULL,
    "taskerId" INTEGER NOT NULL,
    "bookingId" INTEGER,
    "receivableId" VARCHAR(40),
    "earningId" VARCHAR(40),
    "kind" VARCHAR(48) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'settled',
    "amount" DECIMAL(14,2) NOT NULL,
    "payableDelta" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "externalReference" VARCHAR(255),
    "idempotencyKey" VARCHAR(180) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskerPlatformLedger_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TaskerWalletLedger" ADD COLUMN "earningId" VARCHAR(40);

CREATE UNIQUE INDEX "TaskerEarnings_bookingId_key" ON "TaskerEarnings"("bookingId");
CREATE INDEX "tasker_earnings_release_queue_idx" ON "TaskerEarnings"("status", "isBlocked", "clearsAt");
CREATE INDEX "tasker_earnings_tasker_status_clears_idx" ON "TaskerEarnings"("taskerId", "status", "clearsAt");
CREATE INDEX "tasker_earnings_provider_reference_idx" ON "TaskerEarnings"("providerSettlementReference");

CREATE INDEX "tasker_platform_accounts_restriction_idx" ON "TaskerPlatformAccounts"("cashBookingsRestricted", "outstandingPayable");

CREATE UNIQUE INDEX "TaskerPlatformReceivables_bookingId_key" ON "TaskerPlatformReceivables"("bookingId");
CREATE UNIQUE INDEX "TaskerPlatformReceivables_confirmation_key" ON "TaskerPlatformReceivables"("confirmationIdempotencyKey");
CREATE INDEX "tasker_platform_receivables_tasker_status_idx" ON "TaskerPlatformReceivables"("taskerId", "status", "createdAt");
CREATE INDEX "tasker_platform_receivables_clearance_idx" ON "TaskerPlatformReceivables"("status", "isDisputed", "disputeClearsAt");

CREATE UNIQUE INDEX "TaskerPlatformLedger_idempotencyKey_key" ON "TaskerPlatformLedger"("idempotencyKey");
CREATE INDEX "tasker_platform_ledger_tasker_created_idx" ON "TaskerPlatformLedger"("taskerId", "createdAt");
CREATE INDEX "tasker_platform_ledger_receivable_created_idx" ON "TaskerPlatformLedger"("receivableId", "createdAt");
CREATE INDEX "tasker_platform_ledger_earning_created_idx" ON "TaskerPlatformLedger"("earningId", "createdAt");
CREATE INDEX "tasker_platform_ledger_booking_idx" ON "TaskerPlatformLedger"("bookingId");
CREATE INDEX "tasker_wallet_ledger_earning_idx" ON "TaskerWalletLedger"("earningId");

ALTER TABLE "TaskerEarnings"
    ADD CONSTRAINT "TaskerEarnings_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "TaskerEarnings_taskerId_fkey" FOREIGN KEY ("taskerId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TaskerPlatformAccounts"
    ADD CONSTRAINT "TaskerPlatformAccounts_taskerId_fkey" FOREIGN KEY ("taskerId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TaskerPlatformReceivables"
    ADD CONSTRAINT "TaskerPlatformReceivables_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "TaskerPlatformReceivables_taskerId_fkey" FOREIGN KEY ("taskerId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "TaskerPlatformReceivables_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TaskerPlatformLedger"
    ADD CONSTRAINT "TaskerPlatformLedger_taskerId_fkey" FOREIGN KEY ("taskerId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "TaskerPlatformLedger_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "TaskerPlatformLedger_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "TaskerPlatformReceivables"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "TaskerPlatformLedger_earningId_fkey" FOREIGN KEY ("earningId") REFERENCES "TaskerEarnings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TaskerWalletLedger"
    ADD CONSTRAINT "TaskerWalletLedger_earningId_fkey" FOREIGN KEY ("earningId") REFERENCES "TaskerEarnings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TaskerEarnings"
    ADD CONSTRAINT "TaskerEarnings_amounts_nonnegative_check" CHECK (
        "grossCustomerAmount" >= 0 AND "serviceAmount" >= 0 AND
        "platformCommissionAmount" >= 0 AND "taxAmount" >= 0 AND
        "serviceSurchargeAmount" >= 0 AND "tipAmount" >= 0 AND
        "donationAmount" >= 0 AND "taskerNetAmount" >= 0 AND
        "reversedAmount" >= 0 AND "debtOffsetAmount" >= 0 AND
        "releasedToAvailableAmount" >= 0
    );

ALTER TABLE "TaskerPlatformAccounts"
    ADD CONSTRAINT "TaskerPlatformAccounts_payable_nonnegative_check" CHECK ("outstandingPayable" >= 0);

ALTER TABLE "TaskerPlatformReceivables"
    ADD CONSTRAINT "TaskerPlatformReceivables_amounts_nonnegative_check" CHECK (
        "cashCollectedAmount" >= 0 AND "serviceAmount" >= 0 AND
        "platformCommissionAmount" >= 0 AND "taxAmount" >= 0 AND
        "serviceSurchargeAmount" >= 0 AND "tipAmount" >= 0 AND
        "donationAmount" >= 0 AND "taskerEconomicEarning" >= 0 AND
        "originalPayableAmount" >= 0 AND "outstandingAmount" >= 0 AND
        "settledAmount" >= 0 AND "reversedAmount" >= 0
    ),
    ADD CONSTRAINT "TaskerPlatformReceivables_allocation_check" CHECK (
        "outstandingAmount" + "settledAmount" + "reversedAmount" = "originalPayableAmount"
    );
