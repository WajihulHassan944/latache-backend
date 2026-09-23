import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
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
