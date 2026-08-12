-- Chat document sharing remains in the existing TaskMessages.attachments JSONB column.
-- This migration adds durable one-to-one voice/video call lifecycle records.

CREATE TABLE "ConversationCalls" (
    "id" VARCHAR(40) NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "initiatorId" INTEGER NOT NULL,
    "recipientId" INTEGER NOT NULL,
    "endedById" INTEGER,
    "type" VARCHAR(16) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'ringing',
    "clientRequestId" VARCHAR(80) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "answeredAt" TIMESTAMPTZ(6),
    "endedAt" TIMESTAMPTZ(6),
    "endReason" VARCHAR(120),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationCalls_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversation_calls_initiator_request_unique"
ON "ConversationCalls"("initiatorId", "clientRequestId");

-- A booking can have only one ringing/accepted call at a time. This partial
-- index closes the race that an application-only pre-check cannot close.
CREATE UNIQUE INDEX "conversation_calls_one_active_per_booking"
ON "ConversationCalls"("bookingId")
WHERE "status" IN ('ringing', 'accepted');

CREATE INDEX "conversation_calls_booking_created_idx"
ON "ConversationCalls"("bookingId", "createdAt" DESC);

CREATE INDEX "conversation_calls_recipient_status_created_idx"
ON "ConversationCalls"("recipientId", "status", "createdAt" DESC);

CREATE INDEX "conversation_calls_initiator_status_created_idx"
ON "ConversationCalls"("initiatorId", "status", "createdAt" DESC);

CREATE INDEX "conversation_calls_status_expires_idx"
ON "ConversationCalls"("status", "expiresAt");

ALTER TABLE "ConversationCalls"
ADD CONSTRAINT "ConversationCalls_bookingId_fkey"
FOREIGN KEY ("bookingId") REFERENCES "Bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConversationCalls"
ADD CONSTRAINT "ConversationCalls_initiatorId_fkey"
FOREIGN KEY ("initiatorId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ConversationCalls"
ADD CONSTRAINT "ConversationCalls_recipientId_fkey"
FOREIGN KEY ("recipientId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ConversationCalls"
ADD CONSTRAINT "ConversationCalls_endedById_fkey"
FOREIGN KEY ("endedById") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
