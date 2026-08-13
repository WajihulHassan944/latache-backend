import { ConfigService } from '@nestjs/config';
import { ObjectStorageDeletionService } from '../object-storage-deletion.service';

describe('ObjectStorageDeletionService', () => {
  const prisma = {};
  const uploads = {};
  const config = {
    get: jest.fn((key: string, fallback: unknown) =>
      key === 'cloudinary.folder' ? 'latache' : fallback,
    ),
  };
  const service = new ObjectStorageDeletionService(
    prisma as never,
    uploads as never,
    config as unknown as ConfigService,
  );

  it('extracts and deduplicates only Latache-managed Cloudinary references', () => {
    const result = service.extractManagedAssets(
      {
        publicId: 'latache/customer/user-42/customer-profile/avatar',
        resourceType: 'image',
        secureUrl:
          'https://res.cloudinary.com/demo/image/upload/v123/latache/customer/user-42/customer-profile/avatar.png',
      },
      ['https://example.com/not-managed.png'],
      {
        public_id: 'latache/conversation-attachments/customer/42/evidence.pdf',
        resource_type: 'raw',
      },
    );

    expect(result).toEqual([
      {
        publicId: 'latache/customer/user-42/customer-profile/avatar',
        resourceType: 'image',
      },
      {
        publicId: 'latache/conversation-attachments/customer/42/evidence.pdf',
        resourceType: 'raw',
      },
    ]);
  });

  it('does not accept arbitrary public IDs outside the configured folder', () => {
    expect(
      service.extractManagedAssets('other-tenant/customer/avatar', 'https://example.com/x.png'),
    ).toEqual([]);
  });
});
