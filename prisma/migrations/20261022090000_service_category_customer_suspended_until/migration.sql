-- AlterTable
ALTER TABLE "Services" ADD COLUMN     "category" VARCHAR(120);

-- AlterTable
ALTER TABLE "CustomerProfiles" ADD COLUMN     "suspendedUntil" TIMESTAMPTZ(6);
