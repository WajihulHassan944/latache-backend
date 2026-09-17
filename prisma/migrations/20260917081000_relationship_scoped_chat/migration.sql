-- CreateTable: Conversation is now the primary chat relationship (customer<->tasker),
-- independent of any single booking.
CREATE TABLE "Conversations" (
    "id" VARCHAR(40) NOT NULL,
    "customerId" INTEGER NOT NULL,
    "taskerId" INTEGER NOT NULL,
    "lastMessageAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversations_customer_tasker_unique" ON "Conversations"("customerId", "taskerId");

-- CreateIndex
CREATE INDEX "conversations_customer_activity_idx" ON "Conversations"("customerId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "conversations_tasker_activity_idx" ON "Conversations"("taskerId", "lastMessageAt");

-- AddForeignKey
ALTER TABLE "Conversations" ADD CONSTRAINT "Conversations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversations" ADD CONSTRAINT "Conversations_taskerId_fkey" FOREIGN KEY ("taskerId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one Conversation per distinct (customerId, taskerId) pair that already has at least
-- one booking. Where the same pair has multiple existing bookings, their message histories all
-- merge into this single Conversation - this is expected and is the whole point of this change.
INSERT INTO "Conversations" ("id", "customerId", "taskerId", "lastMessageAt", "createdAt", "updatedAt")
SELECT
    substr(md5(random()::text || clock_timestamp()::text || b."customerId"::text || b."taskerId"::text), 1, 25),
    b."customerId",
    b."taskerId",
    MAX(b."conversationLastMessageAt"),
    MIN(b."createdAt"),
    CURRENT_TIMESTAMP
FROM "Bookings" b
GROUP BY b."customerId", b."taskerId";

-- AlterTable: Booking now belongs to a Conversation (find-or-create on customerId/taskerId at
-- creation time going forward). Added nullable first so it can be backfilled before the NOT NULL
-- constraint is applied.
ALTER TABLE "Bookings" ADD COLUMN "conversationId" VARCHAR(40);

UPDATE "Bookings" b
SET "conversationId" = c."id"
FROM "Conversations" c
WHERE c."customerId" = b."customerId" AND c."taskerId" = b."taskerId";

ALTER TABLE "Bookings" ALTER COLUMN "conversationId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "bookings_conversation_date_idx" ON "Bookings"("conversationId", "bookingDate");

-- AddForeignKey
ALTER TABLE "Bookings" ADD CONSTRAINT "Bookings_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: TaskMessage is now scoped to a Conversation. bookingId becomes optional context only
-- (whichever booking, if any, was active at send time) - no longer used for access control or room
-- scoping. Added nullable first so it can be backfilled before the NOT NULL constraint is applied.
ALTER TABLE "TaskMessages" ADD COLUMN "conversationId" VARCHAR(40);

UPDATE "TaskMessages" tm
SET "conversationId" = b."conversationId"
FROM "Bookings" b
WHERE tm."bookingId" = b."id";

ALTER TABLE "TaskMessages" ALTER COLUMN "conversationId" SET NOT NULL;
ALTER TABLE "TaskMessages" ALTER COLUMN "bookingId" DROP NOT NULL;

-- Replace the booking-scoped retry/idempotency uniqueness and lookup indexes with
-- conversation-scoped equivalents.
DROP INDEX "task_messages_sender_booking_client_message_unique";
DROP INDEX "task_messages_booking_created_idx";
DROP INDEX "task_messages_booking_cursor_idx";
DROP INDEX "task_messages_booking_unread_idx";

-- CreateIndex
CREATE UNIQUE INDEX "task_messages_sender_conversation_client_message_unique" ON "TaskMessages"("senderId", "conversationId", "clientMessageId");

-- CreateIndex
CREATE INDEX "task_messages_conversation_created_idx" ON "TaskMessages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "task_messages_conversation_cursor_idx" ON "TaskMessages"("conversationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "task_messages_conversation_unread_idx" ON "TaskMessages"("conversationId", "readAt", "senderId", "createdAt");

-- Re-point the bookingId foreign key to SET NULL instead of CASCADE: deleting a booking must no
-- longer delete the (now conversation-owned) message history, only clear its booking reference.
ALTER TABLE "TaskMessages" DROP CONSTRAINT "TaskMessages_bookingId_fkey";
ALTER TABLE "TaskMessages" ADD CONSTRAINT "TaskMessages_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskMessages" ADD CONSTRAINT "TaskMessages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
