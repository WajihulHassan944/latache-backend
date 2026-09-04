import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsString, Length, Min } from 'class-validator';

export class FileMetadataDto {
  @ApiProperty({
    example: 'passport.pdf',
    minLength: 1,
    maxLength: 255,
    description: 'Original file name of the already-uploaded document.',
  })
  @IsString()
  @Length(1, 255)
  name!: string;

  @ApiProperty({ example: 1234567, minimum: 0, description: 'File size in bytes.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  size!: number;

  @ApiProperty({
    example: 'application/pdf',
    minLength: 1,
    maxLength: 255,
    description: 'MIME type of the uploaded document.',
  })
  @IsString()
  @Length(1, 255)
  type!: string;

  @ApiProperty({
    example: 'latache/identity/abc123',
    minLength: 1,
    maxLength: 500,
    description:
      'Cloudinary public ID for the uploaded identity document, returned by POST /uploads/single or POST /uploads/single/signature (folder=tasker-identity-documents). Required because identity documents are uploaded directly to Cloudinary; it is verified against Cloudinary and tied to this Tasker\'s own upload namespace before being persisted, so the backend can reliably locate the file later.',
  })
  @IsString()
  @Length(1, 500)
  publicId!: string;

  @ApiProperty({
    example: 'https://res.cloudinary.com/demo/image/upload/v1775555555/latache/identity/abc123.pdf',
    minLength: 1,
    maxLength: 2000,
    description:
      'Secure Cloudinary delivery URL for the uploaded identity document. Must exactly match the verified Cloudinary resource for publicId; arbitrary or unrelated URLs are rejected.',
  })
  @IsString()
  @Length(1, 2000)
  secureUrl!: string;
}
