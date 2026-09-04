import { SERVICE_ICON_OPTIONS } from '../../../common/constants/service-icon.constant';
import { AdminServicesService } from './admin-services.service';
import type { PrismaService } from '../../../database/prisma.service';
import type { PlatformSettingsService } from '../../platform-settings/platform-settings.service';

describe('AdminServicesService.read view=icons', () => {
  it('returns the curated icon catalogue without touching the database', async () => {
    const prisma = {
      service: { findMany: jest.fn(), count: jest.fn() },
    } as unknown as PrismaService;
    const service = new AdminServicesService(prisma, {} as PlatformSettingsService);

    const result = await service.read({ view: 'icons' });

    expect(result).toEqual({ view: 'icons', icons: SERVICE_ICON_OPTIONS });
    expect((prisma.service.findMany as jest.Mock)).not.toHaveBeenCalled();
  });
});
