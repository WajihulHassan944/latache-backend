import { IsString, Length } from 'class-validator';

export class CreateServiceDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsString()
  @Length(1, 1000)
  description!: string;

  @IsString()
  @Length(1, 120)
  slug!: string;

  @IsString()
  @Length(1, 255)
  icon!: string;
}
