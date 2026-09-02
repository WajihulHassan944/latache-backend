import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { User } from '../../generated/prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  BookingPaymentParamDto,
  CreateWalletTopupDto,
  ListPaymentTransactionsQueryDto,
  PaymentMethodParamDto,
  RetryBookingPaymentDto,
} from './payments.dto';
import { PaymentsService } from './payments.service';
import type {
  BookingPaymentStatusView,
  PaymentTransactionListView,
  SavedPaymentMethodView,
  SetupIntentView,
  WalletTopupIntentView,
  WalletView,
} from './payments.types';

@ApiTags('06 Payments')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Customer)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('setup-intent')
  @ApiOperation({
    summary: 'Create a Stripe SetupIntent for a saved card',
    description:
      'Saves a card for future booking charges without charging it now. The frontend confirms the SetupIntent with Stripe.js/SDK.',
  })
  createSetupIntent(@CurrentUser() user: User): Promise<SetupIntentView> {
    return this.payments.createSetupIntent(user.id);
  }

  @Get('methods')
  @ApiOperation({ summary: 'List saved Stripe card payment methods' })
  methods(@CurrentUser() user: User): Promise<SavedPaymentMethodView[]> {
    return this.payments.listPaymentMethods(user.id);
  }

  @Patch('methods/:id/default')
  @ApiParam({ name: 'id', required: true, type: String, description: 'Saved payment method ID.', example: 'pm_123' })
  @ApiOperation({ summary: 'Set the customer default card' })
  defaultMethod(
    @CurrentUser() user: User,
    @Param() params: PaymentMethodParamDto,
  ): Promise<SavedPaymentMethodView> {
    return this.payments.setDefaultPaymentMethod(user.id, params.id);
  }

  @Delete('methods/:id')
  @ApiParam({ name: 'id', required: true, type: String, description: 'Saved payment method ID.', example: 'pm_123' })
  @ApiOperation({ summary: 'Detach a saved card that is not used by an active booking' })
  deleteMethod(
    @CurrentUser() user: User,
    @Param() params: PaymentMethodParamDto,
  ): Promise<{ deleted: true; id: string }> {
    return this.payments.detachPaymentMethod(user.id, params.id);
  }

  @Get('wallet')
  @ApiOperation({
    summary: 'Get the real customer wallet balance and payment aggregates',
    description:
      'A new wallet legitimately returns a zero balance. No synthetic transactions are created.',
  })
  wallet(@CurrentUser() user: User): Promise<WalletView> {
    return this.payments.wallet(user.id);
  }

  @Get('wallet/transactions')
  @ApiOperation({ summary: 'List real customer wallet ledger entries' })
  walletTransactions(@CurrentUser() user: User, @Query() query: ListPaymentTransactionsQueryDto) {
    return this.payments.walletLedger(user.id, query.page, query.limit);
  }

  @Post('wallet/topups')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Unique key per top-up attempt. Reusing it with different parameters is rejected.',
    example: 'wallet-topup-20260807-01',
  })
  @ApiOperation({
    summary: 'Create a Stripe PaymentIntent to top up the customer wallet',
    description:
      'The wallet is credited only after a verified payment_intent.succeeded webhook. Creating this intent does not increase balance.',
  })
  topup(
    @CurrentUser() user: User,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateWalletTopupDto,
  ): Promise<WalletTopupIntentView> {
    return this.payments.createWalletTopup(user.id, dto.amount, idempotencyKey ?? '');
  }

  @Get('transactions')
  @ApiOperation({ summary: 'List customer Stripe/wallet payment transaction records' })
  transactions(
    @CurrentUser() user: User,
    @Query() query: ListPaymentTransactionsQueryDto,
  ): Promise<PaymentTransactionListView> {
    return this.payments.listTransactions(user.id, query);
  }

  @Get('bookings/:bookingId')
  @ApiParam({ name: 'bookingId', required: true, type: Number, description: 'Booking ID.' })
  @ApiOperation({ summary: 'Get final-payment state for one customer booking' })
  bookingPayment(
    @CurrentUser() user: User,
    @Param() params: BookingPaymentParamDto,
  ): Promise<BookingPaymentStatusView> {
    return this.payments.bookingStatus(user.id, params.bookingId);
  }

  @Post('bookings/:bookingId/retry')
  @ApiParam({ name: 'bookingId', required: true, type: Number, description: 'Booking ID.' })
  @ApiOperation({
    summary: 'Retry or continue a failed/requires-action final booking payment',
    description:
      'Can switch to another already-saved Stripe PaymentMethod. The booking must already be completed.',
  })
  retry(
    @CurrentUser() user: User,
    @Param() params: BookingPaymentParamDto,
    @Body() dto: RetryBookingPaymentDto,
  ) {
    return this.payments.retryBookingPayment(user.id, params.bookingId, dto);
  }
}
