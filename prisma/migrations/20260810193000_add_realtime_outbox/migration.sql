CREATE TABLE "RealtimeOutboxEvents" (
  "id" VARCHAR(40) NOT NULL,
  "room" VARCHAR(180) NOT NULL,
  "eventName" VARCHAR(96) NOT NULL,
  "payload" JSONB NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lockedAt" TIMESTAMPTZ(6),
  "lockToken" VARCHAR(64),
  "publishedAt" TIMESTAMPTZ(6),
  "lastError" VARCHAR(1000),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RealtimeOutboxEvents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "realtime_outbox_pending_idx"
  ON "RealtimeOutboxEvents"("publishedAt", "lockedAt", "createdAt");

CREATE INDEX "realtime_outbox_room_created_idx"
  ON "RealtimeOutboxEvents"("room", "createdAt");
