-- Multi-role identity foundation.
-- One Users row remains the canonical login/email identity. Marketplace role
-- membership is explicit in Users.roles and role-specific lifecycle state is
-- stored in CustomerProfiles / TaskerProfiles.

ALTER TABLE "Users"
  ADD COLUMN IF NOT EXISTS "roles" VARCHAR(32)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(32)[];

UPDATE "Users"
SET "roles" = CASE
  WHEN "role" IN ('customer', 'tasker', 'admin', 'super_admin') THEN ARRAY["role"]::VARCHAR(32)[]
  ELSE ARRAY[]::VARCHAR(32)[]
END
WHERE COALESCE(array_length("roles", 1), 0) = 0;

ALTER TABLE "RefreshTokens"
  ADD COLUMN IF NOT EXISTS "activeRole" VARCHAR(32);

UPDATE "RefreshTokens" rt
SET "activeRole" = u."role"
FROM "Users" u
WHERE rt."userId" = u."id"
  AND rt."activeRole" IS NULL
  AND u."role" IN ('customer', 'tasker', 'admin', 'super_admin');

CREATE TABLE IF NOT EXISTS "CustomerProfiles" (
  "userId" INTEGER NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'active',
  "activatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "suspendedAt" TIMESTAMPTZ(6),
  "deactivatedAt" TIMESTAMPTZ(6),
  "statusReason" VARCHAR(1000),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerProfiles_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "CustomerProfiles_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "CustomerProfiles" (
  "userId", "status", "activatedAt", "suspendedAt", "deactivatedAt", "createdAt", "updatedAt"
)
SELECT
  u."id",
  CASE
    WHEN u."accountStatus" = 'suspended' THEN 'suspended'
    WHEN u."accountStatus" = 'deactivated' THEN 'deactivated'
    ELSE 'active'
  END,
  COALESCE(u."createdAt", CURRENT_TIMESTAMP),
  CASE WHEN u."accountStatus" = 'suspended' THEN u."updatedAt" ELSE NULL END,
  CASE WHEN u."accountStatus" = 'deactivated' THEN u."updatedAt" ELSE NULL END,
  u."createdAt",
  u."updatedAt"
FROM "Users" u
WHERE 'customer' = ANY(u."roles")
ON CONFLICT ("userId") DO NOTHING;

CREATE TABLE IF NOT EXISTS "TaskerProfiles" (
  "userId" INTEGER NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'pending_approval',
  "approvedAt" TIMESTAMPTZ(6),
  "rejectedAt" TIMESTAMPTZ(6),
  "suspendedAt" TIMESTAMPTZ(6),
  "deactivatedAt" TIMESTAMPTZ(6),
  "statusReason" VARCHAR(1000),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskerProfiles_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "TaskerProfiles_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "TaskerProfiles" (
  "userId", "status", "approvedAt", "rejectedAt", "suspendedAt", "deactivatedAt", "createdAt", "updatedAt"
)
SELECT
  u."id",
  CASE
    WHEN u."accountStatus" = 'suspended' THEN 'suspended'
    WHEN u."accountStatus" = 'deactivated' THEN 'deactivated'
    WHEN u."onboardingStatus" = 'rejected' THEN 'rejected'
    WHEN u."onboardingStatus" = 'approved' AND u."accountStatus" = 'active' THEN 'active'
    ELSE 'pending_approval'
  END,
  CASE WHEN u."onboardingStatus" = 'approved' THEN COALESCE(u."submittedAt", u."updatedAt") ELSE NULL END,
  CASE WHEN u."onboardingStatus" = 'rejected' THEN u."updatedAt" ELSE NULL END,
  CASE WHEN u."accountStatus" = 'suspended' THEN u."updatedAt" ELSE NULL END,
  CASE WHEN u."accountStatus" = 'deactivated' THEN u."updatedAt" ELSE NULL END,
  u."createdAt",
  u."updatedAt"
FROM "Users" u
WHERE 'tasker' = ANY(u."roles")
ON CONFLICT ("userId") DO NOTHING;

-- Marketplace suspension/deactivation/approval is now profile-scoped. Preserve the migrated
-- role state above, then normalize the shared verified identity so one role cannot lock the other.
UPDATE "Users"
SET "accountStatus" = 'active'
WHERE "isVerified" = TRUE
  AND ("roles" && ARRAY['customer','tasker']::VARCHAR(32)[])
  AND NOT ("roles" && ARRAY['admin','super_admin']::VARCHAR(32)[]);

ALTER TABLE "SupportTickets"
  ADD COLUMN IF NOT EXISTS "requesterRole" VARCHAR(32) NOT NULL DEFAULT 'customer';

UPDATE "SupportTickets" st
SET "requesterRole" = CASE
  WHEN u."role" IN ('customer', 'tasker') THEN u."role"
  ELSE 'customer'
END
FROM "Users" u
WHERE st."userId" = u."id"
  AND (st."requesterRole" IS NULL OR st."requesterRole" = 'customer');

