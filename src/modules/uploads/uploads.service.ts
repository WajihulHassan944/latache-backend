import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { User } from '../../generated/prisma/client';
import { UserRole } from '../../common/enums/user-role.enum';
import { CLOUDINARY_CLIENT } from './cloudinary.constants';
import {
  RegistrationUploadFolder,
  UploadFolder,
  UploadResourceType,
} from './dto';
import type {
  BufferedUploadFile,
  CloudinaryClient,
  CloudinaryResourceType,
  CloudinaryUploadResult,
  DeleteUploadSuccessResponse,
  UploadBatchSuccessResponse,
  UploadedAsset,
  UploadSuccessResponse,
} from './uploads.types';


@Injectable()
export class UploadsService {
  private readonly imageMimeTypes = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
  ]);

  private readonly documentMimeTypes = new Set([
    ...this.imageMimeTypes,
    'application/pdf',
  ]);

  constructor(
    @Inject(CLOUDINARY_CLIENT)
    private readonly cloudinary: CloudinaryClient,
    private readonly config: ConfigService,
  ) {}

  uploadRegistrationFile(
    dto: { folder: RegistrationUploadFolder },
    file: BufferedUploadFile | undefined,
  ): Promise<UploadSuccessResponse> {
    const validated = this.validateFile(file, dto.folder);
    return this.uploadBuffer(validated, dto.folder, 'pending-registration', [
      'latache',
      'registration',
      dto.folder,
    ]);
  }

  uploadSingle(
    user: User,
    dto: { folder: UploadFolder },
    file: BufferedUploadFile | undefined,
  ): Promise<UploadSuccessResponse> {
    this.assertFolderAccess(user, dto.folder);
    const validated = this.validateFile(file, dto.folder);
    return this.uploadBuffer(validated, dto.folder, this.ownerNamespace(user), [
      'latache',
      user.role,
      `user-${user.id}`,
      dto.folder,
    ]);
  }

  async uploadMultiple(
    user: User,
    dto: { folder: UploadFolder },
    files: BufferedUploadFile[] | undefined,
  ): Promise<UploadBatchSuccessResponse> {
    this.assertFolderAccess(user, dto.folder);
    if (!files?.length) throw new BadRequestException('At least one file is required');
    if (files.length > 5) throw new BadRequestException('A maximum of five files is allowed');

    const validated = files.map((file) => this.validateFile(file, dto.folder));
    const uploaded: Array<UploadedAsset & { resourceType: string }> = [];

    try {
      for (const file of validated) {
        const response = await this.uploadBuffer(
          file,
          dto.folder,
          this.ownerNamespace(user),
          ['latache', user.role, `user-${user.id}`, dto.folder],
        );
        uploaded.push(response.data);
      }
    } catch (error) {
      await Promise.allSettled(
        uploaded.map((asset) =>
          this.destroy(asset.publicId, this.normalizeResourceType(asset.resourceType)),
        ),
      );
      throw error;
    }

    return {
      success: true,
      data: uploaded,
      message: `${uploaded.length} files uploaded successfully.`,
    };
  }

  async delete(
    user: User,
    dto: { publicId: string; resourceType?: UploadResourceType },
  ): Promise<DeleteUploadSuccessResponse> {
    this.assertDeleteAccess(user, dto.publicId);
    const resourceType = dto.resourceType ?? UploadResourceType.Image;
    const result = await this.destroy(dto.publicId, resourceType);

    return {
      success: true as const,
      data: {
        publicId: dto.publicId,
        resourceType,
        result,
      },
      message:
        result === 'not found'
          ? 'Asset was already absent from Cloudinary.'
          : 'Asset deleted successfully.',
    };
  }

  private async uploadBuffer(
    file: BufferedUploadFile,
    folder: string,
    namespace: string,
    tags: string[],
  ): Promise<UploadSuccessResponse> {
    const resourceType = this.resourceTypeFor(file.mimetype);
    const cloudinaryFolder = `${this.baseFolder()}/${folder}/${namespace}`;
    const publicId = `${cloudinaryFolder}/${this.publicIdFor(resourceType, file.mimetype)}`;
    const result = await new Promise<CloudinaryUploadResult>((resolve, reject) => {
      const stream = this.cloudinary.uploader.upload_stream(
        {
          asset_folder: cloudinaryFolder,
          public_id: publicId,
          resource_type: resourceType,
          use_filename: false,
          unique_filename: false,
          overwrite: false,
          tags,
        },
        (error, response) => {
          if (error) {
            reject(
              new ServiceUnavailableException({
                code: 'CLOUDINARY_UPLOAD_FAILED',
                message: error.message || 'Cloudinary upload failed',
              }),
            );
            return;
          }
          if (!response) {
            reject(
              new ServiceUnavailableException({
                code: 'CLOUDINARY_EMPTY_RESPONSE',
                message: 'Cloudinary returned an empty upload response',
              }),
            );
            return;
          }
          resolve(response as CloudinaryUploadResult);
        },
      );
      stream.end(file.buffer);
    });

    return {
      success: true,
      data: {
        publicId: result.public_id,
        secureUrl: result.secure_url,
        url: result.url,
        resourceType: result.resource_type,
        format: result.format,
        bytes: result.bytes,
        width: result.width,
        height: result.height,
        duration: result.duration,
        folder,
        originalFileName: this.sanitizeOriginalName(file.originalname),
        mimeType: file.mimetype,
        createdAt: result.created_at,
      },
      message: 'File uploaded successfully.',
    };
  }

  private validateFile(
    file: BufferedUploadFile | undefined,
    folder: UploadFolder | RegistrationUploadFolder,
  ): BufferedUploadFile {
    if (!file?.buffer?.length) throw new BadRequestException('A file is required');

    const maxBytes = this.config.get<number>('cloudinary.maxFileSizeBytes', 10 * 1024 * 1024);
    if (file.size > maxBytes) {
      throw new PayloadTooLargeException(
        `File exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB limit`,
      );
    }

    const allowsDocuments =
      folder === UploadFolder.TaskerIdentityDocument ||
      folder === UploadFolder.BookingAttachment ||
      folder === RegistrationUploadFolder.TaskerIdentityDocument;
    const allowed = allowsDocuments ? this.documentMimeTypes : this.imageMimeTypes;
    if (!allowed.has(file.mimetype)) {
      throw new UnsupportedMediaTypeException(
        allowsDocuments
          ? 'Only JPEG, PNG, WEBP, and PDF files are allowed for this category'
          : 'Only JPEG, PNG, and WEBP images are allowed for this category',
      );
    }

    this.assertFileSignature(file);
    return file;
  }

  private assertFileSignature(file: BufferedUploadFile): void {
    const bytes = file.buffer;
    const isJpeg =
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff;
    const isPng =
      bytes.length >= 8 &&
      bytes.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    const isWebp =
      bytes.length >= 12 &&
      bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      bytes.subarray(8, 12).toString('ascii') === 'WEBP';
    const isPdf =
      bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-';

    const validByMime: Record<string, boolean> = {
      'image/jpeg': isJpeg,
      'image/png': isPng,
      'image/webp': isWebp,
      'application/pdf': isPdf,
    };

    if (!validByMime[file.mimetype]) {
      throw new UnsupportedMediaTypeException(
        'The file content does not match its declared MIME type',
      );
    }
  }

  private sanitizeOriginalName(value: string): string {
    return basename(value).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255);
  }

  private assertFolderAccess(user: User, folder: UploadFolder): void {
    if (user.role === UserRole.SuperAdmin) return;

    const allowedByRole: Record<UserRole, readonly UploadFolder[]> = {
      [UserRole.SuperAdmin]: Object.values(UploadFolder),
      [UserRole.Admin]: [UploadFolder.AdminProfile, UploadFolder.ServiceImage, UploadFolder.EliteBadgeAsset, UploadFolder.BookingAttachment],
      [UserRole.Customer]: [
        UploadFolder.CustomerProfile,
        UploadFolder.BookingAttachment,
      ],
      [UserRole.Tasker]: [
        UploadFolder.TaskerProfile,
        UploadFolder.TaskerIdentityDocument,
        UploadFolder.TaskerWorkImage,
        UploadFolder.BookingAttachment,
      ],
    };

    const role = user.role as UserRole;
    if (!allowedByRole[role]?.includes(folder)) {
      throw new ForbiddenException(
        `The ${role || 'unknown'} role cannot upload to ${folder}`,
      );
    }
  }

  private assertDeleteAccess(user: User, publicId: string): void {
    const rootPrefix = `${this.baseFolder()}/`;
    if (!publicId.startsWith(rootPrefix)) {
      throw new ForbiddenException('Only Latache Cloudinary assets can be deleted');
    }
    if (user.role === UserRole.SuperAdmin) return;

    const ownerMarker = `/${this.ownerNamespace(user)}/`;
    if (!publicId.includes(ownerMarker)) {
      throw new ForbiddenException('You can delete only assets uploaded by your account');
    }
  }

  private ownerNamespace(user: User): string {
    return `${user.role}/${user.id}`;
  }

  private resourceTypeFor(mimeType: string): CloudinaryResourceType {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    return 'raw';
  }

  private normalizeResourceType(value: string): CloudinaryResourceType {
    return value === 'video' || value === 'raw' ? value : 'image';
  }

  private publicIdFor(
    resourceType: CloudinaryResourceType,
    mimeType: string,
  ): string {
    const id = randomUUID();
    if (resourceType !== 'raw') return id;
    return mimeType === 'application/pdf' ? `${id}.pdf` : `${id}.bin`;
  }


  private async destroy(
    publicId: string,
    resourceType: CloudinaryResourceType,
  ): Promise<string> {
    try {
      const response = (await this.cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType,
        invalidate: true,
      })) as { result?: string };
      return response.result ?? 'unknown';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cloudinary delete failed';
      throw new ServiceUnavailableException({
        code: 'CLOUDINARY_DELETE_FAILED',
        message,
      });
    }
  }

  private baseFolder(): string {
    return this.config.get<string>('cloudinary.folder', 'latache').replace(/^\/+|\/+$/g, '');
  }
}
