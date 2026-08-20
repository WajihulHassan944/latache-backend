-- Tasker level production hardening and canonical service-rate bounds.
ALTER TABLE "Users"
  ADD COLUMN IF NOT EXISTS "eliteAtRiskSince" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "eliteGraceUntil" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "eliteLastEvaluatedAt" TIMESTAMPTZ(6);

ALTER TABLE "EliteTiers"
  ADD COLUMN IF NOT EXISTS "autoPromotionEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "autoDemotionEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "retentionGraceDays" INTEGER NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS "requestCooldownDays" INTEGER NOT NULL DEFAULT 3;

ALTER TABLE "Services"
  ADD COLUMN IF NOT EXISTS "minHourlyRateUsd" DECIMAL(10,2) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "maxHourlyRateUsd" DECIMAL(10,2) NOT NULL DEFAULT 10000;

ALTER TABLE "Services"
  ADD CONSTRAINT "services_hourly_rate_bounds_check"
  CHECK ("minHourlyRateUsd" > 0 AND "maxHourlyRateUsd" >= "minHourlyRateUsd");

CREATE TABLE IF NOT EXISTS "EliteEvaluations" (
  "id" VARCHAR(40) NOT NULL,
  "taskerId" INTEGER NOT NULL,
  "currentTierCode" VARCHAR(32),
  "targetTierCode" VARCHAR(32),
  "outcome" VARCHAR(32) NOT NULL,
  "score" DECIMAL(6,2),
  "eligible" BOOLEAN,
  "metricsSnapshot" JSONB NOT NULL,
  "requirementsSnapshot" JSONB,
  "evaluatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EliteEvaluations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EliteEvaluations_taskerId_fkey" FOREIGN KEY ("taskerId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "elite_evaluations_tasker_evaluated_idx" ON "EliteEvaluations"("taskerId", "evaluatedAt");
CREATE INDEX IF NOT EXISTS "elite_evaluations_outcome_evaluated_idx" ON "EliteEvaluations"("outcome", "evaluatedAt");

-- Production-safe defaults for the built-in Elite tiers. Existing Admin-customized
-- requirement JSON is preserved; automatic promotion is enabled only when this
-- migration supplies the missing built-in requirements.
UPDATE "EliteTiers"
SET "requirements" = CASE "code"
      WHEN 'gold' THEN '{"minRating":4.5,"minCompletedTasks":20,"minCompletionRate":90,"maxOpenComplaints":0}'::jsonb
      WHEN 'platinum' THEN '{"minRating":4.7,"minCompletedTasks":75,"minCompletionRate":94,"maxOpenComplaints":0}'::jsonb
      WHEN 'diamond' THEN '{"minRating":4.85,"minCompletedTasks":200,"minCompletionRate":97,"maxOpenComplaints":0}'::jsonb
      ELSE "requirements"
    END,
    "autoPromotionEnabled" = TRUE,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" IN ('gold', 'platinum', 'diamond')
  AND "requirements" IS NULL;

-- Seed only perks that have real backend enforcement. Existing Admin-managed
-- benefits with the same codes remain authoritative.
INSERT INTO "EliteBenefits" (
  "id", "tierId", "code", "name", "description", "displayValue", "metadata", "isActive", "sortOrder"
)
SELECT
  'elite_benefit_' || t."code" || '_badge',
  t."id",
  'elite_profile_badge',
  'Elite profile badge',
  'Shows the Tasker Elite tier on participant-facing profile and discovery responses.',
  initcap(t."code") || ' badge',
  '{"enforcement":"profile_and_discovery"}'::jsonb,
  TRUE,
  10
FROM "EliteTiers" t
WHERE t."code" IN ('gold', 'platinum', 'diamond')
ON CONFLICT ("tierId", "code") DO NOTHING;

INSERT INTO "EliteBenefits" (
  "id", "tierId", "code", "name", "description", "displayValue", "metadata", "isActive", "sortOrder"
)
SELECT
  'elite_benefit_' || t."code" || '_search',
  t."id",
  'search_priority_boost',
  'Discovery priority',
  'Ranks eligible Elite Taskers ahead of lower tiers in the default discovery order while preserving explicit customer price/rating/completed-task sorts.',
  CASE t."code" WHEN 'gold' THEN 'Priority' WHEN 'platinum' THEN 'Higher priority' ELSE 'Highest priority' END,
  jsonb_build_object('enforcement', 'tasker_discovery', 'tierRank', t."rank"),
  TRUE,
  20
FROM "EliteTiers" t
WHERE t."code" IN ('gold', 'platinum', 'diamond')
ON CONFLICT ("tierId", "code") DO NOTHING;

INSERT INTO "EliteBenefits" (
  "id", "tierId", "code", "name", "description", "displayValue", "metadata", "isActive", "sortOrder"
)
SELECT
  'elite_benefit_' || t."code" || '_commission',
  t."id",
  'tier_commission_policy',
  'Tier commission policy',
  'Uses the Admin-configured commission rate and minimum task price for this Elite tier when final booking charges are calculated.',
  'Configured by platform policy',
  '{"enforcement":"pricing_engine"}'::jsonb,
  TRUE,
  30
FROM "EliteTiers" t
WHERE t."code" IN ('gold', 'platinum', 'diamond')
ON CONFLICT ("tierId", "code") DO NOTHING;

-- Built-in tier badges are automatically assigned/revoked by the Elite worker.
INSERT INTO "EliteBadges" (
  "id", "tierId", "code", "name", "description", "criteria", "isActive"
)
SELECT
  'elite_badge_' || t."code",
  t."id",
  'elite_' || t."code",
  initcap(t."code") || ' Elite',
  'Automatically reflects the Tasker current Elite tier or higher.',
  '{"autoAward":true,"autoRevoke":true}'::jsonb,
  TRUE
FROM "EliteTiers" t
WHERE t."code" IN ('gold', 'platinum', 'diamond')
ON CONFLICT ("code") DO NOTHING;
