import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { AdminPaginationDto } from './admin-pagination.dto';

const optionalBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return value;
};

export class ListAdminTaskersDto extends AdminPaginationDto {
  @ApiPropertyOptional({ example: 'omar' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ enum: ['active', 'pending_approval', 'suspended', 'deactivated'] })
  @IsOptional()
  @IsIn(['active', 'pending_approval', 'suspended', 'deactivated'])
  status?: string;

  @ApiPropertyOptional({ enum: ['submitted', 'pending_review', 'approved', 'rejected'] })
  @IsOptional()
  @IsIn(['submitted', 'pending_review', 'approved', 'rejected'])
  onboardingStatus?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(optionalBoolean)
  @IsBoolean()
  isElite?: boolean;

  @ApiPropertyOptional({ enum: ['newest', 'oldest', 'rating_desc', 'completed_desc'], default: 'newest' })
  @IsOptional()
  @IsIn(['newest', 'oldest', 'rating_desc', 'completed_desc'])
  sort?: 'newest' | 'oldest' | 'rating_desc' | 'completed_desc' = 'newest';
}
