import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

describe('admin finance and platform-settings architecture', () => {
  it('keeps finance reads consolidated and refund mutation owned by disputes', () => {
    const controller = read('src/modules/admin-finance/controllers/admin-finance.controller.ts');
    expect(controller).toContain("@Controller('admin/finance')");
    expect(controller).toContain('@Get()');
    expect(controller).toContain("@Post('payouts/:id/actions')");
    expect(controller).not.toContain("@Post('refund");
  });

  it('keeps platform policy on one read/write surface', () => {
    const controller = read('src/modules/platform-settings/platform-settings.controller.ts');
    expect(controller).toContain("@Controller('admin/platform-settings')");
    expect(controller).toContain("@Permissions('settings.read')");
    expect(controller).toContain("@Permissions('settings.manage')");
  });

  it('emits a valid item schema for translated general settings', () => {
    const dto = read('src/modules/platform-settings/dto/platform-settings.dto.ts');
    expect(dto).toContain('type: () => GeneralContentTranslationDto');
    expect(dto).toContain('isArray: true');
    expect(dto).not.toContain("type: 'array'");
  });

  it('rejects remaining unsupported money/settings toggles instead of simulating them', () => {
    const service = read('src/modules/platform-settings/platform-settings.service.ts');
    expect(service).toContain('Multi-currency settlement is not enabled');
    expect(service).toContain('Referral bonus stacking requires a promotion engine');
    expect(service).toContain('referralRewardEngineAvailable: true');
    expect(service).toContain('Automatic exchange-rate refresh is not configured');
    expect(service).toContain(
      'Region-specific radius rules require a verified region/geocoding resolver',
    );
  });

  it('applies commission and tax through the real booking-payment path', () => {
    const booking = read('src/modules/bookings/bookings.service.ts');
    const payments = read('src/modules/payments/payments.service.ts');
    expect(booking).toContain('calculatePricingCharges');
    expect(payments).toContain('calculatePricingCharges');
    expect(payments).toContain('commissionRatePercent');
    expect(payments).toContain('taxRatePercent');
    expect(payments).toContain('taxInclusive');
  });
});
