-- Align the persisted booking capture timestamp with the public payment contract.
-- The conditional form is safe if the production DBA applied the same rename
-- before this migration reaches the migration ledger.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Bookings'
      AND column_name = 'amountCapturedAt'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Bookings'
      AND column_name = 'capturedAt'
  ) THEN
    ALTER TABLE "Bookings" RENAME COLUMN "amountCapturedAt" TO "capturedAt";
  END IF;
END $$;