CREATE INDEX IF NOT EXISTS "users_roles_gin_idx" ON "Users" USING GIN ("roles");
CREATE INDEX IF NOT EXISTS "customer_profiles_status_created_idx" ON "CustomerProfiles"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "tasker_profiles_status_created_idx" ON "TaskerProfiles"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "support_tickets_requester_role_status_idx" ON "SupportTickets"("requesterRole", "status", "updatedAt");

-- Support idempotency is scoped to the active marketplace role so the same identity can
-- independently use Customer and Tasker support clients without cross-role collisions.
DROP INDEX IF EXISTS "support_tickets_user_client_request_unique";
DROP INDEX IF EXISTS "SupportTickets_userId_clientRequestId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "support_tickets_user_role_client_request_unique"
  ON "SupportTickets"("userId", "requesterRole", "clientRequestId");

-- Keep role membership constrained to the roles supported by the application.
ALTER TABLE "Users"
  ADD CONSTRAINT "Users_roles_supported_check"
  CHECK ("roles" <@ ARRAY['customer','tasker','admin','super_admin']::VARCHAR(32)[]);

ALTER TABLE "Users"
  ADD CONSTRAINT "Users_primary_role_membership_check"
  CHECK ("role" = '' OR "role" = ANY("roles"));

ALTER TABLE "RefreshTokens"
  ADD CONSTRAINT "RefreshTokens_active_role_supported_check"
  CHECK ("activeRole" IS NULL OR "activeRole" IN ('customer','tasker','admin','super_admin'));

ALTER TABLE "SupportTickets"
  ADD CONSTRAINT "SupportTickets_requester_role_check"
  CHECK ("requesterRole" IN ('customer','tasker'));

-- Referral attribution is role-program scoped for dual-role identities. Existing data is already unique by user, so this is lossless.
DROP INDEX IF EXISTS "Referrals_referredUserId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "referrals_referred_user_program_unique" ON "Referrals"("referredUserId", "program");

-- Role-scoped dispute discipline prevents one marketplace profile from suspending the other.
ALTER TABLE "CustomerProfiles"
  ADD COLUMN IF NOT EXISTS "disputeStrikePoints" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "disciplinaryState" VARCHAR(32) NOT NULL DEFAULT 'clear',
  ADD COLUMN IF NOT EXISTS "lastDisciplinaryActionAt" TIMESTAMPTZ(6);
ALTER TABLE "TaskerProfiles"
  ADD COLUMN IF NOT EXISTS "disputeStrikePoints" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "disciplinaryState" VARCHAR(32) NOT NULL DEFAULT 'clear',
  ADD COLUMN IF NOT EXISTS "lastDisciplinaryActionAt" TIMESTAMPTZ(6);
UPDATE "CustomerProfiles" cp SET
  "disputeStrikePoints" = u."disputeStrikePoints",
  "disciplinaryState" = u."disciplinaryState",
  "lastDisciplinaryActionAt" = u."lastDisciplinaryActionAt"
FROM "Users" u WHERE cp."userId" = u."id" AND u."role" = 'customer';
UPDATE "TaskerProfiles" tp SET
  "disputeStrikePoints" = u."disputeStrikePoints",
  "disciplinaryState" = u."disciplinaryState",
  "lastDisciplinaryActionAt" = u."lastDisciplinaryActionAt"
FROM "Users" u WHERE tp."userId" = u."id" AND u."role" = 'tasker';
ALTER TABLE "DisciplinaryActions" ADD COLUMN IF NOT EXISTS "targetRole" VARCHAR(24) NOT NULL DEFAULT 'customer';
UPDATE "DisciplinaryActions" da SET "targetRole" = CASE
  WHEN EXISTS (SELECT 1 FROM "TaskComplaints" tc JOIN "Bookings" b ON b."id" = tc."bookingId" WHERE tc."id" = da."complaintId" AND b."taskerId" = da."userId") THEN 'tasker'
  ELSE 'customer' END;
CREATE INDEX IF NOT EXISTS "disciplinary_actions_user_role_created_idx" ON "DisciplinaryActions"("userId", "targetRole", "createdAt");
ALTER TABLE "DisciplinaryActions" DROP CONSTRAINT IF EXISTS "DisciplinaryActions_target_role_check";
ALTER TABLE "DisciplinaryActions" ADD CONSTRAINT "DisciplinaryActions_target_role_check" CHECK ("targetRole" IN ('customer','tasker'));

