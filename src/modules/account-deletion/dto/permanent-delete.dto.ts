import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Length } from 'class-validator';

export class PermanentDeleteDto {
  @ApiProperty({
    enum: ['PERMANENT_DELETE'],
    example: 'PERMANENT_DELETE',
    description: 'Explicit irreversible-delete confirmation phrase.',
  })
  @IsString()
  @IsIn(['PERMANENT_DELETE'])
  confirmation!: 'PERMANENT_DELETE';

  @ApiProperty({
    example: 'Verified duplicate test account requested for permanent removal.',
    minLength: 10,
    maxLength: 1000,
  })
  @IsString()
  @Length(10, 1000)
  reason!: string;
}
