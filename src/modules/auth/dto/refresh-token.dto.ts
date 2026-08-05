import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({ example: 'opaque-refresh-token', minLength: 64 })
  @IsString()
  @Length(64, 256)
  refreshToken!: string;
}
