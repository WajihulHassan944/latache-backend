import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AccountStatus } from '../../../common/enums/account-status.enum';

const ADMIN_MANAGEABLE_STATUSES = [
  AccountStatus.Active,
  AccountStatus.Suspended,
  AccountStatus.Deactivated,
] as const;

export class UpdateAdminStatusDto {
  @ApiProperty({ enum: ADMIN_MANAGEABLE_STATUSES, example: AccountStatus.Suspended })
  @IsIn(ADMIN_MANAGEABLE_STATUSES)
  accountStatus!: AccountStatus;

  @ApiPropertyOptional({
    example: 'Access temporarily suspended while an internal review is completed.',
    description: 'Required for suspension/deactivation. Optional when reactivating.',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason?: string;
}