-- Reviews and ratings are marketplace-role scoped for dual-role identities.
ALTER TABLE "CustomerProfiles"
  ADD COLUMN IF NOT EXISTS "rating" DECIMAL(2,1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "reviewsCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TaskerProfiles"
  ADD COLUMN IF NOT EXISTS "rating" DECIMAL(2,1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "reviewsCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "CustomerProfiles" cp SET
  "rating" = u."rating",
  "reviewsCount" = u."reviewsCount"
FROM "Users" u
WHERE cp."userId" = u."id" AND u."role" = 'customer';
UPDATE "TaskerProfiles" tp SET
  "rating" = u."rating",
  "reviewsCount" = u."reviewsCount"
FROM "Users" u
WHERE tp."userId" = u."id" AND u."role" = 'tasker';

ALTER TABLE "Reviews"
  ADD COLUMN IF NOT EXISTS "reviewerRole" VARCHAR(24) NOT NULL DEFAULT 'customer',
  ADD COLUMN IF NOT EXISTS "revieweeRole" VARCHAR(24) NOT NULL DEFAULT 'tasker';

UPDATE "Reviews" r SET
  "reviewerRole" = CASE WHEN b."taskerId" = r."reviewerId" THEN 'tasker' ELSE 'customer' END,
  "revieweeRole" = CASE WHEN b."taskerId" = r."revieweeId" THEN 'tasker' ELSE 'customer' END
FROM "Bookings" b
WHERE b."id" = r."bookingId";

ALTER TABLE "Reviews" ADD CONSTRAINT "Reviews_role_context_check"
  CHECK ("reviewerRole" IN ('customer','tasker') AND "revieweeRole" IN ('customer','tasker') AND "reviewerRole" <> "revieweeRole");
CREATE INDEX IF NOT EXISTS "reviews_reviewee_role_created_idx" ON "Reviews"("revieweeId", "revieweeRole", "createdAt");
CREATE INDEX IF NOT EXISTS "reviews_reviewer_role_created_idx" ON "Reviews"("reviewerId", "reviewerRole", "createdAt");

-- Notification inboxes and realtime delivery are active-role scoped for multi-role identities.
ALTER TABLE "TaskNotifications" ADD COLUMN IF NOT EXISTS "audienceRole" VARCHAR(32);
ALTER TABLE "TaskNotifications" ADD CONSTRAINT "TaskNotifications_audience_role_check"
  CHECK ("audienceRole" IS NULL OR "audienceRole" IN ('customer','tasker','admin','super_admin'));
CREATE INDEX IF NOT EXISTS "task_notifications_user_role_read_created_idx"
  ON "TaskNotifications"("userId", "audienceRole", "readAt", "createdAt");


-- Retry keys are scoped to their actual conversation/call context. A dual-role identity may
-- use independent Customer and Tasker clients without unrelated conversations colliding.
DROP INDEX IF EXISTS "task_messages_sender_client_message_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "task_messages_sender_booking_client_message_unique"
  ON "TaskMessages"("senderId", "bookingId", "clientMessageId");

DROP INDEX IF EXISTS "support_ticket_messages_sender_client_message_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "support_ticket_messages_sender_ticket_client_message_unique"
  ON "SupportTicketMessages"("senderId", "ticketId", "clientMessageId");

DROP INDEX IF EXISTS "conversation_calls_initiator_request_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_calls_initiator_booking_request_unique"
  ON "ConversationCalls"("initiatorId", "bookingId", "clientRequestId");


-- Persist dispute actor role context because one User may participate as Customer in one booking
-- and Tasker in another; audit/history must not depend on the User primaryRole compatibility field.
ALTER TABLE "TaskComplaints" ADD COLUMN IF NOT EXISTS "filedByRole" VARCHAR(24) NOT NULL DEFAULT 'customer';
UPDATE "TaskComplaints" tc SET "filedByRole" = CASE
  WHEN b."taskerId" = tc."filedById" THEN 'tasker' ELSE 'customer' END
FROM "Bookings" b WHERE b."id" = tc."bookingId";
ALTER TABLE "TaskComplaints" ADD CONSTRAINT "TaskComplaints_filed_by_role_check"
  CHECK ("filedByRole" IN ('customer','tasker'));
CREATE INDEX IF NOT EXISTS "task_complaints_filer_role_created_idx"
  ON "TaskComplaints"("filedById", "filedByRole", "createdAt");

ALTER TABLE "DisputeParticipantActions" ADD COLUMN IF NOT EXISTS "userRole" VARCHAR(24) NOT NULL DEFAULT 'customer';
UPDATE "DisputeParticipantActions" dpa SET "userRole" = CASE
  WHEN b."taskerId" = dpa."userId" THEN 'tasker' ELSE 'customer' END
FROM "TaskComplaints" tc JOIN "Bookings" b ON b."id" = tc."bookingId"
WHERE tc."id" = dpa."complaintId";
ALTER TABLE "DisputeParticipantActions" ADD CONSTRAINT "DisputeParticipantActions_user_role_check"
  CHECK ("userRole" IN ('customer','tasker'));
CREATE INDEX IF NOT EXISTS "dispute_participant_actions_user_role_created_idx"
  ON "DisputeParticipantActions"("userId", "userRole", "createdAt");

ALTER TABLE "DisputeSatisfactionSurveys" ADD COLUMN IF NOT EXISTS "userRole" VARCHAR(24) NOT NULL DEFAULT 'customer';
UPDATE "DisputeSatisfactionSurveys" dss SET "userRole" = CASE
  WHEN b."taskerId" = dss."userId" THEN 'tasker' ELSE 'customer' END
FROM "TaskComplaints" tc JOIN "Bookings" b ON b."id" = tc."bookingId"
WHERE tc."id" = dss."complaintId";
ALTER TABLE "DisputeSatisfactionSurveys" ADD CONSTRAINT "DisputeSatisfactionSurveys_user_role_check"
  CHECK ("userRole" IN ('customer','tasker'));
