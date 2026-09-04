import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class ConvertGuestSessionDto {
  @ApiProperty({
    description:
      'The raw guest token previously issued by POST /guest/token. Ownership of the token is the only proof required to link its session to the now-authenticated account; the converted account itself is always the caller, never a client-supplied ID.',
    minLength: 64,
    maxLength: 256,
  })
  @IsString()
  @Length(64, 256)
  guestToken!: string;
}
