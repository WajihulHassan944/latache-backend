import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, Max, Min } from 'class-validator';

/**
 * Shared by the Customer (`PATCH /auth/me/location`) and Guest
 * (`PATCH /guest/location`) explicit location-save operations. Both fields
 * are required together: a saved location is only ever set wholesale by one
 * of these calls, never partially, so GET /api/taskers can trust that a
 * saved latitude always has a matching saved longitude.
 */
export class UpdateLocationDto {
  @ApiProperty({
    example: 33.5731,
    minimum: -90,
    maximum: 90,
    description: 'Latitude of the selected location.',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({
    example: -7.5898,
    minimum: -180,
    maximum: 180,
    description: 'Longitude of the selected location.',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;
}
