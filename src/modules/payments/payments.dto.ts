import { IsBankAccount, normalizeBankAccount } from '../../common/utils/bank-account.util';
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

  @ApiPropertyOptional({
    example: 'pm_123',
    description:
      'A Stripe PaymentMethod already attached to the authenticated Stripe Customer, used to let a customer with multiple saved cards choose which one funds this top-up. Falls back to automatic payment method selection when omitted.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(3, 255)
  stripePaymentMethodId?: string;
}

export class CreateWalletWithdrawalDto {
  @ApiProperty({ example: 50 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(100000)
  amount!: number;

  @ApiProperty({ example: 'Sarah Bennani', description: 'Name on the bank account.' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  accountHolderName!: string;

  @ApiProperty({
    example: '011780000012345678901234',
    description: 'IBAN, or a 24-digit Moroccan RIB (converted to its MA IBAN). Stored encrypted.',
  })
  @Transform(({ value }: { value: unknown }) => normalizeBankAccount(value))
  @IsBankAccount()
  iban!: string;

  @ApiPropertyOptional({ example: 'Attijariwafa Bank' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  bankName?: string;
}

export class AdminCustomerWithdrawalsQueryDto {
  @ApiPropertyOptional({ enum: ['pending_review', 'processing', 'paid', 'failed', 'rejected', 'cancelled'] })
  @IsOptional()
  @IsIn(['pending_review', 'processing', 'paid', 'failed', 'rejected', 'cancelled'])
  status?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class AdminCustomerWithdrawalActionDto {
  @ApiProperty({ enum: ['approve', 'mark_paid', 'reject', 'mark_failed'] })
  @IsIn(['approve', 'mark_paid', 'reject', 'mark_failed'])
  action!: 'approve' | 'mark_paid' | 'reject' | 'mark_failed';

  @ApiPropertyOptional({ description: 'Bank transfer reference; required for mark_paid.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 255)
  providerReference?: string;

  @ApiPropertyOptional({ description: 'Required for reject / mark_failed (shown to the customer).' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 500)
  note?: string;
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

export class CompleteBookingPaymentDto {
  @ApiProperty({
    enum: ['wallet', 'stripe', 'cash'],
    description:
      'How the customer pays for an accepted booking. May differ from (or set) the method chosen at booking time. cash confirms the booking without a charge; the Tasker collects on site.',
  })
  @IsIn(['wallet', 'stripe', 'cash'])
  source!: 'wallet' | 'stripe' | 'cash';

  @ApiPropertyOptional({ example: 'pm_123' })
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
