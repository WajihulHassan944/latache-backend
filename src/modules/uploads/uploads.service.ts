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
import { isUtf8 } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import { UserRole } from '../../common/enums/user-role.enum';
import type { User } from '../../generated/prisma/client';
import { CLOUDINARY_CLIENT } from './cloudinary.constants';
import {
  CONVERSATION_ATTACHMENT_MAX_FILES,
  CONVERSATION_ATTACHMENT_MAX_FILE_SIZE_BYTES,
  CONVERSATION_ATTACHMENT_MAX_TOTAL_SIZE_BYTES,
  CONVERSATION_ATTACHMENT_MIME_TYPES,
} from './conversation-attachment.constants';
import { RegistrationUploadFolder, UploadFolder, UploadResourceType } from './dto';
import type {
  BufferedUploadFile,
  CloudinaryClient,
  CloudinaryResourceType,
  CloudinaryUploadResult,
  ConversationAttachmentReference,
  DeleteUploadSuccessResponse,
  UploadBatchSuccessResponse,
  UploadedAsset,
  UploadSuccessResponse,
} from './uploads.types';

const MIME_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
  'text/plain': ['.txt'],
  'text/csv': ['.csv'],
  'application/rtf': ['.rtf'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-powerpoint': ['.ppt'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
};

@Injectable()
export class UploadsService {
  private readonly imageMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

  private readonly documentMimeTypes = new Set([...this.imageMimeTypes, 'application/pdf']);

  private readonly conversationMimeTypes = new Set<string>(CONVERSATION_ATTACHMENT_MIME_TYPES);

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

    const maximumFiles =
      dto.folder === UploadFolder.ConversationAttachment
        ? this.config.get<number>('chat.attachmentMaxFiles', CONVERSATION_ATTACHMENT_MAX_FILES)
        : 5;
    if (files.length > maximumFiles) {
      throw new BadRequestException(`A maximum of ${maximumFiles} files is allowed`);
    }

    const validated = files.map((file) => this.validateFile(file, dto.folder));
    if (dto.folder === UploadFolder.ConversationAttachment) {
      const totalBytes = validated.reduce((total, file) => total + file.size, 0);
      const maximumTotalBytes = this.config.get<number>(
        'chat.attachmentMaxTotalSizeBytes',
        CONVERSATION_ATTACHMENT_MAX_TOTAL_SIZE_BYTES,
      );
      if (totalBytes > maximumTotalBytes) {
        throw new PayloadTooLargeException(
          `Attachment batch exceeds the ${this.megabytes(maximumTotalBytes)} MB total limit`,
        );
      }
    }

    const uploaded: Array<UploadedAsset & { resourceType: string }> = [];
    try {
      for (const file of validated) {
        const response = await this.uploadBuffer(file, dto.folder, this.ownerNamespace(user), [
          'latache',
          user.role,
          `user-${user.id}`,
          dto.folder,
        ]);
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
      data: { publicId: dto.publicId, resourceType, result },
      message:
        result === 'not found'
          ? 'Asset was already absent from Cloudinary.'
          : 'Asset deleted successfully.',
    };
  }

  /** Internal deletion path for public IDs read from Latache-owned persisted records. */
  async purgeManagedAsset(
    publicId: string,
    resourceType: CloudinaryResourceType = 'image',
  ): Promise<string> {
    const normalized = publicId.trim();
    if (!normalized.startsWith(`${this.baseFolder()}/`)) {
      throw new ForbiddenException('Only Latache Cloudinary assets can be purged');
    }
    return this.destroy(normalized, resourceType);
  }

  conversationAttachmentCapabilities() {
    return {
      uploadFolder: UploadFolder.ConversationAttachment,
      singleUploadEndpoint: '/api/uploads/single',
      multipleUploadEndpoint: '/api/uploads/multiple',
      maxFilesPerMessage: this.config.get<number>(
        'chat.attachmentMaxFiles',
        CONVERSATION_ATTACHMENT_MAX_FILES,
      ),
      maxFileSizeBytes: this.config.get<number>(
        'chat.attachmentMaxFileSizeBytes',
        CONVERSATION_ATTACHMENT_MAX_FILE_SIZE_BYTES,
      ),
      maxTotalSizeBytes: this.config.get<number>(
        'chat.attachmentMaxTotalSizeBytes',
        CONVERSATION_ATTACHMENT_MAX_TOTAL_SIZE_BYTES,
      ),
      allowedMimeTypes: [...this.conversationMimeTypes],
    };
  }

