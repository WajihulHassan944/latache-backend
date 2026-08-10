import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CloudinaryAssetRefDto } from '../tasker-dashboard/dto/tasker-dashboard.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class ListConversationsQueryDto {
  @ApiPropertyOptional({ example: 'Marcus' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  search?: string;

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

export class ListMessagesQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class SendMessageDto {
  @ApiPropertyOptional({ example: 'I am available. Please let me know if the access instructions changed.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(5000)
  body?: string;

  @ApiPropertyOptional({ type: [CloudinaryAssetRefDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => CloudinaryAssetRefDto)
  attachments?: CloudinaryAssetRefDto[];
}

export class BookingConversationParamDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookingId!: number;
}
