-- Service Management + Support Center foundation.
-- Additive only: no operational tickets, chat messages, fake metrics, or pricing rows are seeded.

ALTER TABLE "Services"
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Services"
  ALTER COLUMN "description" TYPE TEXT;

CREATE INDEX IF NOT EXISTS "services_active_sort_idx"
  ON "Services" ("isActive", "sortOrder");

CREATE TABLE IF NOT EXISTS "SupportTickets" (
  "id" SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL,
  "channel" VARCHAR(32) NOT NULL DEFAULT 'ticket',
  "subject" VARCHAR(200) NOT NULL,
  "category" VARCHAR(64) NOT NULL,
  "priority" VARCHAR(16) NOT NULL DEFAULT 'normal',
  "status" VARCHAR(32) NOT NULL DEFAULT 'open',
  "description" TEXT,
  "attachments" JSONB,
  "bookingId" INTEGER,
  "referenceType" VARCHAR(64),
  "referenceId" VARCHAR(120),
  "assignedAdminId" INTEGER,
  "firstResponseAt" TIMESTAMPTZ(6),
  "waitingSince" TIMESTAMPTZ(6),
  "escalatedAt" TIMESTAMPTZ(6),
  "escalationReason" VARCHAR(1000),
  "resolvedAt" TIMESTAMPTZ(6),
  "resolutionSummary" TEXT,
  "closedAt" TIMESTAMPTZ(6),
  "reopenedCount" INTEGER NOT NULL DEFAULT 0,
  "satisfactionScore" INTEGER,
  "feedbackComment" VARCHAR(1000),
  "feedbackAt" TIMESTAMPTZ(6),
  "lastMessageAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportTickets_satisfactionScore_check"
    CHECK ("satisfactionScore" IS NULL OR ("satisfactionScore" BETWEEN 1 AND 5)),
  CONSTRAINT "SupportTickets_channel_check"
    CHECK ("channel" IN ('ticket', 'live_chat')),
  CONSTRAINT "SupportTickets_priority_check"
    CHECK ("priority" IN ('low', 'normal', 'high', 'urgent')),
  CONSTRAINT "SupportTickets_status_check"
    CHECK ("status" IN ('open', 'waiting', 'in_progress', 'escalated', 'resolved', 'closed'))
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SupportTickets_userId_fkey'
  ) THEN
    ALTER TABLE "SupportTickets"
      ADD CONSTRAINT "SupportTickets_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "Users"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SupportTickets_assignedAdminId_fkey'
  ) THEN
    ALTER TABLE "SupportTickets"
      ADD CONSTRAINT "SupportTickets_assignedAdminId_fkey"
      FOREIGN KEY ("assignedAdminId") REFERENCES "Users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SupportTickets_bookingId_fkey'
  ) THEN
    ALTER TABLE "SupportTickets"
      ADD CONSTRAINT "SupportTickets_bookingId_fkey"
      FOREIGN KEY ("bookingId") REFERENCES "Bookings"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "support_tickets_user_status_updated_idx"
  ON "SupportTickets" ("userId", "status", "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "support_tickets_assignee_status_updated_idx"
  ON "SupportTickets" ("assignedAdminId", "status", "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "support_tickets_channel_status_message_idx"
  ON "SupportTickets" ("channel", "status", "lastMessageAt" DESC);
CREATE INDEX IF NOT EXISTS "support_tickets_status_priority_created_idx"
  ON "SupportTickets" ("status", "priority", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "support_tickets_booking_idx"
  ON "SupportTickets" ("bookingId");
CREATE INDEX IF NOT EXISTS "support_tickets_reference_idx"
  ON "SupportTickets" ("referenceType", "referenceId");

CREATE TABLE IF NOT EXISTS "SupportTicketMessages" (
  "id" VARCHAR(40) PRIMARY KEY,
  "ticketId" INTEGER NOT NULL,
  "senderId" INTEGER NOT NULL,
  "senderRole" VARCHAR(32) NOT NULL,
  "body" TEXT,
  "attachments" JSONB,
  "isInternalNote" BOOLEAN NOT NULL DEFAULT FALSE,
  "readAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SupportTicketMessages_ticketId_fkey'
  ) THEN
    ALTER TABLE "SupportTicketMessages"
      ADD CONSTRAINT "SupportTicketMessages_ticketId_fkey"
      FOREIGN KEY ("ticketId") REFERENCES "SupportTickets"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SupportTicketMessages_senderId_fkey'
  ) THEN
    ALTER TABLE "SupportTicketMessages"
      ADD CONSTRAINT "SupportTicketMessages_senderId_fkey"
      FOREIGN KEY ("senderId") REFERENCES "Users"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "support_ticket_messages_ticket_created_idx"
  ON "SupportTicketMessages" ("ticketId", "createdAt");
CREATE INDEX IF NOT EXISTS "support_ticket_messages_sender_created_idx"
  ON "SupportTicketMessages" ("senderId", "createdAt");
CREATE INDEX IF NOT EXISTS "support_ticket_messages_visibility_read_idx"
  ON "SupportTicketMessages" ("ticketId", "isInternalNote", "readAt");
