import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { AdminDateRangeQueryDto } from '../../admin-dashboard/dto/admin-date-range-query.dto';
import { ELITE_REPORT_FORMATS, ELITE_REPORT_TYPES, type EliteReportFormat, type EliteReportType } from '../elite-program.constants';

export class EliteReportQueryDto extends AdminDateRangeQueryDto {
  @ApiPropertyOptional({ enum: ELITE_REPORT_TYPES, default: 'monthly_summary' })
  @IsOptional()
  @IsIn(ELITE_REPORT_TYPES)
  type?: EliteReportType = 'monthly_summary';

  @ApiPropertyOptional({ enum: ELITE_REPORT_FORMATS, default: 'json' })
  @IsOptional()
  @IsIn(ELITE_REPORT_FORMATS)
  format?: EliteReportFormat = 'json';
}
