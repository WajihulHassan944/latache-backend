import { Type } from 'class-transformer';
import { IsInt, IsString, Length, Min } from 'class-validator';

export class FileMetadataDto {
  @IsString()
  @Length(1, 255)
  name!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  size!: number;

  @IsString()
  @Length(1, 255)
  type!: string;
}
