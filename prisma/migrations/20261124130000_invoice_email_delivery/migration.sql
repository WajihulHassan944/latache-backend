-- AlterTable
ALTER TABLE "Invoices" ADD COLUMN     "emailAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "emailedAt" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "invoices_email_pending_idx" ON "Invoices"("emailedAt", "emailAttempts");

