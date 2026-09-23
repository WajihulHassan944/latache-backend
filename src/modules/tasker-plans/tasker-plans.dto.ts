import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AdminPaginationDto } from '../admin-dashboard/dto/admin-pagination.dto';
import { TASKER_PLAN_STATUS } from './tasker-plans.constants';

export class TaskerPlanParamDto {
  @IsString()
  @Length(1, 32)
  planId!: string;
}

export class PurchaseTaskerPlanDto {
  @ApiProperty({
    example: 'wallet',
    description:
      "'wallet' debits the Tasker wallet, 'stripe' charges the default saved card, any other value is treated as a saved Stripe PaymentMethod id. No fallback between methods.",
  })
  @IsString()
  @Length(3, 255)
  paymentMethod!: string;
}

export class TaskerSubscriptionParamDto {
  @IsString()
  @Length(1, 40)
  subscriptionId!: string;
}

export class ListTaskerSubscriptionsDto extends AdminPaginationDto {
  @ApiPropertyOptional({ enum: Object.values(TASKER_PLAN_STATUS) })
  @IsOptional()
  @IsIn(Object.values(TASKER_PLAN_STATUS))
  status?: string;
}

export class ReviewTaskerSubscriptionDto {
  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class TaskerPlanOverrideDto {
  @ApiPropertyOptional({ example: 'Gold' })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  name?: string;

  @ApiPropertyOptional({ description: 'false stops new purchases; existing subscribers keep renewing.' })
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @ApiPropertyOptional({ example: 100, description: 'Monthly price in MAD.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(100000)
  monthlyPrice?: number;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  platformFeePercent?: number;

  @ApiPropertyOptional({ example: 25, description: 'Monthly wallet bonus in MAD.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  monthlyBonus?: number;

  @ApiPropertyOptional({ example: 2, description: '% of each online-paid booking service amount credited at earning release.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(50)
  revenueSharePercent?: number;

  @ApiPropertyOptional({ enum: ['priority_email', 'phone_and_email', 'dedicated_account_manager'] })
  @IsOptional()
  @IsIn(['priority_email', 'phone_and_email', 'dedicated_account_manager'])
  supportTier?: 'priority_email' | 'phone_and_email' | 'dedicated_account_manager';

  @ApiPropertyOptional({ enum: ['none', 'quarterly', 'monthly'] })
  @IsOptional()
  @IsIn(['none', 'quarterly', 'monthly'])
  spotlightFrequency?: 'none' | 'quarterly' | 'monthly';

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 200, { each: true })
  perks?: string[];
}

export class UpdateTaskerPlanCatalogDto {
  @ApiPropertyOptional({ type: TaskerPlanOverrideDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TaskerPlanOverrideDto)
  gold?: TaskerPlanOverrideDto;

  @ApiPropertyOptional({ type: TaskerPlanOverrideDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TaskerPlanOverrideDto)
  platinum?: TaskerPlanOverrideDto;

  @ApiPropertyOptional({ type: TaskerPlanOverrideDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TaskerPlanOverrideDto)
  diamond?: TaskerPlanOverrideDto;
}
