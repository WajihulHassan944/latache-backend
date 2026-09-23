import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { User } from '../../generated/prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CustomTimeRequestsService } from './custom-time-requests.service';
import {
  CreateCustomTimeRequestDto,
  CustomTimeRequestParamDto,
  CustomTimeRequestTaskerParamDto,
  ListCustomTimeRequestsQueryDto,
  RespondCustomTimeRequestDto,
} from './dto/custom-time-request.dto';

@ApiTags('06 Bookings & Tasks')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Customer, UserRole.Tasker)
@Controller()
export class CustomTimeRequestsController {
  constructor(private readonly requests: CustomTimeRequestsService) {}

  @Post('taskers/:taskerId/custom-time-request')
  @Roles(UserRole.Customer)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiParam({ name: 'taskerId', required: true, type: Number })
  @ApiOperation({
    summary: 'Ask a Tasker for a date/time outside their listed availability',
    description:
      'Creates a pending request the Tasker must accept or reject before expiresAt. One pending request per customer/tasker pair. On acceptance, book via POST /bookings/quote and POST /bookings with customTimeRequestId before the new expiresAt.',
  })
  create(
    @CurrentUser() user: User,
    @Param() params: CustomTimeRequestTaskerParamDto,
    @Body() dto: CreateCustomTimeRequestDto,
  ) {
    return this.requests.create(user.id, params.taskerId, dto);
  }

  @Get('custom-time-requests')
  @ApiOperation({
    summary: "List the caller's custom time requests",
    description:
      'As a Tasker: requests sent to you (use status=pending for the inbox). As a Customer: requests you sent. Newest first.',
  })
  list(@CurrentUser() user: User, @Query() query: ListCustomTimeRequestsQueryDto) {
    return this.requests.list(user, query);
  }

  @Post('custom-time-requests/:requestId/cancel')
  @Roles(UserRole.Customer)
  @ApiParam({ name: 'requestId', required: true, type: String })
  @ApiOperation({
    summary: 'Customer withdraws a pending or accepted custom time request',
    description: 'Frees the one-pending-request-per-Tasker limit so a new request can be sent.',
  })
  cancel(@CurrentUser() user: User, @Param() params: CustomTimeRequestParamDto) {
    return this.requests.cancel(user.id, params.requestId);
  }

  @Post('custom-time-requests/:requestId/respond')
  @Roles(UserRole.Tasker)
  @ApiParam({ name: 'requestId', required: true, type: String })
  @ApiOperation({ summary: 'Tasker accepts or rejects a pending custom time request' })
  respond(
    @CurrentUser() user: User,
    @Param() params: CustomTimeRequestParamDto,
    @Body() dto: RespondCustomTimeRequestDto,
  ) {
    return this.requests.respond(user.id, params.requestId, dto.accept);
  }

  @Get('custom-time-requests/:requestId')
  @ApiParam({ name: 'requestId', required: true, type: String })
  @ApiOperation({ summary: 'Get a custom time request as either participant' })
  get(@CurrentUser() user: User, @Param() params: CustomTimeRequestParamDto) {
    return this.requests.get(user, params.requestId);
  }
}
