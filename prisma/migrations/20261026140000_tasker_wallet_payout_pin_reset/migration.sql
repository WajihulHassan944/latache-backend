-- AlterTable
ALTER TABLE "TaskerWallets" ADD COLUMN     "payoutPinResetCodeHash" VARCHAR(64),
ADD COLUMN     "payoutPinResetExpires" TIMESTAMPTZ(6),
ADD COLUMN     "payoutPinResetAttempts" INTEGER NOT NULL DEFAULT 0;
