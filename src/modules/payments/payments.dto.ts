import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class PaymentMethodParamDto {
  @ApiProperty({ example: 'pm_123' })
  @Transform(trim)
  @IsString()
  @Length(3, 255)
  id!: string;
}

export class BookingPaymentParamDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookingId!: number;
}

export class CreateWalletTopupDto {
  @ApiProperty({ example: 50 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(100000)
  amount!: number;
}

export class RetryBookingPaymentDto {
  @ApiPropertyOptional({
    example: 'pm_123',
    description: 'A Stripe PaymentMethod already attached to the authenticated Stripe Customer.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(3, 255)
  paymentMethodId?: string;
}

export class ListPaymentTransactionsQueryDto {
  @ApiPropertyOptional({
    enum: ['all', 'booking_charge', 'wallet_topup', 'refund'],
    default: 'all',
  })
  @IsOptional()
  @IsIn(['all', 'booking_charge', 'wallet_topup', 'refund'])
  kind?: 'all' | 'booking_charge' | 'wallet_topup' | 'refund';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 30, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
