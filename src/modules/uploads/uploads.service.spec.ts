import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { UserRole } from '../../common/enums/user-role.enum';
import type { User } from '../../generated/prisma/client';
import { RegistrationUploadFolder, UploadFolder, UploadResourceType } from './dto';
import { UploadsService } from './uploads.service';
import type { BufferedUploadFile, CloudinaryClient } from './uploads.types';

const customer = {
  id: 42,
  role: UserRole.Customer,
} as User;

const tasker = {
  id: 42,
  role: UserRole.Tasker,
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
    utils: {
      api_sign_request: jest.fn().mockReturnValue('signed-signature'),
    },
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
  const configValues: Record<string, unknown> = {
    'cloudinary.folder': 'latache',
    'cloudinary.maxFileSizeBytes': 10 * 1024 * 1024,
    'cloudinary.cloudName': 'demo',
    'cloudinary.apiKey': 'test-api-key',
    'cloudinary.apiSecret': 'test-api-secret',
  };
  const config = {
    get: jest.fn((key: string, fallback: unknown) =>
      key in configValues ? configValues[key] : fallback,
    ),
    getOrThrow: jest.fn((key: string) => {
      if (!(key in configValues)) throw new Error(`Missing config: ${key}`);
      return configValues[key];
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
    const secureUrl = 'https://res.cloudinary.com/demo/image/upload/support-image.png';
    jest.mocked(cloudinary.api.resource).mockResolvedValueOnce({
      public_id: publicId,
      secure_url: secureUrl,
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
      service.verifySupportAttachments(customer, [{ publicId, secureUrl, resourceType: 'image' }]),
    ).resolves.toEqual([
      expect.objectContaining({
        publicId,
        secureUrl,
        mimeType: 'image/png',
        bytes: 512,
      }),
    ]);
  });

  it('rejects a support attachment whose claimed secureUrl does not match the verified Cloudinary resource', async () => {
    // Added alongside the disputes system (see uploads.service.ts's exact
    // secure_url match check): the client's publicId is trusted only to
    // look up the resource, never to imply its URL - a stale/mismatched
    // claimed secureUrl is rejected outright rather than silently
    // overwritten, since it signals the caller's record has diverged from
    // the server's rather than validation being merely cosmetic here.
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
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('verifies a Tasker identity document against Cloudinary and returns the server-confirmed reference', async () => {
    const { service, cloudinary } = createService();
    const publicId = 'latache/tasker-identity-documents/tasker/42/passport';
    jest.mocked(cloudinary.api.resource).mockResolvedValueOnce({
      public_id: publicId,
      secure_url: 'https://res.cloudinary.com/demo/image/upload/passport.pdf',
      resource_type: 'raw',
      format: 'pdf',
      bytes: 1234567,
      context: {
        custom: {
          owner_namespace: 'tasker/42',
          upload_folder: 'tasker-identity-documents',
          mime_type: 'application/pdf',
          original_file_name: 'passport.pdf',
        },
      },
    });

    await expect(
      service.verifyTaskerIdentityDocument(tasker, {
        publicId,
        secureUrl: 'https://res.cloudinary.com/demo/image/upload/passport.pdf',
        mimeType: 'application/pdf',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        publicId,
        secureUrl: 'https://res.cloudinary.com/demo/image/upload/passport.pdf',
        mimeType: 'application/pdf',
        bytes: 1234567,
      }),
    );
  });

  it('rejects an identity document publicId that does not belong to the calling Tasker', async () => {
    const { service } = createService();
    await expect(
      service.verifyTaskerIdentityDocument(tasker, {
        publicId: 'latache/tasker-identity-documents/tasker/999/passport',
        secureUrl: 'https://res.cloudinary.com/demo/image/upload/passport.pdf',
        mimeType: 'application/pdf',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an identity document reference whose secureUrl is not a genuine Cloudinary delivery URL', async () => {
    const { service } = createService();
    await expect(
      service.verifyTaskerIdentityDocument(tasker, {
        publicId: 'latache/tasker-identity-documents/tasker/42/passport',
        secureUrl: 'https://evil.example.com/passport.pdf',
        mimeType: 'application/pdf',
      }),
    ).rejects.toThrow();
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

  it('issues a signed direct-to-Cloudinary upload for a registration asset', () => {
    const { service, cloudinary } = createService();

    const response = service.createRegistrationUploadSignature({
      folder: RegistrationUploadFolder.TaskerIdentityDocument,
      mimeType: 'image/jpeg',
    });

    expect(response.data.publicId).toMatch(
      /^latache\/tasker-identity-documents\/pending-registration\/[0-9a-f-]{36}$/,
    );
    expect(response.data.assetFolder).toBe('latache/tasker-identity-documents/pending-registration');
    expect(response.data.resourceType).toBe('image');
    expect(response.data.uploadUrl).toBe('https://api.cloudinary.com/v1_1/demo/image/upload');
    expect(response.data.tags).toBe('latache,registration,tasker-identity-documents');
    expect(response.data.context).toBe(
      'owner_namespace=pending-registration|upload_folder=tasker-identity-documents|mime_type=image/jpeg',
    );
    expect(response.data.allowedFormats.split(',').sort()).toEqual(
      ['jpg', 'jpeg', 'png', 'webp', 'pdf'].sort(),
    );
    expect(response.data.signature).toBe('signed-signature');
    expect(cloudinary.utils.api_sign_request).toHaveBeenCalledWith(
      expect.objectContaining({
        asset_folder: 'latache/tasker-identity-documents/pending-registration',
        public_id: response.data.publicId,
        overwrite: 'false',
        unique_filename: 'false',
        use_filename: 'false',
      }),
      'test-api-secret',
    );
  });

  it('escapes pipe and equals characters in the signed context string', () => {
    const { service } = createService();

    const response = service.createRegistrationUploadSignature({
      folder: RegistrationUploadFolder.CustomerProfile,
      mimeType: 'image/png',
    });

    expect(response.data.context).toBe(
      'owner_namespace=pending-registration|upload_folder=customer-profiles|mime_type=image/png',
    );
  });

  it('rejects a declared MIME type outside the folder allowlist', () => {
    const { service } = createService();

    expect(() =>
      service.createRegistrationUploadSignature({
        folder: RegistrationUploadFolder.CustomerProfile,
        mimeType: 'application/pdf',
      }),
    ).toThrow(UnsupportedMediaTypeException);
  });

  it('issues a signed direct-to-Cloudinary upload scoped to the caller namespace', () => {
    const { service } = createService();

    const response = service.createUploadSignature(customer, {
      folder: UploadFolder.CustomerProfile,
      mimeType: 'image/jpeg',
    });

    expect(response.data.publicId).toMatch(
      /^latache\/customer-profiles\/customer\/42\/[0-9a-f-]{36}$/,
    );
    expect(response.data.assetFolder).toBe('latache/customer-profiles/customer/42');
    expect(response.data.tags).toBe('latache,customer,user-42,customer-profiles');
    expect(response.data.context).toBe(
      'owner_namespace=customer/42|upload_folder=customer-profiles|mime_type=image/jpeg',
    );
  });

  it('rejects a single-upload signature for a folder the role cannot access', () => {
    const { service } = createService();

    expect(() =>
      service.createUploadSignature(customer, {
        folder: UploadFolder.TaskerIdentityDocument,
        mimeType: 'image/jpeg',
      }),
    ).toThrow(ForbiddenException);
  });

  it('issues one independent signature per requested file in a batch', () => {
    const { service } = createService();

    const response = service.createUploadSignatures(customer, {
      folder: UploadFolder.ConversationAttachment,
      mimeTypes: ['image/jpeg', 'application/pdf'],
    });

    expect(response.data).toHaveLength(2);
    expect(response.data[0]?.publicId).not.toBe(response.data[1]?.publicId);
    expect(response.data[1]?.resourceType).toBe('raw');
    expect(response.data.every((entry) => entry.assetFolder === response.data[0]?.assetFolder)).toBe(
      true,
    );
  });

  it('rejects a batch signature request over the folder file-count limit', () => {
    const { service } = createService();

    expect(() =>
      service.createUploadSignatures(customer, {
        folder: UploadFolder.CustomerProfile,
        mimeTypes: Array.from({ length: 6 }, () => 'image/jpeg'),
      }),
    ).toThrow(/maximum of 5 files/);
  });

  it('rejects a batch signature request with an unsupported MIME type', () => {
    const { service } = createService();

    expect(() =>
      service.createUploadSignatures(customer, {
        folder: UploadFolder.CustomerProfile,
        mimeTypes: ['image/jpeg', 'application/pdf'],
      }),
    ).toThrow(UnsupportedMediaTypeException);
  });
});
