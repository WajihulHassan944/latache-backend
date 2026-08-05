import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { RegistrationUploadFolder, UploadFolder } from './upload-folder.enum';

export class UploadFileDto {
  @ApiProperty({
    enum: UploadFolder,
    example: UploadFolder.CustomerProfile,
    description: 'Logical asset category. Access is validated against the authenticated account role.',
  })
  @IsEnum(UploadFolder)
  folder!: UploadFolder;
}

export class RegistrationUploadDto {
  @ApiProperty({
    enum: RegistrationUploadFolder,
    example: RegistrationUploadFolder.TaskerIdentityDocument,
    description:
      'Restricted pre-registration category used by customer/tasker signup before a bearer token exists.',
  })
  @IsEnum(RegistrationUploadFolder)
  folder!: RegistrationUploadFolder;
}
