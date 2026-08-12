import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
  ParticipantDisputeParamDto,
} from './dto/participant-disputes.dto';

@ApiTags('05 Bookings & Tasks')
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
  @ApiOperation({ summary: 'Get one dispute visible to the authenticated booking participant' })
  detail(@CurrentUser() user: User, @Param() params: ParticipantDisputeParamDto) {
    return this.bookings.getUserDispute(user, params.disputeId);
  }

  @Post('bookings/:bookingId/disputes')
  @ApiOperation({
    summary: 'Open a booking dispute as Customer or Tasker',
    description:
      'Creates one real dispute record and places unsettled payment on hold. Admin investigation continues through /api/admin/disputes.',
  })
  create(
    @CurrentUser() user: User,
    @Param() params: BookingParamDto,
    @Body() dto: FileComplaintDto,
  ) {
    return this.bookings.fileComplaint(user.id, params.bookingId, dto);
  }

  @Post('disputes/:disputeId/evidence')
  @ApiOperation({
    summary: 'Submit requested evidence to an owned dispute',
    description:
      'Cloudinary metadata must belong to the authenticated account. Pending evidence requests are fulfilled transactionally.',
  })
  evidence(
    @CurrentUser() user: User,
    @Param() params: ParticipantDisputeParamDto,
    @Body() dto: AddComplaintEvidenceDto,
  ) {
    return this.bookings.addUserDisputeEvidence(user, params.disputeId, dto);
  }
}