  async verifyConversationAttachments(
    user: User,
    references: ConversationAttachmentReference[],
  ): Promise<ConversationAttachmentReference[]> {
    if (references.length === 0) return [];
    if (![UserRole.Customer, UserRole.Tasker].includes(user.role as UserRole)) {
      throw new ForbiddenException('Only booking participants can send conversation attachments');
    }

    const capabilities = this.conversationAttachmentCapabilities();
    if (references.length > capabilities.maxFilesPerMessage) {
      throw new BadRequestException(
        `A message can contain at most ${capabilities.maxFilesPerMessage} attachments`,
      );
    }

    const uniqueIds = new Set<string>();
    const expectedPrefix = `${this.baseFolder()}/${UploadFolder.ConversationAttachment}/${this.ownerNamespace(user)}/`;
    const normalized: ConversationAttachmentReference[] = [];
    let totalBytes = 0;

    for (const reference of references) {
      if (uniqueIds.has(reference.publicId)) {
        throw new BadRequestException('The same attachment cannot be included more than once');
      }
      uniqueIds.add(reference.publicId);
      if (!reference.publicId.startsWith(expectedPrefix)) {
        throw new ForbiddenException('Conversation attachment does not belong to this account');
      }
      if (!this.conversationMimeTypes.has(reference.mimeType)) {
        throw new UnsupportedMediaTypeException('Conversation attachment type is not supported');
      }
      this.assertFileNameMatchesMime(reference.originalFileName, reference.mimeType);
      this.assertCloudinaryUrl(reference.secureUrl);

      const expectedResourceType = this.resourceTypeFor(reference.mimeType);
      if (reference.resourceType !== expectedResourceType) {
        throw new BadRequestException('Attachment resource type does not match its MIME type');
      }

      let resource;
      try {
        resource = await this.cloudinary.api.resource(reference.publicId, {
          resource_type: expectedResourceType,
        });
      } catch {
        throw new BadRequestException(
          'Conversation attachment could not be verified in Cloudinary',
        );
      }
      if (
        resource.public_id !== reference.publicId ||
        resource.resource_type !== expectedResourceType
      ) {
        throw new BadRequestException('Cloudinary attachment metadata does not match the request');
      }
      const context = resource.context?.custom;
      if (
        !context ||
        context.owner_namespace !== this.ownerNamespace(user) ||
        context.upload_folder !== UploadFolder.ConversationAttachment ||
        context.mime_type !== reference.mimeType
      ) {
        throw new BadRequestException(
          'Conversation attachment ownership or MIME metadata is invalid',
        );
      }
      const originalFileName = this.sanitizeOriginalName(
        context.original_file_name || reference.originalFileName,
      );
      this.assertFileNameMatchesMime(originalFileName, reference.mimeType);
      this.assertCloudinaryUrl(resource.secure_url);
      if (resource.bytes > capabilities.maxFileSizeBytes) {
        throw new PayloadTooLargeException(
          `Attachment exceeds the ${this.megabytes(capabilities.maxFileSizeBytes)} MB per-file limit`,
        );
      }
      totalBytes += resource.bytes;
      if (totalBytes > capabilities.maxTotalSizeBytes) {
        throw new PayloadTooLargeException(
          `Message attachments exceed the ${this.megabytes(capabilities.maxTotalSizeBytes)} MB total limit`,
        );
      }
      normalized.push({
        publicId: resource.public_id,
        secureUrl: resource.secure_url,
        resourceType: expectedResourceType,
        bytes: resource.bytes,
        originalFileName,
        mimeType: reference.mimeType,
        ...(resource.format ? { format: resource.format } : {}),
      });
    }
    return normalized;
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
          context: {
            owner_namespace: namespace,
            upload_folder: folder,
            mime_type: file.mimetype,
            original_file_name: this.sanitizeOriginalName(file.originalname),
          },
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
          resolve(response);
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

    const globalMaximum = this.config.get<number>('cloudinary.maxFileSizeBytes', 10 * 1024 * 1024);
    const maximum =
      folder === UploadFolder.ConversationAttachment
        ? Math.min(
            globalMaximum,
            this.config.get<number>(
              'chat.attachmentMaxFileSizeBytes',
              CONVERSATION_ATTACHMENT_MAX_FILE_SIZE_BYTES,
            ),
          )
        : globalMaximum;
    if (file.size > maximum) {
      throw new PayloadTooLargeException(`File exceeds the ${this.megabytes(maximum)} MB limit`);
    }

    const allowsConversationDocuments = folder === UploadFolder.ConversationAttachment;
    const allowsBasicDocuments =
      folder === UploadFolder.TaskerIdentityDocument ||
      folder === UploadFolder.BookingAttachment ||
      folder === UploadFolder.SupportAttachment ||
      folder === RegistrationUploadFolder.TaskerIdentityDocument;
    const allowed = allowsConversationDocuments
      ? this.conversationMimeTypes
      : allowsBasicDocuments
        ? this.documentMimeTypes
        : this.imageMimeTypes;
    if (!allowed.has(file.mimetype)) {
      throw new UnsupportedMediaTypeException(
        allowsConversationDocuments
          ? 'Chat accepts JPEG, PNG, WEBP, PDF, TXT, CSV, RTF, DOC, DOCX, XLS, XLSX, PPT, and PPTX files'
          : allowsBasicDocuments
            ? 'Only JPEG, PNG, WEBP, and PDF files are allowed for this category'
            : 'Only JPEG, PNG, and WEBP images are allowed for this category',
      );
    }

    this.assertFileNameMatchesMime(file.originalname, file.mimetype);
    this.assertFileSignature(file);
    return file;
  }

