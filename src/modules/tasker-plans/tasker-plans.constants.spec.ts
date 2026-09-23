import { resolveTaskerPlanCatalog, TASKER_PLANS } from './tasker-plans.constants';

describe('resolveTaskerPlanCatalog', () => {
  it('returns the reference defaults when nothing is stored', () => {
    expect(resolveTaskerPlanCatalog(null)).toEqual(TASKER_PLANS);
    expect(resolveTaskerPlanCatalog('garbage')).toEqual(TASKER_PLANS);
  });

  it('applies only editable overrides and keeps everything else', () => {
    const catalog = resolveTaskerPlanCatalog({
      gold: { monthlyPrice: 120, platformFeePercent: 11, searchPriorityRank: 99, badge: 'diamond' },
      diamond: { revenueSharePercent: 3, isAvailable: false },
      bogus: { monthlyPrice: 1 },
    });
    expect(catalog.gold.monthlyPrice).toBe(120);
    expect(catalog.gold.platformFeePercent).toBe(11);
    // Not editable: ranking and badge stay fixed.
    expect(catalog.gold.searchPriorityRank).toBe(1);
    expect(catalog.gold.badge).toBe('gold');
    expect(catalog.diamond.revenueSharePercent).toBe(3);
    expect(catalog.diamond.isAvailable).toBe(false);
    expect(catalog.platinum).toEqual(TASKER_PLANS.platinum);
    expect(Object.keys(catalog)).toEqual(['gold', 'platinum', 'diamond']);
  });

  it('ignores null values instead of blanking a field', () => {
    expect(resolveTaskerPlanCatalog({ gold: { monthlyPrice: null } }).gold.monthlyPrice).toBe(100);
  });
});
