import { IsOptional, IsString, MaxLength } from 'class-validator';

export class TaskerDetailQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  serviceSlug?: string;
}
