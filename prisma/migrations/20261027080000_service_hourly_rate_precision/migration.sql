-- AlterTable
-- Widen USD-stored hourly rate bounds from Decimal(10,2) to Decimal(14,6).
-- Rounding these to 2 decimal places before storage was lossy when the active
-- platform currency's rateFromUsd is not 1 (e.g. Morocco MAD = 9): admin input
-- of 30 round-tripped to 29.97 after being converted to USD and back for display.
ALTER TABLE "Services" ALTER COLUMN "minHourlyRateUsd" TYPE DECIMAL(14,6);
ALTER TABLE "Services" ALTER COLUMN "maxHourlyRateUsd" TYPE DECIMAL(14,6);
