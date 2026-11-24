import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class ListInvoicesQueryDto {
  @ApiPropertyOptional({ enum: ['booking', 'tasker_deposit'] })
  @IsOptional()
  @IsIn(['booking', 'tasker_deposit'])
  type?: 'booking' | 'tasker_deposit';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class AdminListInvoicesQueryDto extends ListInvoicesQueryDto {
  @ApiPropertyOptional({ description: 'User the invoice is billed to.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  billedToId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookingId?: number;

  @ApiPropertyOptional({ description: 'Invoice number, or billed user name/email.', example: 'INV-2026' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-30' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
}
