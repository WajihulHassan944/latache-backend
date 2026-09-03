import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsString, Length, Min } from 'class-validator';

export class FileMetadataDto {
  @ApiProperty({
    example: 'government-id-front.jpg',
    minLength: 1,
    maxLength: 255,
    description: 'Original file name of the already-uploaded document.',
  })
  @IsString()
  @Length(1, 255)
  name!: string;

  @ApiProperty({ example: 482913, minimum: 0, description: 'File size in bytes.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  size!: number;

  @ApiProperty({
    example: 'image/jpeg',
    minLength: 1,
    maxLength: 255,
    description: 'MIME type of the uploaded document.',
  })
  @IsString()
  @Length(1, 255)
  type!: string;
}
