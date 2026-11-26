-- CreateTable
CREATE TABLE "LedgerAccounts" (
    "id" VARCHAR(40) NOT NULL,
    "code" VARCHAR(12) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" VARCHAR(16) NOT NULL,
    "description" VARCHAR(500),
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isControl" BOOLEAN NOT NULL DEFAULT false,
    "isCash" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerAccounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntries" (
    "id" VARCHAR(40) NOT NULL,
    "number" SERIAL NOT NULL,
    "entryDate" DATE NOT NULL,
    "memo" VARCHAR(500) NOT NULL,
    "source" VARCHAR(16) NOT NULL,
    "sourceType" VARCHAR(48),
    "sourceKey" VARCHAR(200),
    "bookingId" INTEGER,
    "reference" VARCHAR(255),
    "reversalOfId" VARCHAR(40),
    "createdById" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLines" (
    "id" VARCHAR(40) NOT NULL,
    "entryId" VARCHAR(40) NOT NULL,
    "accountId" VARCHAR(40) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "memo" VARCHAR(500),
    "bookingId" INTEGER,
    "originalAmount" DECIMAL(14,2),
    "originalCurrency" VARCHAR(3),

    CONSTRAINT "JournalLines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingExpenses" (
    "id" VARCHAR(40) NOT NULL,
    "expenseDate" DATE NOT NULL,
    "accountId" VARCHAR(40) NOT NULL,
    "vendor" VARCHAR(160) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "netAmount" DECIMAL(14,2) NOT NULL,
    "vatAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "paidFromId" VARCHAR(40),
    "paidDate" DATE,
    "reference" VARCHAR(255),
    "voidReason" VARCHAR(500),
    "createdById" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingExpenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccounts_code_key" ON "LedgerAccounts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntries_number_key" ON "JournalEntries"("number");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntries_sourceKey_key" ON "JournalEntries"("sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntries_reversalOfId_key" ON "JournalEntries"("reversalOfId");

-- CreateIndex
CREATE INDEX "journal_entries_date_number_idx" ON "JournalEntries"("entryDate", "number");

-- CreateIndex
CREATE INDEX "journal_entries_booking_idx" ON "JournalEntries"("bookingId");

-- CreateIndex
CREATE INDEX "journal_lines_entry_idx" ON "JournalLines"("entryId");

-- CreateIndex
CREATE INDEX "journal_lines_account_idx" ON "JournalLines"("accountId");

-- CreateIndex
CREATE INDEX "journal_lines_account_booking_idx" ON "JournalLines"("accountId", "bookingId");

-- CreateIndex
CREATE INDEX "accounting_expenses_date_idx" ON "AccountingExpenses"("expenseDate");

-- CreateIndex
CREATE INDEX "accounting_expenses_status_date_idx" ON "AccountingExpenses"("status", "expenseDate");

-- AddForeignKey
ALTER TABLE "JournalLines" ADD CONSTRAINT "JournalLines_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLines" ADD CONSTRAINT "JournalLines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingExpenses" ADD CONSTRAINT "AccountingExpenses_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingExpenses" ADD CONSTRAINT "AccountingExpenses_paidFromId_fkey" FOREIGN KEY ("paidFromId") REFERENCES "LedgerAccounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

