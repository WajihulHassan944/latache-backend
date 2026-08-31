import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class RegisterFcmTokenDto {
  @ApiProperty({ description: 'FCM registration token returned by Firebase Messaging.' })
  @IsString()
  @Length(1, 4096)
  token!: string;

  @ApiProperty({ enum: ['android', 'ios', 'web'] })
  @IsIn(['android', 'ios', 'web'])
  platform!: 'android' | 'ios' | 'web';

  @ApiPropertyOptional({ description: 'Stable client/device identifier when available.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  deviceId?: string;
}

export class RemoveFcmTokenDto {
  @ApiProperty({ description: 'FCM registration token to disable.' })
  @IsString()
  @Length(1, 4096)
  token!: string;
}
