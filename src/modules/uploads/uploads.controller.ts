import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '../../generated/prisma/client';
import { JwtIdentityGuard } from '../auth/guards/jwt-identity.guard';
import {
  DeleteUploadDto,
  RegistrationUploadDto,
  RegistrationUploadFolder,
  RegistrationUploadSignatureDto,
  UploadBatchSignatureDto,
  UploadFileDto,
  UploadFolder,
  UploadSignatureDto,
} from './dto';
import { UploadsService } from './uploads.service';
import type {
  BufferedUploadFile,
  DeleteUploadSuccessResponse,
  UploadBatchSignatureResponse,
  UploadBatchSuccessResponse,
  UploadSignatureResponse,
  UploadSuccessResponse,
} from './uploads.types';

const singleUploadResponseExample = {
  success: true,
  data: {
    publicId: 'latache/customer-profiles/customer/42/2647a81d-b126-4cb8-a26f-ef4685f3118a',
    secureUrl:
      'https://res.cloudinary.com/demo/image/upload/v1775555555/latache/customer-profiles/customer/42/2647a81d-b126-4cb8-a26f-ef4685f3118a.webp',
    url: 'http://res.cloudinary.com/demo/image/upload/v1775555555/latache/customer-profiles/customer/42/2647a81d-b126-4cb8-a26f-ef4685f3118a.webp',
    resourceType: 'image',
    format: 'webp',
    bytes: 165238,
    width: 800,
    height: 800,
    folder: 'customer-profiles',
    originalFileName: 'avatar.webp',
    mimeType: 'image/webp',
    createdAt: '2026-08-05T10:30:00Z',
  },
  message: 'File uploaded successfully.',
};

const registrationSignatureResponseExample = {
  success: true,
  data: {
    cloudName: 'demo',
    apiKey: '123456789012345',
    uploadUrl: 'https://api.cloudinary.com/v1_1/demo/image/upload',
    resourceType: 'image',
    timestamp: 1775555555,
    signature: '3f7a1c9e2b8d4f6a1c9e2b8d4f6a1c9e2b8d4f6a',
    publicId:
      'latache/tasker-identity-documents/pending-registration/2647a81d-b126-4cb8-a26f-ef4685f3118a',
    assetFolder: 'latache/tasker-identity-documents/pending-registration',
    tags: 'latache,registration,tasker-identity-documents',
    context:
      'owner_namespace=pending-registration|upload_folder=tasker-identity-documents|mime_type=image/jpeg',
    allowedFormats: 'jpg,jpeg,png,webp,pdf',
    overwrite: false,
    uniqueFilename: false,
    useFilename: false,
  },
  message: 'Upload signature issued. POST the file directly to uploadUrl with these exact fields.',
};

const uploadSignatureResponseExample = {
  success: true,
  data: {
    cloudName: 'demo',
    apiKey: '123456789012345',
    uploadUrl: 'https://api.cloudinary.com/v1_1/demo/image/upload',
    resourceType: 'image',
    timestamp: 1775555555,
    signature: '3f7a1c9e2b8d4f6a1c9e2b8d4f6a1c9e2b8d4f6a',
    publicId: 'latache/customer-profiles/customer/42/2647a81d-b126-4cb8-a26f-ef4685f3118a',
    assetFolder: 'latache/customer-profiles/customer/42',
    tags: 'latache,customer,user-42,customer-profiles',
    context: 'owner_namespace=customer/42|upload_folder=customer-profiles|mime_type=image/jpeg',
    allowedFormats: 'jpg,jpeg,png,webp',
    overwrite: false,
    uniqueFilename: false,
    useFilename: false,
  },
  message: 'Upload signature issued. POST the file directly to uploadUrl with these exact fields.',
};

const uploadBatchSignatureResponseExample = {
  success: true,
  data: [uploadSignatureResponseExample.data, uploadSignatureResponseExample.data],
  message: '2 upload signature(s) issued. POST each file directly to its uploadUrl with the matching fields.',
};

const multipartFileSchema = {
  type: 'object',
  required: ['folder', 'file'],
  properties: {
    folder: { type: 'string', enum: Object.values(UploadFolder) },
    file: { type: 'string', format: 'binary' },
  },
};

