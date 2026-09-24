import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';

export class CreatePlatformSettlementDto {
  @ApiProperty({
    enum: ['wallet', 'stripe', 'bank_transfer'],
    description:
      'wallet: pay from available wallet balance now. stripe: returns a PaymentIntent clientSecret to confirm with Stripe.js/SDK; applied when the verified webhook arrives. bank_transfer: declare an offline transfer (reference required); applied once finance confirms receipt.',
  })
  @IsIn(['wallet', 'stripe', 'bank_transfer'])
  method!: 'wallet' | 'stripe' | 'bank_transfer';

  @ApiPropertyOptional({ example: 25.5, description: 'Defaults to the full outstanding payable. Cannot exceed it.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1_000_000)
  amount?: number;

  @ApiPropertyOptional({ example: 'TRF-2026-09-24-001', description: 'Bank transfer reference (required for bank_transfer).' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  reference?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ListPlatformSettlementsQueryDto {
  @ApiPropertyOptional({ enum: ['pending_payment', 'pending_review', 'completed', 'rejected', 'cancelled'] })
  @IsOptional()
  @IsIn(['pending_payment', 'pending_review', 'completed', 'rejected', 'cancelled'])
  status?: string;

  @ApiPropertyOptional({ description: 'Admin only: filter by Tasker id.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  taskerId?: number;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class AdminRecordPlatformSettlementDto {
  @ApiProperty({ example: 31 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  taskerId!: number;

  @ApiProperty({ example: 25.5, description: 'Amount actually received. Any excess over the outstanding payable is credited to the Tasker wallet.' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1_000_000)
  amount!: number;

  @ApiProperty({ enum: ['bank_transfer', 'cash_deposit', 'other'] })
  @IsIn(['bank_transfer', 'cash_deposit', 'other'])
  method!: 'bank_transfer' | 'cash_deposit' | 'other';

  @ApiProperty({ example: 'BANK-STMT-2026-09-24-17', description: 'Bank/receipt reference proving receipt.' })
  @IsString()
  @Length(1, 255)
  reference!: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ApprovePlatformSettlementDto {
  @ApiPropertyOptional({ description: 'Amount actually received, if different from what the Tasker declared.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1_000_000)
  receivedAmount?: number;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class RejectPlatformSettlementDto {
  @ApiProperty({ example: 'Transfer not found on the bank statement' })
  @IsString()
  @Length(5, 1000)
  note!: string;
}
