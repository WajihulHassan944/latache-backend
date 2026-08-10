-- Tasker dashboard domain: task lifecycle, timer, navigation, messages,
-- notifications, reviews, wallet accounting and payout requests.
-- This migration intentionally does not fabricate financial ledger entries.

ALTER TABLE "Bookings"
  ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "enRouteAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "arrivedAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "taskStartedAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "taskCompletedAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "cancelledByRole" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "cancellationReason" VARCHAR(1000);

CREATE INDEX IF NOT EXISTS "bookings_tasker_status_date_idx"
  ON "Bookings"("taskerId", "status", "bookingDate");

CREATE TABLE IF NOT EXISTS "TaskWorkSessions" (
  "id" VARCHAR(40) NOT NULL,
  "bookingId" INTEGER NOT NULL,
  "taskerId" INTEGER NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'running',
  "startedAt" TIMESTAMPTZ(6) NOT NULL,
  "pausedAt" TIMESTAMPTZ(6),
  "accumulatedPausedSecs" INTEGER NOT NULL DEFAULT 0,
  "stoppedAt" TIMESTAMPTZ(6),
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskWorkSessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TaskWorkSessions_bookingId_key" UNIQUE ("bookingId"),
  CONSTRAINT "TaskWorkSessions_paused_nonnegative" CHECK ("accumulatedPausedSecs" >= 0)
);

CREATE TABLE IF NOT EXISTS "TaskerTaskLocations" (
  "id" VARCHAR(40) NOT NULL,
  "bookingId" INTEGER NOT NULL,
  "taskerId" INTEGER NOT NULL,
  "lat" DECIMAL(9,6) NOT NULL,
  "lng" DECIMAL(9,6) NOT NULL,
  "accuracyM" DECIMAL(8,2),
  "headingDeg" DECIMAL(6,2),
  "capturedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskerTaskLocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TaskerTaskLocations_bookingId_key" UNIQUE ("bookingId"),
  CONSTRAINT "TaskerTaskLocations_lat_check" CHECK ("lat" BETWEEN -90 AND 90),
  CONSTRAINT "TaskerTaskLocations_lng_check" CHECK ("lng" BETWEEN -180 AND 180),
  CONSTRAINT "TaskerTaskLocations_accuracy_check" CHECK ("accuracyM" IS NULL OR "accuracyM" >= 0),
  CONSTRAINT "TaskerTaskLocations_heading_check" CHECK ("headingDeg" IS NULL OR ("headingDeg" >= 0 AND "headingDeg" < 360))
);

CREATE TABLE IF NOT EXISTS "TaskComplaints" (
  "id" VARCHAR(40) NOT NULL,
  "bookingId" INTEGER NOT NULL,
  "filedById" INTEGER NOT NULL,
  "category" VARCHAR(64) NOT NULL,
  "description" TEXT NOT NULL,
  "attachments" JSONB,
  "status" VARCHAR(32) NOT NULL DEFAULT 'open',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskComplaints_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TaskMessages" (
  "id" VARCHAR(40) NOT NULL,
  "bookingId" INTEGER NOT NULL,
  "senderId" INTEGER NOT NULL,
  "body" TEXT,
  "attachments" JSONB,
  "readAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskMessages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TaskMessages_content_check" CHECK (
    ("body" IS NOT NULL AND length(trim("body")) > 0) OR "attachments" IS NOT NULL
  )
);

