import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsString, Length } from 'class-validator';
import { UploadFolder } from './upload-folder.enum';

export class UploadSignatureDto {
  @ApiProperty({
    enum: UploadFolder,
    example: UploadFolder.CustomerProfile,
    description:
      'Logical asset category. Access is validated against the authenticated account role.',
  })
  @IsEnum(UploadFolder)
  folder!: UploadFolder;

  @ApiProperty({
    example: 'image/jpeg',
    description:
      'Declared MIME type of the file about to be uploaded directly to Cloudinary. Must be allowed for the selected folder; Cloudinary additionally enforces this via the signed allowed_formats parameter.',
  })
  @IsString()
  @Length(3, 255)
  mimeType!: string;
}

export class UploadBatchSignatureDto {
  @ApiProperty({
    enum: UploadFolder,
    example: UploadFolder.ConversationAttachment,
    description:
      'Logical asset category. Access is validated against the authenticated account role.',
  })
  @IsEnum(UploadFolder)
  folder!: UploadFolder;

  @ApiProperty({
    type: [String],
    example: ['image/jpeg', 'application/pdf'],
    description:
      'One declared MIME type per file, in upload order. A signature is returned for each entry, up to the per-folder file count limit.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Length(3, 255, { each: true })
  mimeTypes!: string[];
}
