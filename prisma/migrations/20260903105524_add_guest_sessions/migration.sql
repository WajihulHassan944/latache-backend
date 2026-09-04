-- DropIndex
DROP INDEX "conversation_calls_booking_created_idx";

-- DropIndex
DROP INDEX "conversation_calls_initiator_status_created_idx";

-- DropIndex
DROP INDEX "conversation_calls_recipient_status_created_idx";

-- DropIndex
DROP INDEX "disciplinary_actions_user_created_idx";

-- DropIndex
DROP INDEX "dispute_participant_actions_user_created_idx";

-- DropIndex
DROP INDEX "reviews_reviewee_created_idx";

-- DropIndex
DROP INDEX "reviews_reviewer_created_idx";

-- DropIndex
DROP INDEX "support_tickets_assignee_status_updated_idx";

-- DropIndex
DROP INDEX "support_tickets_channel_status_message_idx";

-- DropIndex
DROP INDEX "support_tickets_status_priority_created_idx";

-- DropIndex
DROP INDEX "support_tickets_user_status_updated_idx";

-- DropIndex
DROP INDEX "task_complaints_filer_created_idx";

-- DropIndex
DROP INDEX "task_notifications_user_read_created_idx";

-- DropIndex
DROP INDEX "tasker_withdrawals_status_requested_idx";

-- DropIndex
DROP INDEX "user_availabilities_discovery_date_idx";

-- CreateTable
CREATE TABLE "GuestSessions" (
    "id" SERIAL NOT NULL,
    "guestId" VARCHAR(64) NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "deviceId" VARCHAR(255),
    "ipAddress" VARCHAR(64),
    "userAgent" VARCHAR(512),
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "convertedUserId" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "lastActivityAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestSessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuestSessions_guestId_key" ON "GuestSessions"("guestId");

-- CreateIndex
CREATE UNIQUE INDEX "GuestSessions_tokenHash_key" ON "GuestSessions"("tokenHash");

-- CreateIndex
CREATE INDEX "guest_sessions_status_expires_idx" ON "GuestSessions"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "guest_sessions_device_idx" ON "GuestSessions"("deviceId");

-- CreateIndex
CREATE INDEX "guest_sessions_converted_user_idx" ON "GuestSessions"("convertedUserId");

-- CreateIndex
CREATE INDEX "conversation_calls_booking_created_idx" ON "ConversationCalls"("bookingId", "createdAt");

-- CreateIndex
CREATE INDEX "conversation_calls_recipient_status_created_idx" ON "ConversationCalls"("recipientId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "conversation_calls_initiator_status_created_idx" ON "ConversationCalls"("initiatorId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "support_tickets_user_status_updated_idx" ON "SupportTickets"("userId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "support_tickets_assignee_status_updated_idx" ON "SupportTickets"("assignedAdminId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "support_tickets_channel_status_message_idx" ON "SupportTickets"("channel", "status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "support_tickets_status_priority_created_idx" ON "SupportTickets"("status", "priority", "createdAt");

-- AddForeignKey
ALTER TABLE "GuestSessions" ADD CONSTRAINT "GuestSessions_convertedUserId_fkey" FOREIGN KEY ("convertedUserId") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
