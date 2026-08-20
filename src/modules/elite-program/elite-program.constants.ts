export const ELITE_TIER_CODES = ['gold', 'platinum', 'diamond'] as const;
export type EliteTierCode = (typeof ELITE_TIER_CODES)[number];

export const ELITE_REQUEST_KINDS = ['application', 'upgrade', 'downgrade'] as const;
export type EliteRequestKind = (typeof ELITE_REQUEST_KINDS)[number];

export const ELITE_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type EliteRequestStatus = (typeof ELITE_REQUEST_STATUSES)[number];

export const ELITE_ADMIN_LIST_VIEWS = [
  'members',
  'applications',
  'upgrade_requests',
  'downgrade_requests',
] as const;
export type EliteAdminListView = (typeof ELITE_ADMIN_LIST_VIEWS)[number];

export const ELITE_REPORT_TYPES = [
  'monthly_summary',
  'tier_transitions',
  'benefit_utilization',
] as const;
export type EliteReportType = (typeof ELITE_REPORT_TYPES)[number];

export const ELITE_REPORT_FORMATS = ['json', 'csv'] as const;
export type EliteReportFormat = (typeof ELITE_REPORT_FORMATS)[number];

export const ELITE_PROGRAM_HISTORY_COMPLETE_FROM = '2026-08-10';

export const ELITE_PERK_CODES = [
  'elite_profile_badge',
  'search_priority_boost',
  'tier_commission_policy',
] as const;
export type ElitePerkCode = (typeof ELITE_PERK_CODES)[number];

export const ELITE_PERK_CATALOG: Record<
  ElitePerkCode,
  {
    code: ElitePerkCode;
    name: string;
    description: string;
    enforcement: 'profile_and_discovery' | 'tasker_discovery' | 'pricing_engine';
    configurationSource: 'tier_membership' | 'tier_rank' | 'platform_settings.commission';
  }
> = {
  elite_profile_badge: {
    code: 'elite_profile_badge',
    name: 'Elite profile badge',
    description: 'Allows the tier badge to be surfaced on public Tasker profile/discovery responses.',
    enforcement: 'profile_and_discovery',
    configurationSource: 'tier_membership',
  },
  search_priority_boost: {
    code: 'search_priority_boost',
    name: 'Discovery priority',
    description: 'Uses the assigned Elite tier rank as a default-discovery boost while preserving an explicit customer sort as the primary order.',
    enforcement: 'tasker_discovery',
    configurationSource: 'tier_rank',
  },
  tier_commission_policy: {
    code: 'tier_commission_policy',
    name: 'Tier commission policy',
    description: 'Applies the configured Gold/Platinum/Diamond commission and minimum-task-price policy. Without this perk the Standard commission policy applies.',
    enforcement: 'pricing_engine',
    configurationSource: 'platform_settings.commission',
  },
};

