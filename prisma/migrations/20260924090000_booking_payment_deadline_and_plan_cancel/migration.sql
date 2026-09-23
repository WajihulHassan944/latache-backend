-- AlterTable
ALTER TABLE "TaskerSubscriptions" ADD COLUMN     "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Bookings" ADD COLUMN     "paymentDueAt" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "bookings_payment_due_idx" ON "Bookings"("status", "paymentDueAt");


-- Bookings already waiting for payment when this ships get a fresh default
-- window (60 min) instead of being cancelled the moment the sweep first runs.
UPDATE "Bookings"
SET "paymentDueAt" = NOW() + INTERVAL '60 minutes'
WHERE "status" = 'awaiting_payment' AND "paymentDueAt" IS NULL;
