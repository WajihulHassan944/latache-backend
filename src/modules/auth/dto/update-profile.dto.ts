import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUrl, Length, Matches, MaxLength } from 'class-validator';
import { trim } from './common-auth.dto';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Sarah' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Ahmed' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  lastName?: string;

  @ApiPropertyOptional({ example: '+212' })
  @IsOptional()
  @Transform(trim)
  @Matches(/^\+[1-9]\d{0,3}$/)
  phoneCountryCode?: string;

  @ApiPropertyOptional({ example: '612345678' })
  @IsOptional()
  @Transform(trim)
  @Matches(/^\d{6,24}$/)
  phoneNumber?: string;

  @ApiPropertyOptional({ example: '10001' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(3, 16)
  zipCode?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/avatar.jpg' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2048)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  profilePicture?: string;

  @ApiPropertyOptional({ example: 'Available on weekends.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  bio?: string;

  @ApiPropertyOptional({
    enum: ['en', 'ar', 'ary'],
    example: 'ary',
    description:
      'Persists the account language used before Accept-Language for dynamic content, notifications, and email. ary is Moroccan Darija.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase().replace('_', '-') : value,
  )
  @IsString()
  @Matches(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/)
  preferredLanguage?: string;
}
