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
} as const;

export const TASKER_PLAN_PERIOD_DAYS = 30;

export interface TaskerPlanDefinition {
  id: TaskerPlanId;
  name: string;
  /** Monthly price, in PLAN_PRICE_CURRENCY. */
  monthlyPrice: number;
  /** Platform commission applied to this Tasker's new bookings (lower wins vs. any Elite rate). */
  platformFeePercent: number;
  /** Discovery ordering weight; higher sorts first among equally-ranked Taskers. */
  searchPriorityRank: number;
  priorityLabel: string;
  /** Credited to the Tasker wallet at activation and each successful renewal, in PLAN_PRICE_CURRENCY. */
  monthlyBonus: number;
  badge: TaskerPlanId;
  /** Human-facing perks. Only fee, priority, bonus and badge are automated by the backend. */
  perks: string[];
}

export const PLAN_PRICE_CURRENCY = 'MAD';

/** Reference values designed on the FE; confirm with product before changing. */
export const TASKER_PLANS: Record<TaskerPlanId, TaskerPlanDefinition> = {
  gold: {
    id: 'gold',
    name: 'Gold',
    monthlyPrice: 100,
    platformFeePercent: 12,
    searchPriorityRank: 1,
    priorityLabel: 'high',
    monthlyBonus: 25,
    badge: 'gold',
    perks: ['12% platform fee (standard 15%)', 'High priority queue', '25 MAD monthly bonus', 'Gold badge', 'Priority email support'],
  },
  platinum: {
    id: 'platinum',
    name: 'Platinum',
    monthlyPrice: 200,
    platformFeePercent: 10,
    searchPriorityRank: 2,
    priorityLabel: 'very_high',
    monthlyBonus: 60,
    badge: 'platinum',
    perks: ['10% platform fee (standard 15%)', 'Very high priority queue', '60 MAD monthly bonus', 'Platinum badge', 'Phone and email support', 'Marketing spotlight once per quarter'],
  },
  diamond: {
    id: 'diamond',
    name: 'Diamond',
    monthlyPrice: 300,
    platformFeePercent: 8,
    searchPriorityRank: 3,
    priorityLabel: 'highest',
    monthlyBonus: 150,
    badge: 'diamond',
    perks: ['8% platform fee (standard 15%)', 'Highest priority queue', '150 MAD monthly bonus', 'Diamond badge', 'Dedicated account manager', 'Marketing spotlight once per month', '+2% lifetime revenue share'],
  },
};

export const isTaskerPlanId = (value: string): value is TaskerPlanId =>
  (TASKER_PLAN_IDS as readonly string[]).includes(value);
