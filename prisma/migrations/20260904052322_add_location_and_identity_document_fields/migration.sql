-- AlterTable
ALTER TABLE "GuestSessions" ADD COLUMN     "latitude" DECIMAL(9,6),
ADD COLUMN     "locationUpdatedAt" TIMESTAMPTZ(6),
ADD COLUMN     "longitude" DECIMAL(9,6);

-- AlterTable
ALTER TABLE "Users" ADD COLUMN     "latitude" DECIMAL(9,6),
ADD COLUMN     "locationUpdatedAt" TIMESTAMPTZ(6),
ADD COLUMN     "longitude" DECIMAL(9,6);

-- CreateIndex
CREATE INDEX "guest_sessions_location_idx" ON "GuestSessions"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "users_location_idx" ON "Users"("latitude", "longitude");
