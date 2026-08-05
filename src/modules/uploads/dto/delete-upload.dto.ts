import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';

export enum UploadResourceType {
  Image = 'image',
  Video = 'video',
  Raw = 'raw',
}

export class DeleteUploadDto {
  @ApiProperty({
    example: 'latache/customer-profiles/customer/42/2647a81d-b126-4cb8-a26f-ef4685f3118a',
    description: 'Cloudinary public ID returned by an upload endpoint. Do not send the secure URL.',
  })
  @IsString()
  @Length(3, 500)
  @Matches(/^[a-zA-Z0-9/_.-]+$/, {
    message: 'publicId contains unsupported characters',
  })
  publicId!: string;

  @ApiPropertyOptional({
    enum: UploadResourceType,
    default: UploadResourceType.Image,
    description: 'Cloudinary resource type used when the asset was uploaded.',
  })
  @IsOptional()
  @IsEnum(UploadResourceType)
  resourceType: UploadResourceType = UploadResourceType.Image;
}
