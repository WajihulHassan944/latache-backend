-- AlterTable
ALTER TABLE "TaskWorkSessions" ADD COLUMN     "stopReason" VARCHAR(48);

-- CreateTable
CREATE TABLE "TaskerDeposits" (
    "id" VARCHAR(40) NOT NULL,
    "taskerId" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'pending',
    "paymentMethod" VARCHAR(24),
    "providerReference" VARCHAR(255),
    "paidAt" TIMESTAMPTZ(6),
    "waivedAt" TIMESTAMPTZ(6),
    "refundedAt" TIMESTAMPTZ(6),
    "reviewedById" INTEGER,
    "adminNote" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskerDeposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoices" (
    "id" VARCHAR(40) NOT NULL,
    "number" VARCHAR(32) NOT NULL,
    "type" VARCHAR(24) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'issued',
    "billedToId" INTEGER NOT NULL,
    "bookingId" INTEGER,
    "taskerDepositId" VARCHAR(40),
    "currency" VARCHAR(3) NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "platformFee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "paymentMethod" VARCHAR(24),
    "lines" JSONB NOT NULL,
    "details" JSONB,
    "seller" JSONB NOT NULL,
    "buyer" JSONB NOT NULL,
    "issuedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskerDeposits_taskerId_key" ON "TaskerDeposits"("taskerId");

-- CreateIndex
CREATE INDEX "tasker_deposits_status_created_idx" ON "TaskerDeposits"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoices_number_key" ON "Invoices"("number");

-- CreateIndex
CREATE INDEX "invoices_billed_to_issued_idx" ON "Invoices"("billedToId", "issuedAt");

-- CreateIndex
CREATE INDEX "invoices_issued_idx" ON "Invoices"("issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_type_booking_unique" ON "Invoices"("type", "bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_type_deposit_unique" ON "Invoices"("type", "taskerDepositId");

-- AddForeignKey
ALTER TABLE "TaskerDeposits" ADD CONSTRAINT "TaskerDeposits_taskerId_fkey" FOREIGN KEY ("taskerId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoices" ADD CONSTRAINT "Invoices_billedToId_fkey" FOREIGN KEY ("billedToId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoices" ADD CONSTRAINT "Invoices_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoices" ADD CONSTRAINT "Invoices_taskerDepositId_fkey" FOREIGN KEY ("taskerDepositId") REFERENCES "TaskerDeposits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Gap-free-enough, concurrency-safe invoice numbering (INV-YYYY-000001).
CREATE SEQUENCE IF NOT EXISTS "invoice_number_seq" START 1;