CREATE TABLE IF NOT EXISTS "TaskNotifications" (
  "id" VARCHAR(40) NOT NULL,
  "userId" INTEGER NOT NULL,
  "category" VARCHAR(32) NOT NULL,
  "type" VARCHAR(64) NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "body" VARCHAR(500) NOT NULL,
  "entityType" VARCHAR(64),
  "entityId" VARCHAR(64),
  "metadata" JSONB,
  "readAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskNotifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Reviews" (
  "id" VARCHAR(40) NOT NULL,
  "bookingId" INTEGER NOT NULL,
  "reviewerId" INTEGER NOT NULL,
  "revieweeId" INTEGER NOT NULL,
  "rating" INTEGER NOT NULL,
  "comment" VARCHAR(2000),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reviews_booking_reviewer_unique" UNIQUE ("bookingId", "reviewerId"),
  CONSTRAINT "Reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5),
  CONSTRAINT "Reviews_distinct_parties_check" CHECK ("reviewerId" <> "revieweeId")
);

CREATE TABLE IF NOT EXISTS "TaskerWallets" (
  "taskerId" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
  "availableBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "pendingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "payoutPinHash" VARCHAR(255),
  "payoutPinFailedAttempts" INTEGER NOT NULL DEFAULT 0,
  "payoutPinLockedUntil" TIMESTAMPTZ(6),
  "payoutPinUpdatedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskerWallets_pkey" PRIMARY KEY ("taskerId"),
  CONSTRAINT "TaskerWallets_available_nonnegative" CHECK ("availableBalance" >= 0),
  CONSTRAINT "TaskerWallets_pending_nonnegative" CHECK ("pendingBalance" >= 0),
  CONSTRAINT "TaskerWallets_pin_attempts_nonnegative" CHECK ("payoutPinFailedAttempts" >= 0)
);

CREATE TABLE IF NOT EXISTS "TaskerPayoutMethods" (
  "id" VARCHAR(40) NOT NULL,
  "taskerId" INTEGER NOT NULL,
  "type" VARCHAR(32) NOT NULL,
  "label" VARCHAR(120) NOT NULL,
  "maskedIdentifier" VARCHAR(120) NOT NULL,
  "encryptedPayload" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "status" VARCHAR(32) NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMPTZ(6),
  CONSTRAINT "TaskerPayoutMethods_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TaskerWithdrawals" (
  "id" VARCHAR(40) NOT NULL,
  "taskerId" INTEGER NOT NULL,
  "payoutMethodId" VARCHAR(40) NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'pending_review',
  "idempotencyKey" VARCHAR(120) NOT NULL,
  "providerReference" VARCHAR(255),
  "failureReason" VARCHAR(500),
  "requestedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMPTZ(6),
  "cancelledAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskerWithdrawals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tasker_withdrawals_tasker_idempotency_unique" UNIQUE ("taskerId", "idempotencyKey"),
  CONSTRAINT "TaskerWithdrawals_amount_positive" CHECK ("amount" > 0)
);

CREATE TABLE IF NOT EXISTS "TaskerWalletLedger" (
  "id" VARCHAR(40) NOT NULL,
  "taskerId" INTEGER NOT NULL,
  "bookingId" INTEGER,
  "withdrawalId" VARCHAR(40),
  "kind" VARCHAR(48) NOT NULL,
  "status" VARCHAR(32) NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "availableDelta" DECIMAL(14,2) NOT NULL,
  "pendingDelta" DECIMAL(14,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "description" VARCHAR(500) NOT NULL,
  "externalReference" VARCHAR(255),
  "idempotencyKey" VARCHAR(160) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskerWalletLedger_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TaskerWalletLedger_idempotencyKey_key" UNIQUE ("idempotencyKey"),
  CONSTRAINT "TaskerWalletLedger_amount_nonnegative" CHECK ("amount" >= 0)
);

CREATE INDEX IF NOT EXISTS "task_work_sessions_tasker_status_idx"
  ON "TaskWorkSessions"("taskerId", "status");
CREATE INDEX IF NOT EXISTS "tasker_locations_tasker_captured_idx"
  ON "TaskerTaskLocations"("taskerId", "capturedAt");
CREATE INDEX IF NOT EXISTS "task_complaints_filer_created_idx"
  ON "TaskComplaints"("filedById", "createdAt");
CREATE INDEX IF NOT EXISTS "task_complaints_booking_status_idx"
  ON "TaskComplaints"("bookingId", "status");
CREATE INDEX IF NOT EXISTS "task_messages_booking_created_idx"
  ON "TaskMessages"("bookingId", "createdAt");
CREATE INDEX IF NOT EXISTS "task_messages_sender_created_idx"
  ON "TaskMessages"("senderId", "createdAt");
CREATE INDEX IF NOT EXISTS "task_notifications_user_read_created_idx"
  ON "TaskNotifications"("userId", "readAt", "createdAt");
CREATE INDEX IF NOT EXISTS "task_notifications_user_category_idx"
  ON "TaskNotifications"("userId", "category", "createdAt");
CREATE INDEX IF NOT EXISTS "reviews_reviewee_created_idx"
  ON "Reviews"("revieweeId", "createdAt");
CREATE INDEX IF NOT EXISTS "reviews_reviewer_created_idx"
  ON "Reviews"("reviewerId", "createdAt");
CREATE INDEX IF NOT EXISTS "tasker_payout_methods_tasker_status_default_idx"
  ON "TaskerPayoutMethods"("taskerId", "status", "isDefault");
CREATE INDEX IF NOT EXISTS "tasker_withdrawals_tasker_status_requested_idx"
  ON "TaskerWithdrawals"("taskerId", "status", "requestedAt");
CREATE INDEX IF NOT EXISTS "tasker_wallet_ledger_tasker_created_idx"
  ON "TaskerWalletLedger"("taskerId", "createdAt");
CREATE INDEX IF NOT EXISTS "tasker_wallet_ledger_booking_idx"
  ON "TaskerWalletLedger"("bookingId");
CREATE INDEX IF NOT EXISTS "tasker_wallet_ledger_withdrawal_idx"
  ON "TaskerWalletLedger"("withdrawalId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskWorkSessions_bookingId_fkey') THEN
    ALTER TABLE "TaskWorkSessions" ADD CONSTRAINT "TaskWorkSessions_bookingId_fkey"
      FOREIGN KEY ("bookingId") REFERENCES "Bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskWorkSessions_taskerId_fkey') THEN
    ALTER TABLE "TaskWorkSessions" ADD CONSTRAINT "TaskWorkSessions_taskerId_fkey"
      FOREIGN KEY ("taskerId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskerTaskLocations_bookingId_fkey') THEN
    ALTER TABLE "TaskerTaskLocations" ADD CONSTRAINT "TaskerTaskLocations_bookingId_fkey"
      FOREIGN KEY ("bookingId") REFERENCES "Bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskerTaskLocations_taskerId_fkey') THEN
    ALTER TABLE "TaskerTaskLocations" ADD CONSTRAINT "TaskerTaskLocations_taskerId_fkey"
      FOREIGN KEY ("taskerId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskComplaints_bookingId_fkey') THEN
    ALTER TABLE "TaskComplaints" ADD CONSTRAINT "TaskComplaints_bookingId_fkey"
      FOREIGN KEY ("bookingId") REFERENCES "Bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskComplaints_filedById_fkey') THEN
    ALTER TABLE "TaskComplaints" ADD CONSTRAINT "TaskComplaints_filedById_fkey"
      FOREIGN KEY ("filedById") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskMessages_bookingId_fkey') THEN
    ALTER TABLE "TaskMessages" ADD CONSTRAINT "TaskMessages_bookingId_fkey"
      FOREIGN KEY ("bookingId") REFERENCES "Bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskMessages_senderId_fkey') THEN
    ALTER TABLE "TaskMessages" ADD CONSTRAINT "TaskMessages_senderId_fkey"
      FOREIGN KEY ("senderId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskNotifications_userId_fkey') THEN
    ALTER TABLE "TaskNotifications" ADD CONSTRAINT "TaskNotifications_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Reviews_bookingId_fkey') THEN
    ALTER TABLE "Reviews" ADD CONSTRAINT "Reviews_bookingId_fkey"
      FOREIGN KEY ("bookingId") REFERENCES "Bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Reviews_reviewerId_fkey') THEN
    ALTER TABLE "Reviews" ADD CONSTRAINT "Reviews_reviewerId_fkey"
      FOREIGN KEY ("reviewerId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Reviews_revieweeId_fkey') THEN
    ALTER TABLE "Reviews" ADD CONSTRAINT "Reviews_revieweeId_fkey"
      FOREIGN KEY ("revieweeId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskerWallets_taskerId_fkey') THEN
    ALTER TABLE "TaskerWallets" ADD CONSTRAINT "TaskerWallets_taskerId_fkey"
      FOREIGN KEY ("taskerId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskerPayoutMethods_taskerId_fkey') THEN
    ALTER TABLE "TaskerPayoutMethods" ADD CONSTRAINT "TaskerPayoutMethods_taskerId_fkey"
      FOREIGN KEY ("taskerId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskerWithdrawals_taskerId_fkey') THEN
    ALTER TABLE "TaskerWithdrawals" ADD CONSTRAINT "TaskerWithdrawals_taskerId_fkey"
      FOREIGN KEY ("taskerId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskerWithdrawals_payoutMethodId_fkey') THEN
    ALTER TABLE "TaskerWithdrawals" ADD CONSTRAINT "TaskerWithdrawals_payoutMethodId_fkey"
      FOREIGN KEY ("payoutMethodId") REFERENCES "TaskerPayoutMethods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskerWalletLedger_taskerId_fkey') THEN
    ALTER TABLE "TaskerWalletLedger" ADD CONSTRAINT "TaskerWalletLedger_taskerId_fkey"
      FOREIGN KEY ("taskerId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskerWalletLedger_bookingId_fkey') THEN
    ALTER TABLE "TaskerWalletLedger" ADD CONSTRAINT "TaskerWalletLedger_bookingId_fkey"
      FOREIGN KEY ("bookingId") REFERENCES "Bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskerWalletLedger_withdrawalId_fkey') THEN
    ALTER TABLE "TaskerWalletLedger" ADD CONSTRAINT "TaskerWalletLedger_withdrawalId_fkey"
      FOREIGN KEY ("withdrawalId") REFERENCES "TaskerWithdrawals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