@ApiTags('04 Uploads')
@Controller('uploads')
export class RegistrationUploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('registration')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { files: 1, fileSize: 10 * 1024 * 1024 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a signup asset before authentication (small files only)',
    description:
      'Restricted public upload for customer/tasker signup screens that require a profile image, tasker work image, or identity document before the account exists. The endpoint is rate-limited and accepts only the registration folder enum. This route proxies the file through the API server, so on serverless hosts (e.g. Vercel) it is subject to the platform gateway body-size limit regardless of the configured 10 MB application limit; prefer POST /uploads/registration/signature for real phone photos and documents, which routinely exceed that platform ceiling.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['folder', 'file'],
      properties: {
        folder: {
          type: 'string',
          enum: Object.values(RegistrationUploadFolder),
          example: RegistrationUploadFolder.TaskerIdentityDocument,
        },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'The temporary signup asset was uploaded to Cloudinary.',
    schema: { example: singleUploadResponseExample },
  })
  @ApiBadRequestResponse({ description: 'No file was provided or the folder is invalid.' })
  @ApiPayloadTooLargeResponse({ description: 'The file exceeds the configured upload limit.' })
  @ApiUnsupportedMediaTypeResponse({
    description: 'The file MIME type is not allowed for the selected folder.',
  })
  @ApiServiceUnavailableResponse({
    description: 'Cloudinary rejected or could not process the upload.',
  })
  uploadRegistrationFile(
    @Body() dto: RegistrationUploadDto,
    @UploadedFile() file: BufferedUploadFile | undefined,
  ): Promise<UploadSuccessResponse> {
    return this.uploads.uploadRegistrationFile(dto, file);
  }

  @Post('registration/signature')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Get a signed direct-to-Cloudinary upload for a signup asset',
    description:
      'Returns a short-lived Cloudinary signature so the frontend uploads the file directly from the browser to Cloudinary and never through this API. This is the primary path for signup profile photos and identity documents: real phone photos are routinely 2-8 MB, well above what serverless gateways (e.g. Vercel) accept for a function request body, so routing them through POST /uploads/registration fails before this code ever runs. POST the returned fields plus the file as multipart/form-data directly to uploadUrl.',
  })
  @ApiCreatedResponse({
    description: 'Signed upload parameters for a direct browser-to-Cloudinary upload.',
    schema: { example: registrationSignatureResponseExample },
  })
  @ApiBadRequestResponse({ description: 'The folder is invalid.' })
  @ApiUnsupportedMediaTypeResponse({
    description: 'The declared MIME type is not allowed for the selected folder.',
  })
  getRegistrationUploadSignature(
    @Body() dto: RegistrationUploadSignatureDto,
  ): UploadSignatureResponse {
    return this.uploads.createRegistrationUploadSignature(dto);
  }
}

