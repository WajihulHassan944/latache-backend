import { Transform, Type } from 'class-transformer';
import { IsEmail, IsInt, Max, MaxLength, Min } from 'class-validator';

export class VerifyOtpDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(9999)
  otp!: number;
}
