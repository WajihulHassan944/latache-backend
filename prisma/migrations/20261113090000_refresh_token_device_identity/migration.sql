-- AlterTable
ALTER TABLE "RefreshTokens" ADD COLUMN "deviceId" VARCHAR(64),
ADD COLUMN "deviceName" VARCHAR(255);

-- CreateIndex
CREATE INDEX "refresh_tokens_user_device_idx" ON "RefreshTokens"("userId", "deviceId");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_idx" ON "RefreshTokens"("expiresAt");
