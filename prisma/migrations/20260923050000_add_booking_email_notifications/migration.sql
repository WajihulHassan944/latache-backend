-- Booking lifecycle emails + automated reminder/review-request sweep tracking.

ALTER TABLE "Bookings"
  ADD COLUMN "reminder24hSentAt" TIMESTAMPTZ(6),
  ADD COLUMN "reminder1hSentAt" TIMESTAMPTZ(6),
  ADD COLUMN "reviewRequestSentAt" TIMESTAMPTZ(6);

CREATE INDEX "bookings_reminder_24h_idx"
  ON "Bookings"("status", "bookingDate", "reminder24hSentAt");

CREATE INDEX "bookings_reminder_1h_idx"
  ON "Bookings"("status", "bookingDate", "reminder1hSentAt");

CREATE INDEX "bookings_review_request_idx"
  ON "Bookings"("status", "taskCompletedAt", "reviewRequestSentAt");

CREATE TABLE "EmailNotificationDeliveries" (
  "id"             VARCHAR(40) NOT NULL,
  "notificationId" VARCHAR(40) NOT NULL,
  "userId"         INTEGER NOT NULL,
  "status"         VARCHAR(16) NOT NULL DEFAULT 'pending',
  "attempts"       INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt"       TIMESTAMPTZ(6),
  "lockToken"      VARCHAR(64),
  "lastError"      VARCHAR(1000),
  "sentAt"         TIMESTAMPTZ(6),
  "createdAt"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "EmailNotificationDeliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_notification_deliveries_notification_unique"
  ON "EmailNotificationDeliveries"("notificationId");

CREATE INDEX "email_notification_deliveries_queue_idx"
  ON "EmailNotificationDeliveries"("status", "nextAttemptAt", "lockedAt", "createdAt");

ALTER TABLE "EmailNotificationDeliveries"
  ADD CONSTRAINT "EmailNotificationDeliveries_notificationId_fkey"
  FOREIGN KEY ("notificationId") REFERENCES "TaskNotifications"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmailNotificationDeliveries"
  ADD CONSTRAINT "EmailNotificationDeliveries_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "Users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
