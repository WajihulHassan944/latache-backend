-- AlterTable
ALTER TABLE "Bookings" ADD COLUMN     "isCustomTime" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: bookings already carried on a dedicated custom-time slot.
UPDATE "Bookings" b
SET "isCustomTime" = true
FROM "UserAvailabilities" a
WHERE a."id" = b."availabilityId" AND a."isCustom" = true;
