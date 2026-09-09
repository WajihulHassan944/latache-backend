-- DropIndex
DROP INDEX "users_location_idx";

-- AlterTable
ALTER TABLE "Users" DROP COLUMN "latitude",
DROP COLUMN "locationUpdatedAt",
DROP COLUMN "longitude";
