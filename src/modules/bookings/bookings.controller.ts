import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { User } from '../../generated/prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PaymentsService } from '../payments/payments.service';
import {
  UpdateTaskerLocationDto,
  UpdateTimerNotesDto,
} from '../tasker-dashboard/dto';
import { AddComplaintEvidenceDto, FileComplaintDto } from './dto/file-complaint.dto';
import { TaskerTasksService } from '../tasker-dashboard/services/tasker-tasks.service';
import { BookingsService } from './bookings.service';
import {
  BookingParamDto,
  BookingQuoteDto,
  CancelBookingDto,
  ExtendBookingDto,
  ListUnifiedBookingsQueryDto,
  RescheduleBookingDto,
  UpdateBookingBillingDto,
} from './dto/booking-actions.dto';
import { BookTaskerDto } from './dto/book-tasker.dto';

@ApiTags('05 Bookings & Tasks')
@Controller('bookings')
export class BookingDiscoveryController {
  constructor(private readonly bookings: BookingsService) {}

  @Post('quote')
  @ApiOperation({
    summary: 'Get a live booking estimate for an available tasker slot',
    description:
      'Public/guest-safe. Uses the tasker persisted hourly rate and real availability. Tax remains uncalculated until a tax integration is configured.',
  })
  quote(@Body() dto: BookingQuoteDto) {
    return this.bookings.quote(dto);
  }
}

