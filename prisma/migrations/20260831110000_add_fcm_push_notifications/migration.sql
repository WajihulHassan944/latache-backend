CREATE TABLE "FcmDeviceTokens" (
  "id" VARCHAR(40) NOT NULL,
  "userId" INTEGER NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL,
  "token" VARCHAR(4096) NOT NULL,
  "platform" VARCHAR(16) NOT NULL,
  "deviceId" VARCHAR(255),
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "lastSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disabledAt" TIMESTAMPTZ(6),
  "lastError" VARCHAR(1000),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FcmDeviceTokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FcmDeviceTokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "fcm_device_tokens_token_hash_key" ON "FcmDeviceTokens"("tokenHash");
CREATE INDEX "fcm_device_tokens_user_enabled_idx" ON "FcmDeviceTokens"("userId", "enabled", "updatedAt");

CREATE TABLE "FcmPushDeliveries" (
  "id" VARCHAR(80) NOT NULL,
  "notificationId" VARCHAR(40) NOT NULL,
  "deviceTokenId" VARCHAR(40) NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "body" VARCHAR(500) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMPTZ(6),
  "lockToken" VARCHAR(64),
  "lastError" VARCHAR(1000),
  "sentAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FcmPushDeliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FcmPushDeliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "TaskNotifications"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FcmPushDeliveries_deviceTokenId_fkey" FOREIGN KEY ("deviceTokenId") REFERENCES "FcmDeviceTokens"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "fcm_push_deliveries_notification_device_unique" ON "FcmPushDeliveries"("notificationId", "deviceTokenId");
CREATE INDEX "fcm_push_deliveries_queue_idx" ON "FcmPushDeliveries"("status", "nextAttemptAt", "lockedAt", "createdAt");