@ApiTags('04 Uploads')
@ApiBearerAuth('bearer')
@UseGuards(JwtIdentityGuard)
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('single')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { files: 1, fileSize: 10 * 1024 * 1024 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload one role-scoped file to Cloudinary (small files only)',
    description:
      'Requires a valid Latache session, including registration sessions that are awaiting email verification. The server validates folder access, MIME type, file size, and writes the asset under a role/user-specific Cloudinary namespace. This route proxies the file through the API server, so on serverless hosts (e.g. Vercel) it is subject to the platform gateway body-size limit regardless of the configured 10 MB application limit; prefer POST /uploads/single/signature for real phone photos and documents.',
  })
  @ApiBody({ schema: multipartFileSchema })
  @ApiCreatedResponse({ schema: { example: singleUploadResponseExample } })
  @ApiBadRequestResponse({ description: 'No file was provided or the folder is invalid.' })
  @ApiUnauthorizedResponse({ description: 'Bearer token or active session is missing or invalid.' })
  @ApiForbiddenResponse({ description: 'The authenticated role cannot use the selected folder.' })
  @ApiPayloadTooLargeResponse({ description: 'The file exceeds the configured upload limit.' })
  @ApiUnsupportedMediaTypeResponse({
    description: 'The file MIME type is not allowed for the selected folder.',
  })
  @ApiServiceUnavailableResponse({
    description: 'Cloudinary rejected or could not process the upload.',
  })
  uploadSingle(
    @CurrentUser() user: User,
    @Body() dto: UploadFileDto,
    @UploadedFile() file: BufferedUploadFile | undefined,
  ): Promise<UploadSuccessResponse> {
    return this.uploads.uploadSingle(user, dto, file);
  }

  @Post('single/signature')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get a signed direct-to-Cloudinary upload for one role-scoped file',
    description:
      'Returns a short-lived Cloudinary signature scoped to the authenticated account\'s own namespace so the frontend uploads the file directly from the browser to Cloudinary, never through this API. This is the primary path for anything larger than a trivial file, since real photos and documents routinely exceed what serverless gateways (e.g. Vercel) accept for a function request body. POST the returned fields plus the file as multipart/form-data directly to uploadUrl.',
  })
  @ApiCreatedResponse({
    description: 'Signed upload parameters for a direct browser-to-Cloudinary upload.',
    schema: { example: uploadSignatureResponseExample },
  })
  @ApiBadRequestResponse({ description: 'The folder is invalid.' })
  @ApiUnauthorizedResponse({ description: 'Bearer token or active session is missing or invalid.' })
  @ApiForbiddenResponse({ description: 'The authenticated role cannot use the selected folder.' })
  @ApiUnsupportedMediaTypeResponse({
    description: 'The declared MIME type is not allowed for the selected folder.',
  })
  getUploadSignature(
    @CurrentUser() user: User,
    @Body() dto: UploadSignatureDto,
  ): UploadSignatureResponse {
    return this.uploads.createUploadSignature(user, dto);
  }

  @Post('multiple')
  @UseInterceptors(
    FilesInterceptor('files', 5, {
      limits: { files: 5, fileSize: 10 * 1024 * 1024 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload up to five role-scoped files (small files only)',
    description:
      'Uploads files sequentially. If a later upload fails, previously uploaded assets from the same request are deleted as compensation to avoid partial batches. This route proxies every file through the API server, so on serverless hosts (e.g. Vercel) it is subject to the platform gateway body-size limit regardless of the configured 10 MB application limit; prefer POST /uploads/multiple/signature for real phone photos and documents.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['folder', 'files'],
      properties: {
        folder: { type: 'string', enum: Object.values(UploadFolder) },
        files: {
          type: 'array',
          minItems: 1,
          maxItems: 5,
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  })
  @ApiCreatedResponse({
    schema: {
      example: {
        success: true,
        data: [singleUploadResponseExample.data, singleUploadResponseExample.data],
        message: '2 files uploaded successfully.',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'No files were provided or more than five were submitted.',
  })
  @ApiUnauthorizedResponse({ description: 'Bearer token or active session is missing or invalid.' })
  @ApiForbiddenResponse({ description: 'The authenticated role cannot use the selected folder.' })
  @ApiPayloadTooLargeResponse({ description: 'One of the files exceeds the upload limit.' })
  @ApiUnsupportedMediaTypeResponse({
    description: 'One of the files has an unsupported MIME type.',
  })
  @ApiServiceUnavailableResponse({
    description: 'Cloudinary rejected or could not process the batch.',
  })
  uploadMultiple(
    @CurrentUser() user: User,
    @Body() dto: UploadFileDto,
    @UploadedFiles() files: BufferedUploadFile[] | undefined,
  ): Promise<UploadBatchSuccessResponse> {
    return this.uploads.uploadMultiple(user, dto, files);
  }

  @Post('multiple/signature')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get signed direct-to-Cloudinary uploads for several role-scoped files',
    description:
      'Returns one independent Cloudinary signature per declared file (same folder, one entry per mimeType, in order), scoped to the authenticated account\'s own namespace, up to the folder\'s file-count limit. The frontend uploads each file directly to Cloudinary from the browser; this API never sees the bytes. Note that the total-batch-size cap enforced by POST /uploads/multiple cannot be enforced here since file sizes are unknown until upload; folders that verify attachments at time of use (conversation/support/booking/dispute) still enforce per-file and total-size limits there.',
  })
  @ApiCreatedResponse({
    description: 'One signed upload per requested file.',
    schema: { example: uploadBatchSignatureResponseExample },
  })
  @ApiBadRequestResponse({
    description: 'No MIME types were provided or more than the folder limit were submitted.',
  })
  @ApiUnauthorizedResponse({ description: 'Bearer token or active session is missing or invalid.' })
  @ApiForbiddenResponse({ description: 'The authenticated role cannot use the selected folder.' })
  @ApiUnsupportedMediaTypeResponse({
    description: 'One of the declared MIME types is not allowed for the selected folder.',
  })
  getUploadSignatures(
    @CurrentUser() user: User,
    @Body() dto: UploadBatchSignatureDto,
  ): UploadBatchSignatureResponse {
    return this.uploads.createUploadSignatures(user, dto);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete one Cloudinary asset',
    description:
      'Customers, taskers, and admins can delete only assets inside their own role/user namespace. The super administrator can delete any asset under the configured Latache Cloudinary root folder.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        success: true,
        data: {
          publicId: 'latache/customer-profiles/customer/42/2647a81d-b126-4cb8-a26f-ef4685f3118a',
          resourceType: 'image',
          result: 'ok',
        },
        message: 'Asset deleted successfully.',
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Bearer token or active session is missing or invalid.' })
  @ApiForbiddenResponse({ description: 'The asset does not belong to the authenticated account.' })
  @ApiServiceUnavailableResponse({ description: 'Cloudinary could not delete the asset.' })
  delete(
    @CurrentUser() user: User,
    @Body() dto: DeleteUploadDto,
  ): Promise<DeleteUploadSuccessResponse> {
    return this.uploads.delete(user, dto);
  }
}