@ApiTags('05 Bookings & Tasks')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Customer, UserRole.Tasker)
@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly taskerTasks: TaskerTasksService,
    private readonly payments: PaymentsService,
  ) {}

  @Post()
  @Roles(UserRole.Customer)
  @ApiOperation({
    summary: 'Create a booking',
    description:
      'Reserves a real tasker availability slot. Stripe cards are saved before booking and are not charged until the completed task is finalized.',
  })
  create(@CurrentUser() user: User, @Body() dto: BookTaskerDto) {
    return this.bookings.book(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List current user bookings/tasks by booked, ongoing, or history bucket' })
  list(@CurrentUser() user: User, @Query() query: ListUnifiedBookingsQueryDto) {
    return this.bookings.list(user, query);
  }

  @Get('next')
  @ApiOperation({ summary: 'Get the next active booking for the current customer or tasker' })
  next(@CurrentUser() user: User) {
    return this.bookings.next(user);
  }

  @Get(':bookingId')
  @ApiOperation({ summary: 'Get one booking as either participant' })
  get(@CurrentUser() user: User, @Param() params: BookingParamDto) {
    return this.bookings.get(user, params.bookingId);
  }

  @Post(':bookingId/confirm')
  @Roles(UserRole.Tasker)
  @ApiOperation({ summary: 'Tasker confirms a pending booking' })
  confirm(@CurrentUser() user: User, @Param() params: BookingParamDto) {
    return this.taskerTasks.confirm(user.id, params.bookingId);
  }

  @Post(':bookingId/cancel')
  @ApiOperation({ summary: 'Cancel a booking using the current participant role' })
  cancel(
    @CurrentUser() user: User,
    @Param() params: BookingParamDto,
    @Body() dto: CancelBookingDto,
  ) {
    return user.role === UserRole.Tasker
      ? this.taskerTasks.cancel(user.id, params.bookingId, dto)
      : this.bookings.cancelCustomer(user.id, params.bookingId, dto);
  }

  @Post(':bookingId/reschedule')
  @Roles(UserRole.Customer)
  @ApiOperation({ summary: 'Customer moves a pending/confirmed booking to another real open slot' })
  reschedule(
    @CurrentUser() user: User,
    @Param() params: BookingParamDto,
    @Body() dto: RescheduleBookingDto,
  ) {
    return this.bookings.reschedule(user.id, params.bookingId, dto);
  }

  @Post(':bookingId/extend')
  @Roles(UserRole.Customer)
  @ApiOperation({
    summary: 'Customer explicitly authorizes additional task time',
    description: 'This extends the billing authorization ceiling; it does not charge immediately.',
  })
  extend(
    @CurrentUser() user: User,
    @Param() params: BookingParamDto,
    @Body() dto: ExtendBookingDto,
  ) {
    return this.bookings.extend(user.id, params.bookingId, dto);
  }

  @Patch(':bookingId/billing')
  @Roles(UserRole.Customer)
  @ApiOperation({ summary: 'Update tip/donation before final payment succeeds' })
  updateBilling(
    @CurrentUser() user: User,
    @Param() params: BookingParamDto,
    @Body() dto: UpdateBookingBillingDto,
  ) {
    return this.bookings.updateBilling(user.id, params.bookingId, dto);
  }

  @Post(':bookingId/navigation/start')
  @Roles(UserRole.Tasker)
  @ApiOperation({ summary: 'Tasker starts travel to the customer location' })
  startNavigation(@CurrentUser() user: User, @Param() params: BookingParamDto) {
    return this.taskerTasks.startNavigation(user.id, params.bookingId);
  }

  @Get(':bookingId/navigation')
  @ApiOperation({
    summary: 'Get shared live-location/navigation state',
    description: 'Customer and Tasker use the same endpoint. ETA/distance remain null until a real routing provider is integrated.',
  })
  navigation(@CurrentUser() user: User, @Param() params: BookingParamDto) {
    return this.bookings.navigation(user.id, params.bookingId);
  }

  @Put(':bookingId/location')
  @Roles(UserRole.Tasker)
  @ApiOperation({ summary: 'Tasker updates current coordinates for an active booking' })
  location(
    @CurrentUser() user: User,
    @Param() params: BookingParamDto,
    @Body() dto: UpdateTaskerLocationDto,
  ) {
    return this.taskerTasks.updateLocation(user.id, params.bookingId, dto);
  }

  @Post(':bookingId/arrival')
  @Roles(UserRole.Tasker)
  @ApiOperation({ summary: 'Tasker confirms arrival' })
  arrival(@CurrentUser() user: User, @Param() params: BookingParamDto) {
    return this.taskerTasks.arrive(user.id, params.bookingId);
  }

  @Get(':bookingId/timer')
  @ApiOperation({ summary: 'Get the shared persisted task timer state' })
  timer(@CurrentUser() user: User, @Param() params: BookingParamDto) {
    return this.bookings.timer(user.id, params.bookingId);
  }

  @Post(':bookingId/timer/start')
  @Roles(UserRole.Tasker)
  startTimer(@CurrentUser() user: User, @Param() params: BookingParamDto) {
    return this.taskerTasks.startTimer(user.id, params.bookingId);
  }

  @Post(':bookingId/timer/pause')
  @Roles(UserRole.Tasker)
  pauseTimer(@CurrentUser() user: User, @Param() params: BookingParamDto) {
    return this.taskerTasks.pauseTimer(user.id, params.bookingId);
  }

  @Post(':bookingId/timer/resume')
  @Roles(UserRole.Tasker)
  resumeTimer(@CurrentUser() user: User, @Param() params: BookingParamDto) {
    return this.taskerTasks.resumeTimer(user.id, params.bookingId);
  }

  @Post(':bookingId/timer/stop')
  @Roles(UserRole.Tasker)
  stopTimer(@CurrentUser() user: User, @Param() params: BookingParamDto) {
    return this.taskerTasks.stopTimer(user.id, params.bookingId);
  }

  @Patch(':bookingId/timer/notes')
  @Roles(UserRole.Tasker)
  notes(
    @CurrentUser() user: User,
    @Param() params: BookingParamDto,
    @Body() dto: UpdateTimerNotesDto,
  ) {
    return this.taskerTasks.updateTimerNotes(user.id, params.bookingId, dto);
  }

  @Post(':bookingId/complete')
  @ApiOperation({
    summary: 'Complete a stopped task and start real final-payment orchestration',
    description:
      'Customer and Tasker use the same endpoint. The timer must be stopped. Completion is idempotent and payment state reflects the actual Stripe/customer-wallet result.',
  })
  async complete(@CurrentUser() user: User, @Param() params: BookingParamDto) {
    if (user.role === UserRole.Tasker) {
      await this.taskerTasks.complete(user.id, params.bookingId);
    } else {
      await this.bookings.completeByCustomer(user.id, params.bookingId);
    }
    const payment = await this.payments.finalizeCompletedBooking(params.bookingId);
    const booking = await this.bookings.get(user, params.bookingId);
    return { booking, payment };
  }

  @Get(':bookingId/complaints')
  @ApiOperation({
    summary: 'List disputes and outstanding evidence requests for this booking participant',
    description:
      'Customer and Tasker use the same endpoint. It exposes the case state, evidence requests addressed to the current role, and only evidence uploaded by the current user.',
  })
  complaints(@CurrentUser() user: User, @Param() params: BookingParamDto) {
    return this.bookings.listComplaints(user, params.bookingId);
  }

  @Post(':bookingId/complaints')
  @ApiOperation({
    summary: 'Open a booking complaint/dispute as either customer or tasker',
    description: 'If final payment is not already settled, an open dispute places the booking payment on hold.',
  })
  complaint(
    @CurrentUser() user: User,
    @Param() params: BookingParamDto,
    @Body() dto: FileComplaintDto,
  ) {
    return this.bookings.fileComplaint(user.id, params.bookingId, dto);
  }

  @Post(':bookingId/complaints/:complaintId/evidence')
  @ApiOperation({
    summary: 'Submit requested dispute evidence as the Customer or Tasker participant',
    description:
      'Upload the file first through the existing Cloudinary booking-attachment upload API, then submit the returned metadata here. Relevant pending evidence requests are fulfilled transactionally.',
  })
  complaintEvidence(
    @CurrentUser() user: User,
    @Param() params: BookingParamDto,
    @Param('complaintId') complaintId: string,
    @Body() dto: AddComplaintEvidenceDto,
  ) {
    return this.bookings.addComplaintEvidence(user, params.bookingId, complaintId, dto);
  }
}
