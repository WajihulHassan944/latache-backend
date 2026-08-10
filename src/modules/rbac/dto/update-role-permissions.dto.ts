import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

export class UpdateRolePermissionsDto {
  @ApiProperty({
    type: [String],
    example: ['finance.read', 'reports.read'],
    description: 'Complete replacement set. Assigned admins inheriting the role are synchronized transactionally.',
  })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  permissions!: string[];
}
