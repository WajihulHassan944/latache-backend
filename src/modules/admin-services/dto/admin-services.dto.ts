import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AdminServicesQueryDto {
  @ApiPropertyOptional({
    enum: ['catalog', 'pricing', 'icons'],
    default: 'catalog',
    description:
      'view=icons returns the curated catalogue of valid Service.icon values (with display labels) for building the create/edit-service icon picker.',
  })
  @IsOptional()
  @IsIn(['catalog', 'pricing', 'icons'])
  view?: 'catalog' | 'pricing' | 'icons';

  @ApiPropertyOptional({ enum: ['all', 'active', 'inactive'], default: 'all' })
  @IsOptional()
  @IsIn(['all', 'active', 'inactive'])
  status?: 'all' | 'active' | 'inactive';

  @ApiPropertyOptional({ example: 'cleaning' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 30, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
