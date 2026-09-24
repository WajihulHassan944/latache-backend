-- AlterTable
ALTER TABLE "Bookings" ALTER COLUMN "paymentSource" DROP NOT NULL,
ALTER COLUMN "paymentSource" DROP DEFAULT;

