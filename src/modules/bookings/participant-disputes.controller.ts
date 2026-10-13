import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { User } from '../../generated/prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BookingsService } from './bookings.service';
import { BookingParamDto } from './dto/booking-actions.dto';
import { AddComplaintEvidenceDto, FileComplaintDto } from './dto/file-complaint.dto';
import {
  ListParticipantDisputesQueryDto,
  ParticipantDisputeActionDto,
  ParticipantDisputeParamDto,
  SubmitDisputeSatisfactionDto,
} from './dto/participant-disputes.dto';

@ApiTags('06 Bookings & Tasks')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Customer, UserRole.Tasker)
@Controller()
export class ParticipantDisputesController {
  constructor(private readonly bookings: BookingsService) {}

  @Get('disputes')
  @ApiOperation({
    summary: 'List disputes for the authenticated Customer or Tasker',
    description:
      'Canonical participant dispute inbox. Filter by bookingId/status instead of maintaining a second complaints API surface.',
  })
  list(@CurrentUser() user: User, @Query() query: ListParticipantDisputesQueryDto) {
    return this.bookings.listUserDisputes(user, query);
  }

  @Get('disputes/:disputeId')
  @ApiParam({ name: 'disputeId', required: true, type: String, description: 'Dispute ID.' })
  @ApiOperation({ summary: 'Get one dispute visible to the authenticated booking participant' })
  detail(@CurrentUser() user: User, @Param() params: ParticipantDisputeParamDto) {
    return this.bookings.getUserDispute(user, params.disputeId);
  }

  @Post('bookings/:bookingId/disputes')
  @ApiParam({ name: 'bookingId', required: true, type: Number, description: 'Booking ID.' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Recommended 8-120 character client retry key. Reusing it for the same request returns the existing dispute; reuse for another booking is rejected.',
  })
  @ApiOperation({
    summary: 'Open a booking dispute as Customer or Tasker',
    description:
      'Creates at most one active dispute per booking inside the configured post-completion filing window. The booking row is locked before case creation, Idempotency-Key retries are replay-safe, and financial clearance is held without fabricating payment state. Admin investigation continues through /api/admin/disputes. ' +
      'The "customer_no_show" category is Tasker-only and skips the post-completion filing window entirely: it is only accepted while the booking is still "arrived" (Tasker on-site, work not started), and ends the booking in the same request (booking.status becomes "cancelled", cancelledByRole "tasker", cancellationReason set to the dispute description, and the Tasker\'s availability slot is released) while the payment stays held (on_hold_dispute) for admin to resolve - it is not auto-refunded.',
  })
  @ApiForbiddenResponse({
    description: 'NO_SHOW_TASKER_ONLY if a Customer submits the customer_no_show category.',
  })
  @ApiConflictResponse({
    description:
      'DISPUTE_BOOKING_CANCELLED, DISPUTE_NOT_YET_FILEABLE, DISPUTE_FILING_WINDOW_CLOSED, ACTIVE_DISPUTE_EXISTS, DISPUTE_IDEMPOTENCY_KEY_REUSED, or NO_SHOW_NOT_ELIGIBLE when customer_no_show is submitted for a booking that is not currently "arrived".',
  })
  create(
    @CurrentUser() user: User,
    @Param() params: BookingParamDto,
    @Body() dto: FileComplaintDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.bookings.fileComplaint(user, params.bookingId, dto, idempotencyKey);
  }

  @Post('disputes/:disputeId/evidence')
  @ApiParam({ name: 'disputeId', required: true, type: String, description: 'Dispute ID.' })
  @ApiOperation({
    summary: 'Submit requested evidence to an owned dispute',
    description:
      'Every attachment must resolve to the exact authenticated account-owned Latache Cloudinary resource (publicId and secure URL are provider-verified). Case-wide evidence item/byte limits are enforced and pending/overdue requests are fulfilled transactionally.',
  })
  evidence(
    @CurrentUser() user: User,
    @Param() params: ParticipantDisputeParamDto,
    @Body() dto: AddComplaintEvidenceDto,
  ) {
    return this.bookings.addUserDisputeEvidence(user, params.disputeId, dto);
  }
  @Post('disputes/:disputeId/actions')
  @ApiParam({ name: 'disputeId', required: true, type: String, description: 'Dispute ID.' })
  @ApiOperation({
    summary: 'Withdraw, respond to a settlement, appeal, or comment on an owned dispute',
    description:
      'Participant actions are persisted as immutable dispute history. Appeals and withdrawals re-apply/release financial holds transactionally where applicable.',
  })
  participantAction(
    @CurrentUser() user: User,
    @Param() params: ParticipantDisputeParamDto,
    @Body() dto: ParticipantDisputeActionDto,
  ) {
    return this.bookings.participantDisputeAction(user, params.disputeId, dto);
  }

  @Post('disputes/:disputeId/satisfaction')
  @ApiParam({ name: 'disputeId', required: true, type: String, description: 'Dispute ID.' })
  @ApiOperation({ summary: 'Submit or update a 1-5 satisfaction rating after dispute closure' })
  satisfaction(
    @CurrentUser() user: User,
    @Param() params: ParticipantDisputeParamDto,
    @Body() dto: SubmitDisputeSatisfactionDto,
  ) {
    return this.bookings.submitDisputeSatisfaction(user, params.disputeId, dto);
  }

}
