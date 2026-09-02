import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, Length } from 'class-validator';
import { RegistrationUploadFolder } from './upload-folder.enum';

export class RegistrationUploadSignatureDto {
  @ApiProperty({
    enum: RegistrationUploadFolder,
    example: RegistrationUploadFolder.TaskerIdentityDocument,
    description:
      'Restricted pre-registration category used by customer/tasker signup before a bearer token exists.',
  })
  @IsEnum(RegistrationUploadFolder)
  folder!: RegistrationUploadFolder;

  @ApiProperty({
    example: 'image/jpeg',
    description:
      'Declared MIME type of the file the client is about to upload directly to Cloudinary. Must be one of the types allowed for the selected folder; Cloudinary additionally enforces this via the signed allowed_formats parameter.',
  })
  @IsString()
  @Length(3, 255)
  mimeType!: string;
}
