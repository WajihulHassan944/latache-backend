import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class TaskerVerificationActionDto {
  @ApiProperty({ enum: ['approve', 'reject'] })
  @IsIn(['approve', 'reject'])
  action!: 'approve' | 'reject';

  @ApiPropertyOptional({
    enum: ['incomplete_documentation', 'failed_background_check', 'invalid_certification', 'duplicate_account', 'underage_applicant', 'other'],
  })
  @IsOptional()
  @IsIn(['incomplete_documentation', 'failed_background_check', 'invalid_certification', 'duplicate_account', 'underage_applicant', 'other'])
  reasonCode?: string;

  @ApiPropertyOptional({ example: 'Identity document is unreadable; applicant may resubmit a clearer copy.' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason?: string;
}
