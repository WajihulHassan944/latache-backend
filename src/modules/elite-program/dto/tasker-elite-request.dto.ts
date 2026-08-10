import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ELITE_REQUEST_KINDS, type EliteRequestKind } from '../elite-program.constants';

export class TaskerEliteRequestDto {
  @ApiProperty({ enum: ELITE_REQUEST_KINDS, example: 'upgrade' })
  @IsIn(ELITE_REQUEST_KINDS)
  kind!: EliteRequestKind;

  @ApiPropertyOptional({ example: 'I would like my recent performance reviewed for the next tier.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
