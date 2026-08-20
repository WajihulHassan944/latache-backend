import { ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { UserRole } from '../../common/enums/user-role.enum';
import type { User } from '../../generated/prisma/client';
import { UploadFolder, UploadResourceType } from './dto';
import { UploadsService } from './uploads.service';
import type { BufferedUploadFile, CloudinaryClient } from './uploads.types';

const customer = {
  id: 42,
  role: UserRole.Customer,
} as User;

const file: BufferedUploadFile = {
  buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  originalname: 'avatar.png',
  mimetype: 'image/png',
  size: 5,
};

const createService = () => {
  const uploadStream: CloudinaryClient['uploader']['upload_stream'] = (_options, callback) => ({
    end: () =>
      callback(undefined, {
        public_id: 'latache/customer-profiles/customer/42/test-id',
        secure_url: 'https://res.cloudinary.com/demo/image/upload/test.png',
        url: 'http://res.cloudinary.com/demo/image/upload/test.png',
        resource_type: 'image',
        format: 'png',
        bytes: 5,
      }),
  });

  const cloudinary: CloudinaryClient = {
    config: jest.fn(),
    api: {
      resource: jest.fn().mockResolvedValue({
        public_id: 'latache/customer-profiles/customer/42/test-id',
        secure_url: 'https://res.cloudinary.com/demo/image/upload/test.png',
        url: 'http://res.cloudinary.com/demo/image/upload/test.png',
        resource_type: 'image',
        bytes: 5,
      }),
    },
    uploader: {
      upload_stream: jest.fn(uploadStream),
      destroy: jest.fn().mockResolvedValue({ result: 'ok' }),
    },
  };
  const config = {
    get: jest.fn((key: string, fallback: unknown) => {
      if (key === 'cloudinary.folder') return 'latache';
      if (key === 'cloudinary.maxFileSizeBytes') return 10 * 1024 * 1024;
      return fallback;
    }),
  };
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([{ referenced: false }]),
  };
  return {
    service: new UploadsService(cloudinary, config as never, prisma as never),
    cloudinary,
    prisma,
  };
};

describe('UploadsService', () => {
  it('uploads an allowed customer profile image in the customer namespace', async () => {
    const { service, cloudinary } = createService();
    const response = await service.uploadSingle(
      customer,
      { folder: UploadFolder.CustomerProfile },
      file,
    );

    expect(response.data.publicId).toContain('/customer/42/');
    expect(cloudinary.uploader.upload_stream).toHaveBeenCalledWith(
      expect.objectContaining({
        asset_folder: 'latache/customer-profiles/customer/42',
        resource_type: 'image',
      }),
      expect.any(Function),
    );
  });

  it('rejects a customer upload to a tasker-only folder', () => {
    const { service } = createService();
    expect(() =>
      service.uploadSingle(customer, { folder: UploadFolder.TaskerIdentityDocument }, file),
    ).toThrow(ForbiddenException);
  });

  it('rejects spoofed file content even when the MIME type is allowed', () => {
    const { service } = createService();
    expect(() =>
      service.uploadSingle(
        customer,
        { folder: UploadFolder.CustomerProfile },
        { ...file, buffer: Buffer.from('not-a-real-png') },
      ),
    ).toThrow('The file content does not match its declared MIME type');
  });

  it('rejects deletion outside the authenticated account namespace', async () => {
    const { service } = createService();
    await expect(
      service.delete(customer, {
        publicId: 'latache/customer-profiles/customer/99/test-id',
        resourceType: UploadResourceType.Image,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks deletion when an asset is referenced by persisted chat history', async () => {
    const { service, prisma, cloudinary } = createService();
    prisma.$queryRaw.mockResolvedValueOnce([{ referenced: true }]);

    await expect(
      service.delete(customer, {
        publicId: 'latache/conversation-attachments/customer/42/test-id',
        resourceType: UploadResourceType.Image,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(cloudinary.uploader.destroy).not.toHaveBeenCalled();
  });

  it('canonicalizes support attachments from provider ownership metadata', async () => {
    const { service, cloudinary } = createService();
    const publicId = 'latache/support-attachments/customer/42/support-image';
    jest.mocked(cloudinary.api.resource).mockResolvedValueOnce({
      public_id: publicId,
      secure_url: 'https://res.cloudinary.com/demo/image/upload/support-image.png',
      resource_type: 'image',
      format: 'png',
      bytes: 512,
      context: {
        custom: {
          owner_namespace: 'customer/42',
          upload_folder: 'support-attachments',
          mime_type: 'image/png',
          original_file_name: 'support-image.png',
        },
      },
    });

    await expect(
      service.verifySupportAttachments(customer, [
        {
          publicId,
          secureUrl: 'https://res.cloudinary.com/demo/image/upload/client-value.png',
          resourceType: 'image',
        },
      ]),
    ).resolves.toEqual([
      expect.objectContaining({
        publicId,
        secureUrl: 'https://res.cloudinary.com/demo/image/upload/support-image.png',
        mimeType: 'image/png',
        bytes: 512,
      }),
    ]);
  });

  it('fails closed when Cloudinary verification is unavailable', async () => {
    const { service, cloudinary } = createService();
    const publicId = 'latache/support-attachments/customer/42/support-image';
    jest.mocked(cloudinary.api.resource).mockRejectedValueOnce({ http_code: 503 });

    await expect(
      service.verifySupportAttachments(customer, [
        {
          publicId,
          secureUrl: 'https://res.cloudinary.com/demo/image/upload/support-image.png',
          resourceType: 'image',
        },
      ]),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
