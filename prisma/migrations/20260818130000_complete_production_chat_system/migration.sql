-- Additive production-chat hardening. Existing message content is retained.

ALTER TABLE "Bookings"
  ADD COLUMN "conversationLastMessageAt" TIMESTAMPTZ(6);

ALTER TABLE "TaskMessages"
  ADD COLUMN "clientMessageId" VARCHAR(80);

ALTER TABLE "SupportTickets"
  ADD COLUMN "clientRequestId" VARCHAR(80);

ALTER TABLE "SupportTicketMessages"
  ADD COLUMN "clientMessageId" VARCHAR(80);

-- Backfill conversation activity without changing booking lifecycle timestamps.
UPDATE "Bookings" AS booking
SET "conversationLastMessageAt" = latest."lastMessageAt"
FROM (
  SELECT "bookingId", MAX("createdAt") AS "lastMessageAt"
  FROM "TaskMessages"
  GROUP BY "bookingId"
) AS latest
WHERE booking."id" = latest."bookingId";

CREATE INDEX "bookings_customer_conversation_activity_idx"
  ON "Bookings"("customerId", "conversationLastMessageAt", "updatedAt");

CREATE INDEX "bookings_tasker_conversation_activity_idx"
  ON "Bookings"("taskerId", "conversationLastMessageAt", "updatedAt");

CREATE UNIQUE INDEX "task_messages_sender_client_message_unique"
  ON "TaskMessages"("senderId", "clientMessageId");

CREATE INDEX "task_messages_booking_unread_idx"
  ON "TaskMessages"("bookingId", "readAt", "senderId", "createdAt");

CREATE UNIQUE INDEX "support_tickets_user_client_request_unique"
  ON "SupportTickets"("userId", "clientRequestId");

CREATE UNIQUE INDEX "support_ticket_messages_sender_client_message_unique"
  ON "SupportTicketMessages"("senderId", "clientMessageId");

CREATE INDEX "support_ticket_messages_audience_unread_idx"
  ON "SupportTicketMessages"("ticketId", "readAt", "senderRole", "createdAt");

-- NOT VALID preserves historical rows while enforcing stronger invariants for new writes.
ALTER TABLE "TaskMessages"
  ADD CONSTRAINT "task_messages_client_message_id_length_check"
  CHECK ("clientMessageId" IS NULL OR length("clientMessageId") BETWEEN 8 AND 80) NOT VALID;

ALTER TABLE "SupportTickets"
  ADD CONSTRAINT "support_tickets_client_request_id_length_check"
  CHECK ("clientRequestId" IS NULL OR length("clientRequestId") BETWEEN 8 AND 80) NOT VALID;

ALTER TABLE "SupportTicketMessages"
  ADD CONSTRAINT "support_ticket_messages_client_message_id_length_check"
  CHECK ("clientMessageId" IS NULL OR length("clientMessageId") BETWEEN 8 AND 80) NOT VALID;

ALTER TABLE "SupportTicketMessages"
  ADD CONSTRAINT "support_ticket_messages_content_check"
  CHECK (
    ("body" IS NOT NULL AND length(trim("body")) > 0)
    OR (
      jsonb_typeof("attachments") = 'array'
      AND jsonb_array_length("attachments") > 0
    )
  ) NOT VALID;
