import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateAdminProfileDto {
  @ApiPropertyOptional({ example: 'Priya' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Nair' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({ example: '+212' })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9]{1,7}$/)
  phoneCountryCode?: string;

  @ApiPropertyOptional({ example: '612345678' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{5,20}$/)
  phoneNumber?: string;
}
