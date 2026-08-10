import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, Matches } from 'class-validator';

export class AssignAdminAccessDto {
  @ApiProperty({
    example: 'finance_admin',
    description: 'Active role code returned by GET /api/rbac/roles.',
  })
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{2,63}$/)
  roleCode!: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['finance.read', 'reports.read'],
    description:
      'Optional least-privilege override. Every value must be included in the selected role. Omit to inherit future role permission updates.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  permissions?: string[];
}
