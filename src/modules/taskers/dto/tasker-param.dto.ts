import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class TaskerParamDto {
  @Type(() => Number)
  @IsInt({ message: 'Invalid tasker id' })
  @Min(1, { message: 'Invalid tasker id' })
  id!: number;
}
