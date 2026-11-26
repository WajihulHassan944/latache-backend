ALTER TABLE "TaskMessages"
  ADD COLUMN "kind" VARCHAR(16) NOT NULL DEFAULT 'user',
  ADD COLUMN "event" JSONB;
CREATE INDEX "task_messages_booking_kind_idx" ON "TaskMessages"("bookingId", "kind");
