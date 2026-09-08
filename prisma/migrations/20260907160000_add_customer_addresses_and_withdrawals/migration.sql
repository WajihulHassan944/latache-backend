-- CreateTable
CREATE TABLE "CustomerAddresses" (
    "id" VARCHAR(40) NOT NULL,
    "customerId" INTEGER NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "address" VARCHAR(500) NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerAddresses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_addresses_customer_default_idx" ON "CustomerAddresses"("customerId", "isDefault");

-- AddForeignKey
ALTER TABLE "CustomerAddresses" ADD CONSTRAINT "CustomerAddresses_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "CustomerWithdrawals" (
    "id" VARCHAR(40) NOT NULL,
    "customerId" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending_review',
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "providerReference" VARCHAR(255),
    "failureReason" VARCHAR(500),
    "reviewedById" INTEGER,
    "reviewedAt" TIMESTAMPTZ(6),
    "adminNote" VARCHAR(1000),
    "requestedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerWithdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_withdrawals_customer_idempotency_unique" ON "CustomerWithdrawals"("customerId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "customer_withdrawals_customer_status_requested_idx" ON "CustomerWithdrawals"("customerId", "status", "requestedAt");

-- AddForeignKey
ALTER TABLE "CustomerWithdrawals" ADD CONSTRAINT "CustomerWithdrawals_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "CustomerWalletLedger" ADD COLUMN "withdrawalId" VARCHAR(40);

-- CreateIndex
CREATE INDEX "customer_wallet_ledger_withdrawal_idx" ON "CustomerWalletLedger"("withdrawalId");

-- AddForeignKey
ALTER TABLE "CustomerWalletLedger" ADD CONSTRAINT "CustomerWalletLedger_withdrawalId_fkey" FOREIGN KEY ("withdrawalId") REFERENCES "CustomerWithdrawals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
