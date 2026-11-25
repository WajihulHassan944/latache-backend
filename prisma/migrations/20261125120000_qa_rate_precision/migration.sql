-- Tasker hourly rates are kept in the canonical (USD) unit and shown in the
-- platform currency. 2 decimals made 65 MAD round-trip to 64.98 MAD; keep 6.
ALTER TABLE "UserServices" ALTER COLUMN "hourlyRate" TYPE DECIMAL(14,6);

-- Repair rows that only carry the old rounding artefact (a whole MAD amount
-- stored as 2-decimal USD): snap to the exact whole-MAD value. Morocco market only.
UPDATE "UserServices"
SET "hourlyRate" = ROUND("hourlyRate" * 9) / 9
WHERE ABS("hourlyRate" * 9 - ROUND("hourlyRate" * 9)) <= 0.05
  AND "hourlyRate" > 0
  AND (SELECT "value"->>'primaryMarket' FROM "PlatformSettings" WHERE "key" = 'currency') = 'morocco';
