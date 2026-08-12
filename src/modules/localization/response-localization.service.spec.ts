import type { PrismaService } from '../../database/prisma.service';
import type { ConfigService } from '@nestjs/config';
import { LocaleService } from './locale.service';
import { ResponseLocalizationService } from './response-localization.service';

describe('ResponseLocalizationService', () => {
  const config = {
    get: (key: string) => (key === 'localization.supportedLocales' ? ['en', 'ar', 'ary'] : 'en'),
  } as ConfigService;
  const locales = new LocaleService(config);
  const prisma = {
    service: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 1,
          translations: [
            { locale: 'en', name: 'Cleaning', description: 'Canonical' },
            { locale: 'ar', name: 'تنظيف', description: 'تنظيف المنزل' },
          ],
        },
      ]),
    },
    serviceOption: { findMany: jest.fn().mockResolvedValue([]) },
  } as unknown as PrismaService;
  const service = new ResponseLocalizationService(prisma, locales);

  it('localizes nested Service views without changing IDs', async () => {
    const payload = {
      booking: { id: '5', service: { id: '1', name: 'Cleaning', description: 'Canonical' } },
    };
    await service.localize(payload, 'ar', '/api/bookings/5');
    expect(payload.booking.service).toMatchObject({
      id: '1',
      name: 'تنظيف',
      description: 'تنظيف المنزل',
      resolvedLocale: 'ar',
      translationFallback: false,
    });
  });

  it('does not transform administrator management responses', async () => {
    const payload = { service: { id: '1', name: 'Cleaning' } };
    await service.localize(payload, 'ar', '/api/admin/services/1');
    expect(payload.service.name).toBe('Cleaning');
  });
});
