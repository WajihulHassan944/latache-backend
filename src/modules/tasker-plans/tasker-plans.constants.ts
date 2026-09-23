export const TASKER_PLAN_IDS = ['gold', 'platinum', 'diamond'] as const;
export type TaskerPlanId = (typeof TASKER_PLAN_IDS)[number];

export const TASKER_PLAN_STATUS = {
  /** Paid, waiting for admin review. Perks not applied yet. */
  Pending: 'pending',
  /** Approved and within its paid period (or renewal grace). Perks applied. */
  Active: 'active',
  /** Admin rejected; the payment was refunded. */
  Rejected: 'rejected',
  /** Renewal failed through the whole grace period; perks removed. */
  Expired: 'expired',
  /** Card charge failed at purchase time; never took effect. */
  PaymentFailed: 'payment_failed',
  /** Tasker cancelled a pending purchase (refunded) or let an active plan end without renewing. */
  Cancelled: 'cancelled',
  /** An admin ended an active plan immediately. */
  Terminated: 'terminated',
} as const;

export const TASKER_PLAN_PERIOD_DAYS = 30;

/** Settings row (PlatformSettings.key) holding the Super-Admin-edited catalog overrides. */
export const TASKER_PLAN_CATALOG_SETTING_KEY = 'taskerPlanCatalog';

export type PlanSupportTier = 'priority_email' | 'phone_and_email' | 'dedicated_account_manager';
export type PlanSpotlightFrequency = 'none' | 'quarterly' | 'monthly';

export interface TaskerPlanDefinition {
  id: TaskerPlanId;
  name: string;
  /** New purchases are refused while false; existing subscribers keep renewing. */
  isAvailable: boolean;
  /** Monthly price, in PLAN_PRICE_CURRENCY. New purchases and every renewal use the current value. */
  monthlyPrice: number;
  /** Platform commission applied to this Tasker's new bookings (lower wins vs. any Elite rate). */
  platformFeePercent: number;
  /** Discovery ordering weight; higher sorts first among equally-ranked Taskers. Not editable. */
  searchPriorityRank: number;
  priorityLabel: string;
  /** Credited to the Tasker wallet at activation and each successful renewal, in PLAN_PRICE_CURRENCY. */
  monthlyBonus: number;
  /**
   * Revenue share: this % of the service amount of each online-paid booking is
   * credited to the Tasker wallet, on top of their earning, when that earning is
   * released - for as long as the plan is active at release time.
   */
  revenueSharePercent: number;
  /** Operational perks (fulfilled by staff, surfaced to admins and the app). */
  supportTier: PlanSupportTier;
  spotlightFrequency: PlanSpotlightFrequency;
  badge: TaskerPlanId;
  /** Human-facing perk lines for the app. */
  perks: string[];
}

export const PLAN_PRICE_CURRENCY = 'MAD';

/** Defaults (the FE reference design). Super Admin can override via PUT /admin/tasker-plans/catalog. */
export const TASKER_PLANS: Record<TaskerPlanId, TaskerPlanDefinition> = {
  gold: {
    id: 'gold',
    name: 'Gold',
    isAvailable: true,
    monthlyPrice: 100,
    platformFeePercent: 12,
    searchPriorityRank: 1,
    priorityLabel: 'high',
    monthlyBonus: 25,
    revenueSharePercent: 0,
    supportTier: 'priority_email',
    spotlightFrequency: 'none',
    badge: 'gold',
    perks: ['12% platform fee (standard 15%)', 'High priority queue', '25 MAD monthly bonus', 'Gold badge', 'Priority email support'],
  },
  platinum: {
    id: 'platinum',
    name: 'Platinum',
    isAvailable: true,
    monthlyPrice: 200,
    platformFeePercent: 10,
    searchPriorityRank: 2,
    priorityLabel: 'very_high',
    monthlyBonus: 60,
    revenueSharePercent: 0,
    supportTier: 'phone_and_email',
    spotlightFrequency: 'quarterly',
    badge: 'platinum',
    perks: ['10% platform fee (standard 15%)', 'Very high priority queue', '60 MAD monthly bonus', 'Platinum badge', 'Phone and email support', 'Marketing spotlight once per quarter'],
  },
  diamond: {
    id: 'diamond',
    name: 'Diamond',
    isAvailable: true,
    monthlyPrice: 300,
    platformFeePercent: 8,
    searchPriorityRank: 3,
    priorityLabel: 'highest',
    monthlyBonus: 150,
    revenueSharePercent: 2,
    supportTier: 'dedicated_account_manager',
    spotlightFrequency: 'monthly',
    badge: 'diamond',
    perks: ['8% platform fee (standard 15%)', 'Highest priority queue', '150 MAD monthly bonus', 'Diamond badge', 'Dedicated account manager', 'Marketing spotlight once per month', '+2% revenue share on every paid booking'],
  },
};

/** Fields a Super Admin may override per plan. */
export const EDITABLE_PLAN_FIELDS = [
  'name',
  'isAvailable',
  'monthlyPrice',
  'platformFeePercent',
  'monthlyBonus',
  'revenueSharePercent',
  'supportTier',
  'spotlightFrequency',
  'perks',
] as const;

export type TaskerPlanOverride = Partial<Pick<TaskerPlanDefinition, (typeof EDITABLE_PLAN_FIELDS)[number]>>;

export const isTaskerPlanId = (value: string): value is TaskerPlanId =>
  (TASKER_PLAN_IDS as readonly string[]).includes(value);

/**
 * Merges the stored override JSON (PlatformSettings[taskerPlanCatalog].value =
 * { gold?: {...}, platinum?: {...}, diamond?: {...} }) onto the defaults. Unknown
 * keys are ignored so a malformed row can never break pricing.
 */
export const resolveTaskerPlanCatalog = (
  stored: unknown,
): Record<TaskerPlanId, TaskerPlanDefinition> => {
  const overrides = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const resolved = {} as Record<TaskerPlanId, TaskerPlanDefinition>;
  for (const id of TASKER_PLAN_IDS) {
    const raw = overrides[id];
    const patch: Record<string, unknown> = {};
    if (raw && typeof raw === 'object') {
      for (const field of EDITABLE_PLAN_FIELDS) {
        const value = (raw as Record<string, unknown>)[field];
        if (value !== undefined && value !== null) patch[field] = value;
      }
    }
    resolved[id] = { ...TASKER_PLANS[id], ...patch } as TaskerPlanDefinition;
  }
  return resolved;
};
