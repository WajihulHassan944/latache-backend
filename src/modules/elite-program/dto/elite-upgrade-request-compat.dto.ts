import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AdminPaginationDto } from '../../admin-dashboard/dto/admin-pagination.dto';
import { ELITE_REQUEST_STATUSES, ELITE_TIER_CODES, type EliteTierCode } from '../elite-program.constants';

/**
 * Compat query DTO for GET /admin/elite-taskers/upgrade-requests - a thin
 * alias over ListEliteAdminDto's view=upgrade_requests shape, matching the
 * param names a frontend ticket asked for (status instead of requestStatus).
 */
export class AdminEliteUpgradeRequestsQueryDto extends AdminPaginationDto {
  @ApiPropertyOptional({ enum: ELITE_REQUEST_STATUSES, default: 'pending' })
  @IsOptional()
  @IsIn(ELITE_REQUEST_STATUSES)
  status?: (typeof ELITE_REQUEST_STATUSES)[number] = 'pending';

  @ApiPropertyOptional({ enum: ELITE_TIER_CODES })
  @IsOptional()
  @IsIn(ELITE_TIER_CODES)
  tier?: EliteTierCode;

  @ApiPropertyOptional({ example: 'sarah' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

/**
 * Compat body DTO for POST /admin/elite-taskers/upgrade-requests/:id/decide -
 * a thin alias over EliteDecisionDto, matching the field names a frontend
 * ticket asked for (decision instead of action).
 */
export class DecideEliteUpgradeRequestDto {
  @ApiProperty({ enum: ['approve', 'reject'] })
  @IsIn(['approve', 'reject'])
  decision!: 'approve' | 'reject';

  @ApiPropertyOptional({
    example: 'Rating dropped below the tier threshold in the last 90 days.',
    maxLength: 500,
    description: 'Required when decision is "reject".',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({
    enum: ELITE_TIER_CODES,
    description:
      'Required when decision is "approve". Must match the tier the Tasker originally requested - the backend does not let an admin redirect an upgrade request to a different tier than what was applied for.',
  })
  @IsOptional()
  @IsIn(ELITE_TIER_CODES)
  targetTier?: EliteTierCode;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reviewerNotes?: string;
}
