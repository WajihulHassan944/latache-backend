import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
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
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '../../generated/prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { GuestAwareRequest } from '../guest/guest-request';
import { GuestOrIdentityGuard } from '../guest/guards/guest-or-identity.guard';
import { resolveSavedLocation } from './discovery-location.util';
import { ListTaskersQueryDto } from './dto/list-taskers-query.dto';
import { PublicTaskerReviewsQueryDto } from './dto/public-tasker-reviews-query.dto';
import { SubmitOnboardingDto } from './dto/submit-onboarding.dto';
import { TaskerDetailQueryDto } from './dto/tasker-detail-query.dto';
import { TaskerParamDto } from './dto/tasker-param.dto';
import { TaskersService } from './taskers.service';
import { RequestLocale } from '../localization/request-locale.decorator';

/** GuestOrIdentityGuard sets exactly one of `guest` (guest token) or `user` (bearer JWT). */
interface DiscoveryRequest extends GuestAwareRequest {
  user?: User;
}

@ApiTags('16 Tasker Discovery')
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
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Submit the Tasker professional onboarding application (step 2 of 2)',
    description:
      'Requires a verified Tasker identity created via POST /auth/taskers/register (or POST /auth/roles/tasker) followed by POST /auth/verify-email. Replaces any previously submitted services and availability with the ones sent here, and sets the application to pending_review for admin approval. Upload the identity document first via POST /uploads/single or POST /uploads/single/signature (folder=tasker-identity-documents), then pass its returned file metadata - including publicId and secureUrl - in identity.document; the document is uploaded directly to Cloudinary, and publicId/secureUrl are re-verified against Cloudinary and this Tasker\'s own upload namespace before being persisted, so arbitrary or unrelated URLs cannot be substituted. Deliberately reachable while the Tasker profile is pending_approval/rejected - this endpoint is precisely how it becomes active, so it does not go through RolesGuard\'s operational-profile check that gates already-active Tasker marketplace APIs; the Tasker role membership itself is still verified inside the transaction.',
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
              name: 'passport.pdf',
              size: 1234567,
              type: 'application/pdf',
              publicId: 'latache/identity/abc123',
              secureUrl: 'https://res.cloudinary.com/demo/image/upload/v1775555555/latache/identity/abc123.pdf',
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
  @ApiForbiddenResponse({
    description:
      'The authenticated identity does not have the Tasker role, or identity.document.publicId does not belong to this Tasker\'s own Cloudinary upload namespace.',
  })
  @ApiUnsupportedMediaTypeResponse({
    description: 'The verified Cloudinary resource for identity.document is not an allowed document type.',
  })
  @ApiServiceUnavailableResponse({
    description: 'Cloudinary could not verify the identity document.',
  })
  submitOnboarding(@CurrentUser() user: User, @Body() dto: SubmitOnboardingDto) {
    return this.taskers.submitOnboarding(user, dto);
  }

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiBearerAuth('bearer')
  @UseGuards(GuestOrIdentityGuard)
  @ApiOperation({
    summary: 'Search/list active Taskers, optionally filtered by nearby location',
    description:
      'Requires either a guest token from POST /guest/token or a normal Customer/Tasker/Admin bearer session, sent as Authorization: Bearer <token>. Location precedence: (1) lat+lng on this request, if both are provided; (2) otherwise, the saved location on the authenticated Customer\'s account or, for a guest, on the guest session (from PATCH /auth/me/location or PATCH /guest/location); (3) otherwise, plain discovery with no location filtering. Only Taskers whose distance from the resolved point is within both radius (default 100 km) and their own configured service radius are returned, and every result includes distanceKm from that point; sort=nearest orders by distance ascending. Sending lat/lng here never changes the saved location - only the dedicated location-update endpoints do that. Combine with serviceSlug, date/startTime/endTime availability, minPrice/maxPrice, isElite, search, and sort for a full discovery search.',
  })
  @ApiUnauthorizedResponse({ description: 'Guest token or bearer session is missing, invalid, expired, or revoked.' })
  @ApiBadRequestResponse({
    description:
      'lat was provided without lng (or vice versa), sort=nearest was used without lat/lng, minPrice is greater than maxPrice, or a field fails validation.',
  })
  @ApiOkResponse({
    description: 'Paginated Tasker results.',
    schema: {
      example: {
        items: [
          {
            id: '42',
            name: 'Sarah Ahmed',
            avatar: 'https://res.cloudinary.com/demo/image/upload/v1/avatar.webp',
            rating: 4.8,
            reviewsCount: 37,
            pricePerHour: 15,
            bio: 'Experienced house cleaner serving Casablanca.',
            completedTasks: 52,
            yearsOfExperience: 5,
            vehicles: [],
            serviceSlug: 'cleaning',
            workImages: [],
            isElite: true,
            eliteTier: { code: 'gold', rank: 2 },
            eliteProfileBadgeVisible: true,
            distanceKm: 2.3,
            location: { lat: 33.5731, lng: -7.5898, city: 'Casablanca', area: 'Maarif', serviceRadiusKm: 15 },
          },
        ],
        page: 1,
        limit: 9,
        totalItems: 1,
        totalPages: 1,
      },
    },
  })
  getTaskers(
    @Query() query: ListTaskersQueryDto,
    @RequestLocale() locale: string,
    @Req() request: DiscoveryRequest,
  ) {
    const savedLocation = resolveSavedLocation(request.user, request.guest);
    return this.taskers.list(query, locale, savedLocation);
  }

  @Get(':id/availability')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiBearerAuth('bearer')
  @UseGuards(GuestOrIdentityGuard)
  @ApiParam({ name: 'id', required: true, type: Number, description: 'Tasker user ID.' })
  @ApiOperation({
    summary: "Get one active Tasker's open availability",
    description:
      'Requires either a guest token from POST /guest/token or a normal Customer/Tasker/Admin bearer session.',
  })
  @ApiUnauthorizedResponse({ description: 'Guest token or bearer session is missing, invalid, expired, or revoked.' })
  getTaskerAvailability(@Param() params: TaskerParamDto) {
    return this.taskers.getAvailability(params.id);
  }

  @Get(':id/reviews')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiBearerAuth('bearer')
  @UseGuards(GuestOrIdentityGuard)
  @ApiParam({ name: 'id', required: true, type: Number, description: 'Tasker user ID.' })
  @ApiOperation({
    summary: 'List public reviews received by an active tasker',
    description:
      'Requires either a guest token from POST /guest/token or a normal Customer/Tasker/Admin bearer session.',
  })
  @ApiUnauthorizedResponse({ description: 'Guest token or bearer session is missing, invalid, expired, or revoked.' })
  getTaskerReviews(@Param() params: TaskerParamDto, @Query() query: PublicTaskerReviewsQueryDto) {
    return this.taskers.getPublicReviews(params.id, query);
  }

  @Get(':id')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiBearerAuth('bearer')
  @UseGuards(GuestOrIdentityGuard)
  @ApiParam({ name: 'id', required: true, type: Number, description: 'Tasker user ID.' })
  @ApiOperation({
    summary: 'Get one active Tasker profile',
    description:
      'Requires either a guest token from POST /guest/token or a normal Customer/Tasker/Admin bearer session.',
  })
  @ApiUnauthorizedResponse({ description: 'Guest token or bearer session is missing, invalid, expired, or revoked.' })
  getTaskerById(
    @Param() params: TaskerParamDto,
    @Query() query: TaskerDetailQueryDto,
    @RequestLocale() locale: string,
  ) {
    return this.taskers.getById(params.id, query.serviceSlug, locale);
  }
}
