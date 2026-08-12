-- Query-driven indexes for bounded chronological reads and Admin filters.
-- PostgreSQL remains the source of truth; these indexes add no derived data.
CREATE INDEX "admin_audit_created_cursor_idx"
ON "AdminAuditLogs"("createdAt", "id");

CREATE INDEX "bookings_admin_status_date_cursor_idx"
ON "Bookings"("status", "bookingDate", "id");

CREATE INDEX "bookings_service_status_date_idx"
ON "Bookings"("serviceId", "status", "bookingDate");

CREATE INDEX "payment_transactions_status_created_cursor_idx"
ON "PaymentTransactions"("status", "createdAt", "id");

CREATE INDEX "task_messages_booking_cursor_idx"
ON "TaskMessages"("bookingId", "createdAt", "id");

CREATE INDEX "conversation_calls_booking_cursor_idx"
ON "ConversationCalls"("bookingId", "createdAt", "id");

CREATE INDEX "task_notifications_user_cursor_idx"
ON "TaskNotifications"("userId", "createdAt", "id");

CREATE INDEX "support_ticket_messages_ticket_cursor_idx"
ON "SupportTicketMessages"("ticketId", "createdAt", "id");

CREATE INDEX "tasker_withdrawals_status_requested_cursor_idx"
ON "TaskerWithdrawals"("status", "requestedAt", "id");

CREATE INDEX "tasker_wallet_ledger_tasker_cursor_idx"
ON "TaskerWalletLedger"("taskerId", "createdAt", "id");

CREATE INDEX "realtime_outbox_cleanup_cursor_idx"
ON "RealtimeOutboxEvents"("publishedAt", "createdAt", "id");

-- Unicode text remains untouched. pg_trgm accelerates the existing normalized
-- contains-search used by English/Arabic service and service-option discovery.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "service_translations_normalized_name_trgm_idx"
ON "ServiceTranslations" USING GIN ("normalizedName" gin_trgm_ops);

CREATE INDEX "service_translations_normalized_description_trgm_idx"
ON "ServiceTranslations" USING GIN ("normalizedDescription" gin_trgm_ops);

CREATE INDEX "service_option_translations_normalized_name_trgm_idx"
ON "ServiceOptionTranslations" USING GIN ("normalizedName" gin_trgm_ops);

CREATE INDEX "service_option_translations_normalized_description_trgm_idx"
ON "ServiceOptionTranslations" USING GIN ("normalizedDescription" gin_trgm_ops);
