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
