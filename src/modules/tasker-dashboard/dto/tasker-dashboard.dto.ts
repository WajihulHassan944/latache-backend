import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsDateOnly } from '../../../common/validators/is-date-only.validator';
import { PAYOUT_METHOD_TYPE } from '../tasker-dashboard.constants';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const lower = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const bool = ({ value }: { value: unknown }): unknown => {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
};

export class NumericIdParamDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id!: number;
}

export class StringIdParamDto {
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  id!: string;
}

export class BookingParamDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookingId!: number;
}

export class CloudinaryAssetRefDto {
  @ApiProperty({ example: 'latache/booking-attachments/tasker/42/abc123' })
  @Transform(trim)
  @IsString()
  @Length(1, 500)
  publicId!: string;

  @ApiProperty({ example: 'https://res.cloudinary.com/demo/image/upload/example.webp' })
  @Transform(trim)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  secureUrl!: string;

  @ApiPropertyOptional({ example: 'image' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(32)
  resourceType?: string;
}

export class ListTaskerTasksQueryDto {
  @ApiPropertyOptional({ enum: ['booked', 'ongoing', 'history'], default: 'booked' })
  @IsOptional()
  @IsIn(['booked', 'ongoing', 'history'])
  bucket?: 'booked' | 'ongoing' | 'history';

  @ApiPropertyOptional({ example: 76767 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookingId?: number;

  @ApiPropertyOptional({ example: '2026-08-07' })
  @IsOptional()
  @IsDateOnly()
  date?: string;

  @ApiPropertyOptional({ enum: ['id', 'date', 'price'], default: 'date' })
  @IsOptional()
  @IsIn(['id', 'date', 'price'])
  sortBy?: 'id' | 'date' | 'price';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  direction?: 'asc' | 'desc';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class CancelTaskDto {
  @ApiProperty({ example: 'Unexpected emergency; I cannot safely attend this booking.' })
  @Transform(trim)
  @IsString()
  @Length(10, 1000)
  reason!: string;
}

export class UpdateTaskerLocationDto {
  @ApiProperty({ example: 34.1065 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @ApiProperty({ example: -84.0335 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @ApiPropertyOptional({
    example: 12.5,
    description: 'Device-reported horizontal accuracy in metres.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100_000)
  accuracyM?: number;

  @ApiPropertyOptional({
    example: 180,
    description: 'Device heading in degrees from 0 inclusive to below 360.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(359.99)
  headingDeg?: number;
}

export class UpdateTimerNotesDto {
  @ApiProperty({ example: 'Replaced the faulty outlet and tested the circuit.' })
  @Transform(trim)
  @IsString()
  @MaxLength(5000)
  notes!: string;
}

export class UpdateTaskerPersonalProfileDto {
  @ApiPropertyOptional({ example: 'Arvin' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Johnson' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  lastName?: string;

  @ApiPropertyOptional({ example: '+1' })
  @IsOptional()
  @Transform(trim)
  @Matches(/^\+[1-9]\d{0,3}$/)
  phoneCountryCode?: string;

  @ApiPropertyOptional({ example: '912345698' })
  @IsOptional()
  @Transform(trim)
  @Matches(/^\d{6,24}$/)
  phoneNumber?: string;

  @ApiPropertyOptional({ example: 'I help families move safely and efficiently.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @ApiPropertyOptional({ example: 'https://res.cloudinary.com/demo/image/upload/profile.webp' })
  @IsOptional()
  @Transform(trim)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  profilePicture?: string;
}

export class UpdateTaskerBusinessProfileDto {
  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  yearsOfExperience?: number;

  @ApiPropertyOptional({ example: 'Michigan' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  serviceAreaArea?: string;

  @ApiPropertyOptional({ example: 'Detroit' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  serviceAreaCity?: string;

  @ApiPropertyOptional({ example: 'Detroit, Michigan' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  serviceAreaLabel?: string;

  @ApiPropertyOptional({ example: 42.3314 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  serviceAreaLat?: number;

  @ApiPropertyOptional({ example: -83.0458 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  serviceAreaLng?: number;

  @ApiPropertyOptional({ example: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(500)
  serviceAreaRadiusKm?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  isProfilePublic?: boolean;
}

export class ActivateTaskerSkillDto {
  @ApiProperty({ example: 'electrician' })
  @Transform(lower)
  @IsString()
  @Length(1, 120)
  serviceSlug!: string;

  @ApiProperty({
    example: 35,
    minimum: 0.01,
    maximum: 1000000,
    description: 'Hourly rate in the current platform currency. The selected Service minimum/maximum bounds are enforced transactionally.',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1000000)
  hourlyRate!: number;
}

export class UpdateTaskerSkillDto {
  @ApiProperty({
    example: 42.5,
    minimum: 0.01,
    maximum: 1000000,
    description: 'Hourly rate in the current platform currency. Must remain within the Service rate limits.',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1000000)
  hourlyRate!: number;
}

export class ListNotificationsQueryDto {
  @ApiPropertyOptional({ enum: ['all', 'messages', 'tasks', 'wallet', 'system'], default: 'all' })
  @IsOptional()
  @IsIn(['all', 'messages', 'tasks', 'wallet', 'system'])
  category?: 'all' | 'messages' | 'tasks' | 'wallet' | 'system';

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  unread?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 30, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class ListConversationsQueryDto {
  @ApiPropertyOptional({ example: 'Meera' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 30, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class ListMessagesQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class SendTaskMessageDto {
  @ApiPropertyOptional({ example: 'I am on the way and should arrive around the scheduled time.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(5000)
  body?: string;

  @ApiPropertyOptional({ type: [CloudinaryAssetRefDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => CloudinaryAssetRefDto)
  attachments?: CloudinaryAssetRefDto[];
}

export class ListReviewsQueryDto {
  @ApiPropertyOptional({ enum: ['received', 'given'], default: 'received' })
  @IsOptional()
  @IsIn(['received', 'given'])
  view?: 'received' | 'given';

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class CreateReviewDto {
  @ApiProperty({ example: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiPropertyOptional({ example: 'Clear communication and a smooth appointment.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class UpdateReviewDto extends CreateReviewDto {}

export class ListWalletTransactionsQueryDto {
  @ApiPropertyOptional({
    description:
      'Ledger entry ID returned as nextCursor. Cursor mode is recommended for long wallet histories and takes precedence over page.',
    example: 'cm5ledger123',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 40)
  cursor?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 30, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class CreatePayoutMethodDto {
  @ApiProperty({
    enum: Object.values(PAYOUT_METHOD_TYPE),
    example: PAYOUT_METHOD_TYPE.BankTransfer,
  })
  @IsEnum(PAYOUT_METHOD_TYPE)
  type!: (typeof PAYOUT_METHOD_TYPE)[keyof typeof PAYOUT_METHOD_TYPE];

  @ApiProperty({ example: 'Primary bank account' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  label!: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ example: 'Sarah Johnson' })
  @ValidateIf((object: CreatePayoutMethodDto) => object.type !== PAYOUT_METHOD_TYPE.GooglePay)
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  accountHolderName?: string;

  @ApiPropertyOptional({ example: 'Bank of Example' })
  @ValidateIf((object: CreatePayoutMethodDto) => object.type === PAYOUT_METHOD_TYPE.BankTransfer)
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  bankName?: string;

  @ApiPropertyOptional({ example: 'GB82WEST12345698765432' })
  @ValidateIf((object: CreatePayoutMethodDto) => object.type === PAYOUT_METHOD_TYPE.BankTransfer)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/\s+/g, '').toUpperCase() : value,
  )
  @Matches(/^[A-Z]{2}[0-9A-Z]{13,32}$/)
  iban?: string;

  @ApiPropertyOptional({ example: '+212' })
  @ValidateIf((object: CreatePayoutMethodDto) => object.type === PAYOUT_METHOD_TYPE.OrangeMoney)
  @Transform(trim)
  @Matches(/^\+[1-9]\d{0,3}$/)
  phoneCountryCode?: string;

  @ApiPropertyOptional({ example: '612345678' })
  @ValidateIf((object: CreatePayoutMethodDto) => object.type === PAYOUT_METHOD_TYPE.OrangeMoney)
  @Transform(trim)
  @Matches(/^\d{6,24}$/)
  phoneNumber?: string;

  @ApiPropertyOptional({ example: 'sarah@example.com' })
  @ValidateIf((object: CreatePayoutMethodDto) => object.type === PAYOUT_METHOD_TYPE.Paypal)
  @Transform(lower)
  @IsEmail()
  @MaxLength(255)
  paypalEmail?: string;
}

export class ConfigurePayoutPinDto {
  @ApiProperty({
    example: 'CurrentAccountPassword@123',
    description: 'Current Latache account password used to authorize initial payout-PIN setup.',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @ApiProperty({
    example: '482913',
    description: 'Six-digit payout PIN. It is hashed and never returned.',
  })
  @Transform(trim)
  @Matches(/^\d{6}$/)
  pin!: string;
}

export class ChangePayoutPinDto {
  @ApiProperty({ example: '482913' })
  @Transform(trim)
  @Matches(/^\d{6}$/)
  currentPin!: string;

  @ApiProperty({ example: '739205' })
  @Transform(trim)
  @Matches(/^\d{6}$/)
  newPin!: string;
}

export class RequestWithdrawalDto {
  @ApiProperty({ example: 'cm10abc123' })
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  payoutMethodId!: string;

  @ApiProperty({ example: 100 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10_000_000)
  amount!: number;

  @ApiProperty({
    example: '482913',
    description: 'Six-digit payout PIN required to authorize the reservation.',
  })
  @Transform(trim)
  @Matches(/^\d{6}$/)
  pin!: string;
}
