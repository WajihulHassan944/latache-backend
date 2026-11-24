-- AlterTable
ALTER TABLE "Bookings" ADD COLUMN     "cancellationFeeAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CustomerWithdrawals" ADD COLUMN     "destinationHolder" VARCHAR(120),
ADD COLUMN     "destinationMasked" VARCHAR(120),
ADD COLUMN     "destinationType" VARCHAR(32),
ADD COLUMN     "encryptedDestination" TEXT;

