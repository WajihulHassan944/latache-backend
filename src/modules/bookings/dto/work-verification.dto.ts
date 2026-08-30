import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class WorkProofDto {
  @ApiProperty({ example: 'latache/booking-attachments/tasker/42/asset-id' })
  @IsString()
  @MaxLength(500)
  publicId!: string;

  @ApiProperty({ example: 'https://res.cloudinary.com/example/image/upload/v1/latache/booking-attachments/tasker/42/asset-id.jpg' })
  @IsString()
  @MaxLength(2000)
  secureUrl!: string;

  @ApiPropertyOptional({ enum: ['image'], default: 'image' })
  @IsOptional()
  @IsIn(['image'])
  resourceType?: 'image';

  @ApiPropertyOptional({ example: 'image/jpeg' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  mimeType?: string;

  @ApiPropertyOptional({ example: 'front-door.jpg' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  originalFileName?: string;
}

export class WorkOtpDto {
  @ApiProperty({ example: '482193', minLength: 6, maxLength: 6 })
  @IsString()
  @Length(6, 6)
  code!: string;
}
