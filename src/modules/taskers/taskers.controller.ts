import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { User } from '../../generated/prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ListTaskersQueryDto } from './dto/list-taskers-query.dto';
import { PublicTaskerReviewsQueryDto } from './dto/public-tasker-reviews-query.dto';
import { SubmitOnboardingDto } from './dto/submit-onboarding.dto';
import { TaskerDetailQueryDto } from './dto/tasker-detail-query.dto';
import { TaskerParamDto } from './dto/tasker-param.dto';
import { TaskersService } from './taskers.service';
import { RequestLocale } from '../localization/request-locale.decorator';

@ApiTags('14 Tasker Discovery')
@ApiHeader({
  name: 'Accept-Language',
  required: false,
  example: 'ary',
  description: 'Supports en, ar, and ary (Moroccan Darija), with English fallback.',
})
@Controller('taskers')
export class TaskersController {
  constructor(private readonly taskers: TaskersService) {}

  @Post('onboarding')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.Tasker)
  @ApiOperation({
    summary: 'Submit the Tasker professional onboarding application (step 2 of 2)',
    description:
      'Requires a verified Tasker identity created via POST /auth/taskers/register (or POST /auth/roles/tasker) followed by POST /auth/verify-email. Replaces any previously submitted services and availability with the ones sent here, and sets the application to pending_review for admin approval. Upload the identity document first via POST /uploads/single or POST /uploads/single/signature (folder=tasker-identity-documents), then pass its returned file metadata in identity.document.',
  })
  @ApiBody({
    type: SubmitOnboardingDto,
    examples: {
      onboarding: {
        summary: 'Cleaning + gardening Tasker application',
        value: {
          services: [
            { slug: 'cleaning', hourlyRate: 15 },
            { slug: 'gardening', hourlyRate: 20 },
          ],
          yearsOfExperience: 5,
          bio: 'Experienced house cleaner with 5 years of experience serving Casablanca and nearby areas.',
          availability: [
            { date: '2026-09-10', startTime: '09:00', endTime: '17:00' },
            { date: '2026-09-11', startTime: '09:00', endTime: '17:00' },
          ],
          identity: {
            idType: 'government-id',
            document: {
              name: 'government-id-front.jpg',
              size: 482913,
              type: 'image/jpeg',
            },
          },
          serviceArea: {
            label: 'Downtown Casablanca',
            lat: 33.5731,
            lng: -7.5898,
            radiusKm: 15,
            city: 'Casablanca',
            area: 'Maarif',
          },
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'Application submitted and set to pending_review.',
    schema: {
      example: {
        taskerId: '13',
        status: 'pending_review',
        submittedAt: '2026-09-10T08:00:00.000Z',
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'A service slug is unknown/duplicated, an hourly rate is outside the service min/max range (code TASKER_RATE_OUT_OF_SERVICE_RANGE), or a field fails validation.',
  })
  @ApiConflictResponse({
    description: 'A requested availability slot overlaps an existing booked or historical slot.',
  })
  @ApiUnauthorizedResponse({ description: 'Bearer token or active session is missing or invalid.' })
  @ApiForbiddenResponse({ description: 'The authenticated identity does not have the Tasker role.' })
  submitOnboarding(@CurrentUser() user: User, @Body() dto: SubmitOnboardingDto) {
    return this.taskers.submitOnboarding(user.id, dto);
  }

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  getTaskers(@Query() query: ListTaskersQueryDto, @RequestLocale() locale: string) {
    return this.taskers.list(query, locale);
  }

  @Get(':id/availability')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiParam({ name: 'id', required: true, type: Number, description: 'Tasker user ID.' })
  getTaskerAvailability(@Param() params: TaskerParamDto) {
    return this.taskers.getAvailability(params.id);
  }

  @Get(':id/reviews')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiParam({ name: 'id', required: true, type: Number, description: 'Tasker user ID.' })
  @ApiOperation({ summary: 'List public reviews received by an active tasker' })
  getTaskerReviews(@Param() params: TaskerParamDto, @Query() query: PublicTaskerReviewsQueryDto) {
    return this.taskers.getPublicReviews(params.id, query);
  }

  @Get(':id')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiParam({ name: 'id', required: true, type: Number, description: 'Tasker user ID.' })
  getTaskerById(
    @Param() params: TaskerParamDto,
    @Query() query: TaskerDetailQueryDto,
    @RequestLocale() locale: string,
  ) {
    return this.taskers.getById(params.id, query.serviceSlug, locale);
  }
}
