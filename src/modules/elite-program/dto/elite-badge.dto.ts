import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { ELITE_TIER_CODES, type EliteTierCode } from '../elite-program.constants';

export class CreateEliteBadgeDto {
  @ApiProperty({ example: 'reliability_pro' })
  @IsString()
  @MaxLength(64)
  code!: string;

  @ApiProperty({ example: 'Reliability Pro' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ enum: ELITE_TIER_CODES, nullable: true })
  @IsOptional()
  @IsIn(ELITE_TIER_CODES)
  tier?: EliteTierCode;

  @ApiPropertyOptional({ example: 'Recognizes strong reliability.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: 'https://res.cloudinary.com/.../badge.png' })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(1000)
  assetUrl?: string;

  @ApiPropertyOptional({ type: Object, description: 'Descriptive criteria. Automatic award evaluation is not implied.' })
  @IsOptional()
  @IsObject()
  criteria?: Record<string, unknown>;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;
}

export class UpdateEliteBadgeDto extends PartialType(CreateEliteBadgeDto) {}

export class RevokeEliteBadgeDto {
  @ApiPropertyOptional({ example: 'Badge revoked after manual quality review.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
