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
  UploadFileDto,
  UploadFolder,
} from './dto';
import { UploadsService } from './uploads.service';
import type {
  BufferedUploadFile,
  DeleteUploadSuccessResponse,
  UploadBatchSuccessResponse,
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

const multipartFileSchema = {
  type: 'object',
  required: ['folder', 'file'],
  properties: {
    folder: { type: 'string', enum: Object.values(UploadFolder) },
    file: { type: 'string', format: 'binary' },
  },
};

@ApiTags('02 Uploads')
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
    summary: 'Upload a signup asset before authentication',
    description:
      'Restricted public upload for customer/tasker signup screens that require a profile image, tasker work image, or identity document before the account exists. The endpoint is rate-limited and accepts only the registration folder enum.',
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
}

@ApiTags('02 Uploads')
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
    summary: 'Upload one role-scoped file to Cloudinary',
    description:
      'Requires a valid Latache session, including registration sessions that are awaiting email verification. The server validates folder access, MIME type, file size, and writes the asset under a role/user-specific Cloudinary namespace.',
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

  @Post('multiple')
  @UseInterceptors(
    FilesInterceptor('files', 5, {
      limits: { files: 5, fileSize: 10 * 1024 * 1024 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload up to five role-scoped files',
    description:
      'Uploads files sequentially. If a later upload fails, previously uploaded assets from the same request are deleted as compensation to avoid partial batches.',
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
