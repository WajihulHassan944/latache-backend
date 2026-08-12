import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class TranslationDto {
  @ApiProperty({
    example: 'ary',
    description: 'A configured BCP-47 locale code; ary is Moroccan Darija.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase().replace('_', '-') : value,
  )
  @IsString()
  @Matches(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/)
  locale!: string;

  @ApiProperty({ example: 'تنظيف المنزل' })
  @Transform(trim)
  @IsString()
  @Length(2, 255)
  name!: string;

  @ApiPropertyOptional({ example: 'خدمات تنظيف منزلية احترافية.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 1000)
  description?: string;
}
