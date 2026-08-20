import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

const normalizeCode = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const trimText = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class ClaimReferralDto {
  @ApiProperty({ example: 'LTC8A2F95C17B04D6E2' })
  @Transform(normalizeCode)
  @IsString()
  @Length(8, 20)
  code!: string;
}

export class ReferralHistoryQueryDto {
  @ApiPropertyOptional({ enum: ['invites', 'rewards'], default: 'invites' })
  @IsOptional()
  @IsIn(['invites', 'rewards'])
  view?: 'invites' | 'rewards' = 'invites';

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 30;
}

export class ReferralLeaderboardQueryDto {
  @ApiPropertyOptional({ enum: ['customer', 'tasker'] })
  @IsOptional()
  @IsIn(['customer', 'tasker'])
  program?: 'customer' | 'tasker';

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 20;
}

export class AdminReferralQueryDto {
  @IsOptional() @IsIn(['customer', 'tasker']) program?: 'customer' | 'tasker';
  @IsOptional()
  @IsIn(['claimed', 'qualified', 'rewarded', 'expired', 'revoked'])
  status?: 'claimed' | 'qualified' | 'rewarded' | 'expired' | 'revoked';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) referrerId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) referredUserId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 30;
}

export class ReferralParamDto {
  @IsString()
  @Length(20, 40)
  id!: string;
}

export class RevokeReferralDto {
  @ApiProperty({ example: 'Verified duplicate-account abuse.', minLength: 10, maxLength: 1000 })
  @Transform(trimText)
  @IsString()
  @Length(10, 1000)
  reason!: string;
}
