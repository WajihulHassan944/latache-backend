import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ACCOUNT_TYPES, type AccountType } from './accounting.constants';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONEY = { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false };
const MAX_AMOUNT = 999_999_999;

export class PeriodQueryDto {
  @ApiProperty({ example: '2026-01-01' }) @Matches(DAY) from!: string;
  @ApiProperty({ example: '2026-12-31' }) @Matches(DAY) to!: string;
}

export class AsOfQueryDto {
  @ApiProperty({ example: '2026-12-31' }) @Matches(DAY) asOf!: string;
}

export class JournalQueryDto {
  @ApiPropertyOptional() @IsOptional() @Matches(DAY) from?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DAY) to?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['auto', 'manual', 'opening', 'expense', 'reversal']) source?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) search?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class LedgerQueryDto extends PeriodQueryDto {
  @ApiProperty({ example: '1010' }) @IsString() @Length(1, 12) account!: string;
}

export class ExportQueryDto {
  @ApiProperty({ enum: ['csv', 'pdf'] }) @IsIn(['csv', 'pdf']) format!: 'csv' | 'pdf';
  @ApiPropertyOptional() @IsOptional() @Matches(DAY) from?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DAY) to?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DAY) asOf?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 12) account?: string;
}

export class CreateAccountDto {
  @ApiProperty({ example: '6080' }) @Matches(/^\d{4,8}$/, { message: 'code must be 4 to 8 digits' }) code!: string;
  @ApiProperty() @IsString() @Length(2, 120) name!: string;
  @ApiProperty({ enum: ACCOUNT_TYPES }) @IsIn(ACCOUNT_TYPES) type!: AccountType;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isCash?: boolean;
}

export class UpdateAccountDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ManualLineDto {
  @ApiProperty() @IsString() @Length(1, 12) accountCode!: string;
  @ApiProperty() @IsNumber(MONEY) @Min(0) @Max(MAX_AMOUNT) debit!: number;
  @ApiProperty() @IsNumber(MONEY) @Min(0) @Max(MAX_AMOUNT) credit!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) memo?: string;
}

export class CreateEntryDto {
  @ApiProperty() @Matches(DAY) date!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(500) memo!: string;
  @ApiProperty({ enum: ['manual', 'opening'] }) @IsIn(['manual', 'opening']) type!: 'manual' | 'opening';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) reference?: string;
  @ApiProperty({ type: () => ManualLineDto, isArray: true })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ManualLineDto)
  lines!: ManualLineDto[];
}

export class ReverseEntryDto {
  @ApiProperty() @Matches(DAY) date!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(300) reason!: string;
}

export class CreateExpenseDto {
  @ApiProperty() @Matches(DAY) date!: string;
  @ApiProperty() @IsString() @Length(1, 12) accountCode!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(160) vendor!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(500) description!: string;
  @ApiProperty({ description: 'Amount before VAT' }) @IsNumber(MONEY) @Min(0.01) @Max(MAX_AMOUNT) netAmount!: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber(MONEY) @Min(0) @Max(MAX_AMOUNT) vatAmount?: number;
  @ApiPropertyOptional({ description: 'Money account it was paid from; omit if still unpaid' })
  @IsOptional() @IsString() @Length(1, 12) paidFromCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) reference?: string;
}

export class PayExpenseDto {
  @ApiProperty() @Matches(DAY) date!: string;
  @ApiProperty() @IsString() @Length(1, 12) paidFromCode!: string;
}

export class VoidExpenseDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(300) reason!: string;
}

export class ExpenseQueryDto {
  @ApiPropertyOptional() @IsOptional() @Matches(DAY) from?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DAY) to?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['unpaid', 'paid', 'void']) status?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class UpdateBookSettingsDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) fiscalYearStartMonth?: number;
}

export class ClosePeriodDto {
  @ApiPropertyOptional({ description: 'Close everything up to and including this date; null reopens all periods', nullable: true })
  @IsOptional()
  @Matches(DAY)
  through?: string | null;
}
