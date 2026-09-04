import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { User } from '../../generated/prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PaymentsService } from '../payments/payments.service';
import { UpdateTaskerLocationDto, UpdateTimerNotesDto } from '../tasker-dashboard/dto';
import { TaskerTasksService } from '../tasker-dashboard/services/tasker-tasks.service';
import { BookingsService } from './bookings.service';
import { BookingWorkVerificationService } from './booking-work-verification.service';
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
import { ConfirmCashCollectionDto } from '../tasker-finance/dto/tasker-finance.dto';
import { WorkOtpDto, WorkProofDto } from './dto/work-verification.dto';

@ApiTags('06 Bookings & Tasks')
@Controller('bookings')
export class BookingDiscoveryController {
  constructor(private readonly bookings: BookingsService) {}

  @Post('quote')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Get a live booking estimate for an available tasker slot',
    description:
      'Public/guest-safe. Uses persisted Tasker rates, real availability, and the active platform commission/tax policy. No payment is created by this quote.',
  })
  quote(@Body() dto: BookingQuoteDto) {
    return this.bookings.quote(dto);
  }
}

@ApiTags('06 Bookings & Tasks')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Customer, UserRole.Tasker)
@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly taskerTasks: TaskerTasksService,
    private readonly payments: PaymentsService,
    private readonly workVerification: BookingWorkVerificationService,
  ) {}

  @Post()
  @Roles(UserRole.Customer)
  @ApiOperation({
    summary: 'Create a booking',
    description:
      'Reserves a real Tasker availability slot. Stripe cards are saved before booking and are not charged until finalization. Cash is paid directly to the Tasker, is subject to the configured platform-payable threshold, and never enters the Latache wallet.',
  })
  create(@CurrentUser() user: User, @Body() dto: BookTaskerDto) {
    return this.bookings.book(user.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List current user bookings/tasks by booked, ongoing, or history bucket',
  })
  list(@CurrentUser() user: User, @Query() query: ListUnifiedBookingsQueryDto) {
    return this.bookings.list(user, query);
  }

  @Get('next')
  @ApiOperation({ summary: 'Get the next active booking for the current customer or tasker' })
  next(@CurrentUser() user: User) {
    return this.bookings.next(user);
  }

  @Get(':bookingId')
  @ApiParam({ name: 'bookingId', required: true, type: Number, description: 'Booking ID.' })
  @ApiOperation({ summary: 'Get one booking as either participant' })
  get(@CurrentUser() user: User, @Param() params: BookingParamDto) {
    return this.bookings.get(user, params.bookingId);
  }

  @Post(':bookingId/confirm')
  @ApiParam({ name: 'bookingId', required: true, type: Number, description: 'Booking ID.' })
  @Roles(UserRole.Tasker)
  @ApiOperation({ summary: 'Tasker confirms a pending booking' })
  confirm(@CurrentUser() user: User, @Param() params: BookingParamDto) {
    return this.taskerTasks.confirm(user.id, params.bookingId);
  }

  @Post(':bookingId/cancel')
  @ApiParam({ name: 'bookingId', required: true, type: Number, description: 'Booking ID.' })
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
  @ApiParam({ name: 'bookingId', required: true, type: Number, description: 'Booking ID.' })
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
  @ApiParam({ name: 'bookingId', required: true, type: Number, description: 'Booking ID.' })
  @Roles(UserRole.Customer, UserRole.Tasker)
  @ApiOperation({
    summary: 'Customer or Tasker extends authorized task time',
    description: 'This extends the billing authorization ceiling; it does not charge immediately.',
  })
  extend(
    @CurrentUser() user: User,
    @Param() params: BookingParamDto,
    @Body() dto: ExtendBookingDto,
  ) {
    return this.bookings.extend(user, params.bookingId, dto);
  }

  @Patch(':bookingId/billing')
  @ApiParam({ name: 'bookingId', required: true, type: Number, description: 'Booking ID.' })
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
  @ApiParam({ name: 'bookingId', required: true, type: Number, description: 'Booking ID.' })
  @Roles(UserRole.Tasker)
  @ApiOperation({ summary: 'Tasker starts travel to the customer location' })
  startNavigation(@CurrentUser() user: User, @Param() params: BookingParamDto) {
    return this.taskerTasks.startNavigation(user.id, params.bookingId);
  }

  @Get(':bookingId/navigation')
  @ApiParam({ name: 'bookingId', required: true, type: Number, description: 'Booking ID.' })
  @ApiOperation({
    summary: 'Get shared live-location/navigation state',
    description:
      'Customer and Tasker use the same endpoint. ETA/distance remain null until a real routing provider is integrated.',
  })
  navigation(@CurrentUser() user: User, @Param() params: BookingParamDto) {
    return this.bookings.navigation(user, params.bookingId);
  }

  @Put(':bookingId/location')
  @ApiParam({ name: 'bookingId', required: true, type: Number, description: 'Booking ID.' })
  @Roles(UserRole.Tasker)
  @ApiOperation({
    summary: 'Tasker updates current coordinates for an active booking',
    description:
      'Business-important latest location remains persisted and emitted through the transactional outbox. When Redis is healthy, writes above REALTIME_LOCATION_MIN_WRITE_INTERVAL_MS are coalesced across API replicas; Redis failure falls back to normal PostgreSQL persistence.',
  })
  location(
    @CurrentUser() user: User,
    @Param() params: BookingParamDto,
    @Body() dto: UpdateTaskerLocationDto,
  ) {
    return this.taskerTasks.updateLocation(user.id, params.bookingId, dto);
  }

  @Post(':bookingId/arrival')
  @ApiParam({ name: 'bookingId', required: true, type: Number, description: 'Booking ID.' })
  @Roles(UserRole.Tasker)
  @ApiOperation({ summary: 'Tasker confirms arrival' })
  arrival(@CurrentUser() user: User, @Param() params: BookingParamDto) {
    return this.taskerTasks.arrive(user.id, params.bookingId);
  }

  @Get(':bookingId/work-verification')
  @ApiParam({ name: 'bookingId', required: true, type: Number, description: 'Booking ID.' })
  @ApiOperation({ summary: 'Get verified on-site work proof and OTP state for a booking' })
  workVerificationState(@CurrentUser() user: User, @Param() params: BookingParamDto) {
    return this.workVerification.state(user, params.bookingId);
  }

  @Post(':bookingId/work/proofs/front-door')
  @ApiParam({ name: 'bookingId', required: true, type: Number, description: 'Booking ID.' })
  @Roles(UserRole.Tasker)
  @ApiOperation({ summary: 'Tasker attaches immutable front-door proof after arrival' })
  frontDoorProof(
    @CurrentUser() user: User,
    @Param() params: BookingParamDto,
    @Body() dto: WorkProofDto,
  ) {
    return this.workVerification.attachFrontDoor(user, params.bookingId, dto);
  }

  @Post(':bookingId/work/start-code')
  @ApiParam({ name: 'bookingId', required: true, type: Number, description: 'Booking ID.' })
  @Roles(UserRole.Customer)
  @ApiOperation({ summary: 'Customer generates the six-digit work-start OTP' })
  startCode(@CurrentUser() user: User, @Param() params: BookingParamDto) {
    return this.workVerification.issueStartCode(user.id, params.bookingId);
  }

  @Post(':bookingId/work/start')
  @ApiParam({ name: 'bookingId', required: true, type: Number, description: 'Booking ID.' })
  @Roles(UserRole.Tasker)
  @ApiOperation({ summary: 'Tasker verifies Customer OTP and starts the billable timer' })
  startVerifiedWork(
    @CurrentUser() user: User,
    @Param() params: BookingParamDto,
    @Body() dto: WorkOtpDto,
  ) {
    return this.workVerification.startWork(user.id, params.bookingId, dto);
  }

  @Post(':bookingId/work/proofs/completion')
  @ApiParam({ name: 'bookingId', required: true, type: Number, description: 'Booking ID.' })
  @Roles(UserRole.Tasker)
  @ApiOperation({ summary: 'Tasker attaches immutable completed-work proof and freezes the timer' })
  completionProof(
    @CurrentUser() user: User,
    @Param() params: BookingParamDto,
    @Body() dto: WorkProofDto,
  ) {
    return this.workVerification.attachCompletion(user, params.bookingId, dto);
  }

  @Post(':bookingId/work/completion-code')
  @ApiParam({ name: 'bookingId', required: true, type: Number, description: 'Booking ID.' })
  @Roles(UserRole.Customer)
  @ApiOperation({ summary: 'Customer generates the six-digit completion OTP after checking proof' })
  completionCode(@CurrentUser() user: User, @Param() params: BookingParamDto) {
    return this.workVerification.issueCompletionCode(user.id, params.bookingId);
  }

  @Post(':bookingId/work/finish')
  @ApiParam({ name: 'bookingId', required: true, type: Number, description: 'Booking ID.' })
  @Roles(UserRole.Tasker)
  @ApiOperation({ summary: 'Tasker verifies completion OTP, completes booking, and unlocks final payment' })
  async finishVerifiedWork(
    @CurrentUser() user: User,
    @Param() params: BookingParamDto,
    @Body() dto: WorkOtpDto,
  ) {
    await this.workVerification.finishWork(user.id, params.bookingId, dto);
    const payment = await this.payments.finalizeCompletedBooking(params.bookingId);
    const booking = await this.bookings.get(user, params.bookingId);
    return { booking, payment };
  }

  @Get(':bookingId/timer')
  @ApiParam({ name: 'bookingId', required: true, type: Number, description: 'Booking ID.' })
  @ApiOperation({ summary: 'Get the shared persisted task timer state' })
  timer(@CurrentUser() user: User, @Param() params: BookingParamDto) {
    return this.bookings.timer(user, params.bookingId);
  }

  @Post(':bookingId/timer/start')
  @ApiParam({ name: 'bookingId', required: true, type: Number, description: 'Booking ID.' })
  @Roles(UserRole.Tasker)
  startTimer(@CurrentUser() user: User, @Param() params: BookingParamDto) {
    return this.taskerTasks.startTimer(user.id, params.bookingId);
  }

  @Post(':bookingId/timer/pause')
  @ApiParam({ name: 'bookingId', required: true, type: Number, description: 'Booking ID.' })
  @Roles(UserRole.Tasker)
  pauseTimer(@CurrentUser() user: User, @Param() params: BookingParamDto) {
    return this.taskerTasks.pauseTimer(user.id, params.bookingId);
  }

  @Post(':bookingId/timer/resume')
  @ApiParam({ name: 'bookingId', required: true, type: Number, description: 'Booking ID.' })
  @Roles(UserRole.Tasker)
  resumeTimer(@CurrentUser() user: User, @Param() params: BookingParamDto) {
    return this.taskerTasks.resumeTimer(user.id, params.bookingId);
  }

  @Post(':bookingId/timer/stop')
  @ApiParam({ name: 'bookingId', required: true, type: Number, description: 'Booking ID.' })
  @Roles(UserRole.Tasker)
  stopTimer(@CurrentUser() user: User, @Param() params: BookingParamDto) {
    return this.taskerTasks.stopTimer(user.id, params.bookingId);
  }

  @Patch(':bookingId/timer/notes')
  @ApiParam({ name: 'bookingId', required: true, type: Number, description: 'Booking ID.' })
  @Roles(UserRole.Tasker)
  notes(
    @CurrentUser() user: User,
    @Param() params: BookingParamDto,
    @Body() dto: UpdateTimerNotesDto,
  ) {
    return this.taskerTasks.updateTimerNotes(user.id, params.bookingId, dto);
  }

  @Post(':bookingId/complete')
  @ApiParam({ name: 'bookingId', required: true, type: Number, description: 'Booking ID.' })
  @ApiOperation({
    summary: 'Submit or approve completion of a stopped task',
    description:
      'Tasker submission enters awaiting_customer_approval and does not charge the customer. Customer approval completes the booking and starts genuine final-payment orchestration. If no active dispute is opened, a database-locked worker auto-approves after the configured review window. Online settlement creates a pending Tasker earning; cash requires physical collection confirmation and never creates fake wallet funds.',
  })
  async complete(@CurrentUser() user: User, @Param() params: BookingParamDto) {
    if (user.role === UserRole.Tasker) {
      await this.taskerTasks.complete(user.id, params.bookingId);
      const booking = await this.bookings.get(user, params.bookingId);
      return {
        booking,
        payment: {
          bookingId: params.bookingId,
          status:
            booking.status === 'awaiting_customer_approval'
              ? 'awaiting_customer_approval'
              : booking.payment.status,
          approvalDueAt: booking.timing.completionApprovalDueAt,
        },
      };
    } else {
      await this.bookings.completeByCustomer(user.id, params.bookingId);
    }
    const payment = await this.payments.finalizeCompletedBooking(params.bookingId);
    const booking = await this.bookings.get(user, params.bookingId);
    return { booking, payment };
  }

  @Post(':bookingId/cash-payment/confirm')
  @ApiParam({ name: 'bookingId', required: true, type: Number, description: 'Booking ID.' })
  @Roles(UserRole.Tasker)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    example: 'cash-booking-481-confirm-v1',
    description:
      'Stable client key. A duplicate request returns the same receivable and cannot duplicate platform debt.',
  })
  @ApiOperation({
    summary: 'Tasker confirms physical cash collection for a completed cash booking',
    description:
      'Records cash as physically held by the Tasker, creates an auditable platform payable for non-Tasker components, and never credits fake wallet funds. The amount must match the final immutable booking calculation.',
  })
  confirmCashPayment(
    @CurrentUser() user: User,
    @Param() params: BookingParamDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: ConfirmCashCollectionDto,
  ) {
    return this.payments.confirmCashCollection({
      taskerId: user.id,
      bookingId: params.bookingId,
      collectedAmount: dto.collectedAmount,
      idempotencyKey: idempotencyKey ?? '',
    });
  }
}
