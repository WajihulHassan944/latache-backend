-- Add indexes used by refresh-token rotation, tasker discovery and booking listings.
-- Kept separate from the baseline so existing Sequelize databases can mark only
-- the historical schema baseline as applied and still receive these indexes.

CREATE INDEX IF NOT EXISTS "refresh_tokens_user_revoked_idx"
  ON "RefreshTokens"("userId", "revokedAt");

CREATE INDEX IF NOT EXISTS "user_services_service_rate_idx"
  ON "UserServices"("serviceId", "hourlyRate");

CREATE INDEX IF NOT EXISTS "user_availabilities_open_slot_idx"
  ON "UserAvailabilities"("userId", "date", "isBooked");

CREATE INDEX IF NOT EXISTS "bookings_customer_date_idx"
  ON "Bookings"("customerId", "bookingDate");

CREATE INDEX IF NOT EXISTS "bookings_tasker_date_idx"
  ON "Bookings"("taskerId", "bookingDate");

CREATE INDEX IF NOT EXISTS "users_role_onboarding_idx"
  ON "Users"("role", "onboardingStatus");
