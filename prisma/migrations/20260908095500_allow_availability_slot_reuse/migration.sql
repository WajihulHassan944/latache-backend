-- DropIndex
DROP INDEX "Bookings_availabilityId_key";

-- CreateIndex
CREATE INDEX "bookings_availability_idx" ON "Bookings"("availabilityId");
