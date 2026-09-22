ALTER TABLE "Bookings"
  ADD COLUMN "customerReminderSentAt" TIMESTAMPTZ(6);

CREATE INDEX "bookings_customer_reminder_sent_idx"
  ON "Bookings"("customerId", "customerReminderSentAt");
