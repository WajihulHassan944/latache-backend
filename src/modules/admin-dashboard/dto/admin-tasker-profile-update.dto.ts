import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class AdminTaskerProfileUpdateDto {
  @ApiPropertyOptional({ example: 'Sarah', minLength: 2, maxLength: 100 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Ahmed', minLength: 2, maxLength: 100 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  lastName?: string;

  @ApiPropertyOptional({ example: '+212', description: 'International dialing prefix.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^\+[1-9]\d{0,3}$/, {
    message: 'phoneCountryCode must be a valid international dialing prefix',
  })
  phoneCountryCode?: string;

  @ApiPropertyOptional({ example: '612345678', maxLength: 24 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^\d{6,24}$/, { message: 'phoneNumber must contain 6 to 24 digits' })
  phoneNumber?: string;
}
