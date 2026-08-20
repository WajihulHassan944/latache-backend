-- Policy hardening only: keep historical rows, but only backend-supported Elite perks remain active.
UPDATE "EliteBenefits"
SET "isActive" = FALSE, "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" NOT IN ('elite_profile_badge', 'search_priority_boost', 'tier_commission_policy')
  AND "isActive" = TRUE;

-- Canonicalize enforcement metadata for the built-in perk catalog. Presentation fields remain unchanged.
UPDATE "EliteBenefits" eb
SET "metadata" = CASE eb."code"
  WHEN 'elite_profile_badge' THEN jsonb_build_object(
    'enforcement', 'profile_and_discovery',
    'configurationSource', 'tier_membership',
    'tierCode', et."code"
  )
  WHEN 'search_priority_boost' THEN jsonb_build_object(
    'enforcement', 'tasker_discovery',
    'configurationSource', 'tier_rank',
    'tierCode', et."code",
    'tierRank', et."rank"
  )
  WHEN 'tier_commission_policy' THEN jsonb_build_object(
    'enforcement', 'pricing_engine',
    'configurationSource', 'platform_settings.commission',
    'tierCode', et."code"
  )
  ELSE eb."metadata"
END,
"updatedAt" = CURRENT_TIMESTAMP
FROM "EliteTiers" et
WHERE eb."tierId" = et."id"
  AND eb."code" IN ('elite_profile_badge', 'search_priority_boost', 'tier_commission_policy');
