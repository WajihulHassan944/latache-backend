import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AdminPaginationDto } from '../../admin-dashboard/dto/admin-pagination.dto';
import {
  ELITE_ADMIN_LIST_VIEWS,
  ELITE_REQUEST_STATUSES,
  ELITE_TIER_CODES,
  type EliteAdminListView,
  type EliteRequestStatus,
  type EliteTierCode,
} from '../elite-program.constants';

export class ListEliteAdminDto extends AdminPaginationDto {
  @ApiPropertyOptional({ enum: ELITE_ADMIN_LIST_VIEWS, default: 'members' })
  @IsOptional()
  @IsIn(ELITE_ADMIN_LIST_VIEWS)
  view?: EliteAdminListView = 'members';

  @ApiPropertyOptional({ enum: ELITE_TIER_CODES })
  @IsOptional()
  @IsIn(ELITE_TIER_CODES)
  tier?: EliteTierCode;

  @ApiPropertyOptional({
    enum: ELITE_REQUEST_STATUSES,
    default: 'pending',
    description: 'Used for request queue views.',
  })
  @IsOptional()
  @IsIn(ELITE_REQUEST_STATUSES)
  requestStatus?: EliteRequestStatus = 'pending';

  @ApiPropertyOptional({ example: 'sarah' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({
    enum: ['newest', 'oldest', 'rating_desc', 'jobs_desc', 'earnings_desc'],
    default: 'newest',
  })
  @IsOptional()
  @IsIn(['newest', 'oldest', 'rating_desc', 'jobs_desc', 'earnings_desc'])
  sort?: 'newest' | 'oldest' | 'rating_desc' | 'jobs_desc' | 'earnings_desc' = 'newest';
}
