ALTER TABLE "Bookings"
  ADD COLUMN "capturedAmount" DECIMAL(14,2),
  ADD COLUMN "amountCapturedAt" TIMESTAMPTZ(6);
