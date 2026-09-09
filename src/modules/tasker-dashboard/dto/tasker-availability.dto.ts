import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { AvailabilitySlotDto } from '../../taskers/dto/submit-onboarding.dto';

export class AddTaskerAvailabilityDto {
  @ApiProperty({
    type: [AvailabilitySlotDto],
    description: 'One or more new open availability slots to add to the calendar.',
    example: [
      { date: '2026-09-20', startTime: '09:00', endTime: '17:00' },
      { date: '2026-09-21', startTime: '09:00', endTime: '13:00' },
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AvailabilitySlotDto)
  availability!: AvailabilitySlotDto[];
}
