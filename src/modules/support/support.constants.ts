export const SUPPORT_CHANNELS = ['ticket', 'live_chat'] as const;
export type SupportChannel = (typeof SUPPORT_CHANNELS)[number];

export const SUPPORT_CATEGORIES = [
  'booking',
  'payment',
  'technical',
  'profile',
  'account',
  'verification',
  'elite',
  'other',
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];

export const SUPPORT_STATUSES = [
  'open',
  'waiting',
  'in_progress',
  'escalated',
  'resolved',
  'closed',
] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const ACTIVE_SUPPORT_STATUSES: readonly SupportStatus[] = [
  'open',
  'waiting',
  'in_progress',
  'escalated',
];

export const SUPPORT_ADMIN_VIEWS = [
  'support_tickets',
  'customer_issues',
  'tasker_issues',
  'escalated',
  'live_chat',
  'reports',
] as const;
export type SupportAdminView = (typeof SUPPORT_ADMIN_VIEWS)[number];