  private assertFileSignature(file: BufferedUploadFile): void {
    const bytes = file.buffer;
    const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isPng =
      bytes.length >= 8 &&
      bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isWebp =
      bytes.length >= 12 &&
      bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      bytes.subarray(8, 12).toString('ascii') === 'WEBP';
    const isPdf = bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-';
    const isOle =
      bytes.length >= 8 &&
      bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    const isZip =
      bytes.length >= 4 &&
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      [0x03, 0x05, 0x07].includes(bytes[2] ?? -1) &&
      [0x04, 0x06, 0x08].includes(bytes[3] ?? -1);
    const isText = isUtf8(bytes) && !bytes.includes(0x00);
    const isRtf = bytes.subarray(0, 5).toString('ascii') === '{\\rtf';

    const validByMime: Record<string, boolean> = {
      'image/jpeg': isJpeg,
      'image/png': isPng,
      'image/webp': isWebp,
      'application/pdf': isPdf,
      'text/plain': isText,
      'text/csv': isText,
      'application/rtf': isRtf,
      'application/msword': isOle,
      'application/vnd.ms-excel': isOle,
      'application/vnd.ms-powerpoint': isOle,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        isZip && bytes.includes(Buffer.from('word/')),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
        isZip && bytes.includes(Buffer.from('xl/')),
      'application/vnd.openxmlformats-officedocument.presentationml.presentation':
        isZip && bytes.includes(Buffer.from('ppt/')),
    };

    if (!validByMime[file.mimetype]) {
      throw new UnsupportedMediaTypeException(
        'The file content does not match its declared MIME type',
      );
    }
  }

  private assertFileNameMatchesMime(fileName: string, mimeType: string): void {
    const allowedExtensions = MIME_EXTENSIONS[mimeType];
    if (!allowedExtensions) return;
    const extension = extname(basename(fileName)).toLowerCase();
    if (!allowedExtensions.includes(extension)) {
      throw new UnsupportedMediaTypeException(`File extension does not match ${mimeType}`);
    }
  }

  private sanitizeOriginalName(value: string): string {
    return [...basename(value)]
      .filter((character) => {
        const code = character.charCodeAt(0);
        return code > 31 && code !== 127;
      })
      .join('')
      .slice(0, 255);
  }

  private assertFolderAccess(user: User, folder: UploadFolder): void {
    if (user.role === UserRole.SuperAdmin) return;

    const allowedByRole: Record<UserRole, readonly UploadFolder[]> = {
      [UserRole.SuperAdmin]: Object.values(UploadFolder),
      [UserRole.Admin]: [
        UploadFolder.AdminProfile,
        UploadFolder.ServiceImage,
        UploadFolder.EliteBadgeAsset,
        UploadFolder.BookingAttachment,
        UploadFolder.SupportAttachment,
      ],
      [UserRole.Customer]: [
        UploadFolder.CustomerProfile,
        UploadFolder.BookingAttachment,
        UploadFolder.ConversationAttachment,
        UploadFolder.SupportAttachment,
      ],
      [UserRole.Tasker]: [
        UploadFolder.TaskerProfile,
        UploadFolder.TaskerIdentityDocument,
        UploadFolder.TaskerWorkImage,
        UploadFolder.BookingAttachment,
        UploadFolder.ConversationAttachment,
        UploadFolder.SupportAttachment,
      ],
    };

    const role = user.role as UserRole;
    if (!allowedByRole[role]?.includes(folder)) {
      throw new ForbiddenException(`The ${role || 'unknown'} role cannot upload to ${folder}`);
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

  private assertCloudinaryUrl(value: string): void {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new BadRequestException('Attachment URL is invalid');
    }
    if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com') {
      throw new BadRequestException('Attachment must use a secure Cloudinary delivery URL');
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

  private publicIdFor(resourceType: CloudinaryResourceType, mimeType: string): string {
    const id = randomUUID();
    if (resourceType !== 'raw') return id;
    const extension = MIME_EXTENSIONS[mimeType]?.[0] ?? '.bin';
    return `${id}${extension}`;
  }

  private async destroy(publicId: string, resourceType: CloudinaryResourceType): Promise<string> {
    try {
      const response = await this.cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType,
        invalidate: true,
      });
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

  private megabytes(bytes: number): number {
    return Math.round((bytes / (1024 * 1024)) * 100) / 100;
  }
}
