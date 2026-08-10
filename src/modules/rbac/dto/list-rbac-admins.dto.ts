import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AccountStatus } from '../../../common/enums/account-status.enum';

export class ListRbacAdminsDto {
  @ApiPropertyOptional({ example: 'priya', description: 'Searches name or email.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ example: 'finance_admin', description: 'Filters by role code.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  roleCode?: string;

  @ApiPropertyOptional({ enum: AccountStatus, example: AccountStatus.Active })
  @IsOptional()
  @IsEnum(AccountStatus)
  accountStatus?: AccountStatus;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
