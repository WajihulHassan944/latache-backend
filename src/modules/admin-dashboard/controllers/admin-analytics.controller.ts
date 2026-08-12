import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { AdminAuthGuard } from '../../auth/guards/admin-auth.guard';
import { AdminActivityQueryDto, AdminDateRangeQueryDto } from '../dto';
import { AdminAnalyticsService } from '../services/admin-analytics.service';
import { AdminAnalyticsCacheInterceptor } from '../admin-analytics-cache.interceptor';

@ApiTags('20 Admin Dashboard - Analytics')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'A valid active administrator session is required.' })
@ApiForbiddenResponse({ description: 'The administrator lacks one or more required permissions.' })
@UseGuards(AdminAuthGuard, PermissionsGuard)
@UseInterceptors(AdminAnalyticsCacheInterceptor)
@Controller('admin/dashboard')
export class AdminAnalyticsController {
  constructor(private readonly analytics: AdminAnalyticsService) {}

  @Get('overview')
  @Permissions('analytics.read')
  @ApiOperation({
    summary: 'Platform overview for the administrator dashboard',
    description:
      'Returns real platform counts, booking distribution, recent bookings and settled revenue trend. Aggregate responses may be served from the private Redis cache for up to CACHE_ADMIN_ANALYTICS_TTL_SECONDS; X-Latache-Cache reports hit/miss/bypass. Super admin bypasses permission checks; delegated admins need analytics.read.',
  })
  @ApiOkResponse({ description: 'Platform overview generated from current database state.' })
  overview(@Query() query: AdminDateRangeQueryDto) {
    return this.analytics.overview(query);
  }

  @Get('revenue')
  @Permissions('finance.read')
  @ApiOperation({
    summary: 'Revenue analytics',
    description:
      'Uses only paid bookings. Gross revenue, platform fees, Tasker earnings, tips and donations are derived from settled booking payment fields; no synthetic revenue is generated. This analytical response may be up to the configured short cache TTL old; operational payment APIs remain uncached.',
  })
  revenue(@Query() query: AdminDateRangeQueryDto) {
    return this.analytics.revenue(query);
  }

  @Get('users')
  @Permissions('analytics.read')
  @ApiOperation({ summary: 'Customer/user analytics and growth' })
  users(@Query() query: AdminDateRangeQueryDto) {
    return this.analytics.users(query);
  }

  @Get('taskers')
  @Permissions('analytics.read')
  @ApiOperation({ summary: 'Tasker population, growth and completion analytics' })
  taskers(@Query() query: AdminDateRangeQueryDto) {
    return this.analytics.taskers(query);
  }

  @Get('bookings')
  @Permissions('analytics.read')
  @ApiOperation({ summary: 'Booking status and service analytics' })
  bookings(@Query() query: AdminDateRangeQueryDto) {
    return this.analytics.bookings(query);
  }

  @Get('activity')
  @Permissions('analytics.read')
  @ApiOperation({
    summary: 'Real live-activity feed',
    description:
      'Combines persisted user registrations, booking changes, payment/withdrawal records and administrative audit events. It does not fabricate activity entries.',
  })
  activity(@Query() query: AdminActivityQueryDto) {
    return this.analytics.activity(query);
  }
}
