import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

export class EliteBenefitInputDto {
  @ApiProperty({ example: 'reduced_platform_fee' })
  @IsString()
  @MaxLength(64)
  code!: string;

  @ApiProperty({ example: 'Reduced Platform Fee' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: '10%' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayValue?: string;

  @ApiPropertyOptional({ type: Object, description: 'Configuration metadata only. Financial effects are not applied unless a consuming payment/service module explicitly supports them.' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number = 0;
}

export class ReplaceEliteBenefitsDto {
  @ApiProperty({ type: [EliteBenefitInputDto] })
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => EliteBenefitInputDto)
  benefits!: EliteBenefitInputDto[];
}
