-- Elite Tasker Program foundation.
-- This migration is additive and keeps Users.isElite as a compatibility flag.

CREATE TABLE "EliteTiers" (
  "id" VARCHAR(40) NOT NULL,
  "code" VARCHAR(32) NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "rank" INTEGER NOT NULL,
  "description" VARCHAR(500),
  "requirements" JSONB,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EliteTiers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EliteTiers_code_key" ON "EliteTiers"("code");
CREATE UNIQUE INDEX "EliteTiers_rank_key" ON "EliteTiers"("rank");
CREATE INDEX "elite_tiers_active_rank_idx" ON "EliteTiers"("isActive", "rank");

INSERT INTO "EliteTiers" ("id", "code", "name", "rank", "description", "requirements") VALUES
  ('elite_tier_gold', 'gold', 'Gold Elite', 1, 'Entry tier of the Latache Elite Tasker Program.', NULL),
  ('elite_tier_platinum', 'platinum', 'Platinum Elite', 2, 'Second tier of the Latache Elite Tasker Program.', NULL),
  ('elite_tier_diamond', 'diamond', 'Diamond Elite', 3, 'Highest tier of the Latache Elite Tasker Program.', NULL)
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "Users"
  ADD COLUMN "eliteTierId" VARCHAR(40),
  ADD COLUMN "eliteSince" TIMESTAMPTZ(6);

ALTER TABLE "Users"
  ADD CONSTRAINT "Users_eliteTierId_fkey"
  FOREIGN KEY ("eliteTierId") REFERENCES "EliteTiers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "users_elite_tier_status_idx" ON "Users"("eliteTierId", "accountStatus");

-- Existing pre-tier isElite accounts are conservatively mapped to Gold.
-- No historical transition is invented because the previous schema did not record a tier or transition date.
UPDATE "Users"
SET "eliteTierId" = 'elite_tier_gold',
    "eliteSince" = COALESCE("eliteSince", CURRENT_TIMESTAMP)
WHERE "role" = 'tasker'
  AND "isElite" = true
  AND "eliteTierId" IS NULL;

CREATE TABLE "EliteMembershipRequests" (
  "id" VARCHAR(40) NOT NULL,
  "taskerId" INTEGER NOT NULL,
  "kind" VARCHAR(32) NOT NULL,
  "fromTierCode" VARCHAR(32),
  "toTierCode" VARCHAR(32),
  "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
  "reason" VARCHAR(1000),
  "decisionReason" VARCHAR(1000),
  "metricsSnapshot" JSONB,
  "requirementsSnapshot" JSONB,
  "decidedById" INTEGER,
  "decidedAt" TIMESTAMPTZ(6),
  "cancelledAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EliteMembershipRequests_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "EliteMembershipRequests"
  ADD CONSTRAINT "EliteMembershipRequests_taskerId_fkey"
  FOREIGN KEY ("taskerId") REFERENCES "Users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EliteMembershipRequests"
  ADD CONSTRAINT "EliteMembershipRequests_decidedById_fkey"
  FOREIGN KEY ("decidedById") REFERENCES "Users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "elite_requests_tasker_status_created_idx"
  ON "EliteMembershipRequests"("taskerId", "status", "createdAt");
CREATE INDEX "elite_requests_status_kind_created_idx"
  ON "EliteMembershipRequests"("status", "kind", "createdAt");
CREATE INDEX "elite_requests_decider_decided_idx"
  ON "EliteMembershipRequests"("decidedById", "decidedAt");

CREATE UNIQUE INDEX "elite_requests_one_pending_per_tasker"
  ON "EliteMembershipRequests"("taskerId")
  WHERE "status" = 'pending';

CREATE TABLE "EliteTierTransitions" (
  "id" VARCHAR(40) NOT NULL,
  "taskerId" INTEGER NOT NULL,
  "requestId" VARCHAR(40),
  "fromTierCode" VARCHAR(32),
  "toTierCode" VARCHAR(32),
  "source" VARCHAR(32) NOT NULL,
  "reason" VARCHAR(1000),
  "actorId" INTEGER,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EliteTierTransitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EliteTierTransitions_requestId_key" ON "EliteTierTransitions"("requestId");
ALTER TABLE "EliteTierTransitions"
  ADD CONSTRAINT "EliteTierTransitions_taskerId_fkey"
  FOREIGN KEY ("taskerId") REFERENCES "Users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EliteTierTransitions"
  ADD CONSTRAINT "EliteTierTransitions_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "EliteMembershipRequests"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EliteTierTransitions"
  ADD CONSTRAINT "EliteTierTransitions_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "Users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "elite_transitions_tasker_created_idx" ON "EliteTierTransitions"("taskerId", "createdAt");
CREATE INDEX "elite_transitions_to_tier_created_idx" ON "EliteTierTransitions"("toTierCode", "createdAt");

CREATE TABLE "EliteBenefits" (
  "id" VARCHAR(40) NOT NULL,
  "tierId" VARCHAR(40) NOT NULL,
  "code" VARCHAR(64) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(500),
  "displayValue" VARCHAR(120),
  "metadata" JSONB,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EliteBenefits_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "EliteBenefits"
  ADD CONSTRAINT "EliteBenefits_tierId_fkey"
  FOREIGN KEY ("tierId") REFERENCES "EliteTiers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "elite_benefits_tier_code_unique" ON "EliteBenefits"("tierId", "code");
CREATE INDEX "elite_benefits_tier_active_sort_idx" ON "EliteBenefits"("tierId", "isActive", "sortOrder");

CREATE TABLE "EliteBadges" (
  "id" VARCHAR(40) NOT NULL,
  "tierId" VARCHAR(40),
  "code" VARCHAR(64) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(500),
  "assetUrl" VARCHAR(1000),
  "criteria" JSONB,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EliteBadges_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EliteBadges_code_key" ON "EliteBadges"("code");
ALTER TABLE "EliteBadges"
  ADD CONSTRAINT "EliteBadges_tierId_fkey"
  FOREIGN KEY ("tierId") REFERENCES "EliteTiers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "elite_badges_tier_active_idx" ON "EliteBadges"("tierId", "isActive");

CREATE TABLE "EliteTaskerBadges" (
  "id" VARCHAR(40) NOT NULL,
  "taskerId" INTEGER NOT NULL,
  "badgeId" VARCHAR(40) NOT NULL,
  "awardedById" INTEGER,
  "awardedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMPTZ(6),
  "revokeReason" VARCHAR(500),
  CONSTRAINT "EliteTaskerBadges_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "EliteTaskerBadges"
  ADD CONSTRAINT "EliteTaskerBadges_taskerId_fkey"
  FOREIGN KEY ("taskerId") REFERENCES "Users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EliteTaskerBadges"
  ADD CONSTRAINT "EliteTaskerBadges_badgeId_fkey"
  FOREIGN KEY ("badgeId") REFERENCES "EliteBadges"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EliteTaskerBadges"
  ADD CONSTRAINT "EliteTaskerBadges_awardedById_fkey"
  FOREIGN KEY ("awardedById") REFERENCES "Users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "elite_tasker_badges_tasker_badge_unique" ON "EliteTaskerBadges"("taskerId", "badgeId");
CREATE INDEX "elite_tasker_badges_tasker_revoked_idx" ON "EliteTaskerBadges"("taskerId", "revokedAt");
CREATE INDEX "elite_tasker_badges_badge_revoked_idx" ON "EliteTaskerBadges"("badgeId", "revokedAt");

-- Add granular Elite Program permissions to RBAC roles.
UPDATE "RbacRoles"
SET "permissions" = array_append("permissions", 'elite.read'),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" IN ('super_admin', 'operations_admin', 'analytics_admin')
  AND NOT ('elite.read' = ANY("permissions"));

UPDATE "RbacRoles"
SET "permissions" = array_append("permissions", 'elite.manage'),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" IN ('super_admin', 'operations_admin')
  AND NOT ('elite.manage' = ANY("permissions"));

UPDATE "Users" u
SET "permissions" = r."permissions"
FROM "RbacRoles" r
WHERE u."rbacRoleId" = r."id"
  AND u."inheritsRolePermissions" = true
  AND u."role" IN ('admin', 'super_admin');
