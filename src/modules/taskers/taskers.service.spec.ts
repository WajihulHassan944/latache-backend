import { BadRequestException } from '@nestjs/common';
import { TaskersService } from './taskers.service';
import type { TaskersRepository } from './taskers.repository';
import type { ReviewsService } from '../reviews/reviews.service';
import type { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import type { UploadsService } from '../uploads/uploads.service';
import type { PrismaService } from '../../database/prisma.service';

const currency = { code: 'USD', symbol: '$', market: 'US' };

function buildService(listResult: unknown) {
  const repository = {
    list: jest.fn().mockResolvedValue(
      listResult ?? { items: [], page: 1, limit: 9, totalItems: 0, totalPages: 0 },
    ),
  } as unknown as TaskersRepository;
  const platformSettings = {
    serviceRadiusPolicy: jest.fn().mockResolvedValue({ enforcementEnabled: false }),
    currencyContext: jest.fn().mockResolvedValue(currency),
    convertPlatformAmountToUsd: jest.fn((value: number) => value),
    convertUsdAmount: jest.fn((value: number) => value),
  } as unknown as PlatformSettingsService;
  const service = new TaskersService(
    {} as PrismaService,
    repository,
    {} as ReviewsService,
    platformSettings,
    {} as UploadsService,
  );
  return { service, repository };
}

describe('TaskersService.list location precedence', () => {
  it('uses incoming lat/lng even when a saved location is also available', async () => {
    const { service, repository } = buildService(undefined);
    await service.list({ lat: 1, lng: 2 } as never, 'en', { lat: 33.5731, lng: -7.5898 });
    expect(repository.list).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 1, lng: 2 }),
      'en',
    );
  });

  it('falls back to the saved location when the request has no lat/lng', async () => {
    const { service, repository } = buildService(undefined);
    await service.list({} as never, 'en', { lat: 33.5731, lng: -7.5898 });
    expect(repository.list).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 33.5731, lng: -7.5898 }),
      'en',
    );
  });

  it('performs plain discovery with no location filtering when neither incoming nor saved coordinates exist', async () => {
    const { service, repository } = buildService(undefined);
    await service.list({} as never, 'en', null);
    const passedQuery = (repository.list as jest.Mock).mock.calls[0][0];
    expect(passedQuery.lat).toBeUndefined();
    expect(passedQuery.lng).toBeUndefined();
  });

  it('never substitutes the saved location when only one of lat/lng was sent, leaving the pair-mismatch validation to reject it', async () => {
    const { service, repository } = buildService(undefined);
    (repository.list as jest.Mock).mockRejectedValue(new Error('LAT_LNG_PAIR_REQUIRED'));
    await expect(
      service.list({ lat: 1 } as never, 'en', { lat: 33.5731, lng: -7.5898 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const passedQuery = (repository.list as jest.Mock).mock.calls[0][0];
    expect(passedQuery.lat).toBe(1);
    expect(passedQuery.lng).toBeUndefined();
  });
});
