import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

const bool = ({ value }: { value: unknown }): unknown => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

export class ListNotificationsQueryDto {
  @ApiPropertyOptional({
    enum: ['all', 'messages', 'tasks', 'payments', 'wallet', 'system'],
    default: 'all',
  })
  @IsOptional()
  @IsIn(['all', 'messages', 'tasks', 'payments', 'wallet', 'system'])
  category?: 'all' | 'messages' | 'tasks' | 'payments' | 'wallet' | 'system';

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  unread?: boolean;

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

export class NotificationIdParamDto {
  id!: string;
}
