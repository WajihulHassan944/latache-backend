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
  CreateWalletWithdrawalDto,
  ListPaymentTransactionsQueryDto,
  PaymentMethodParamDto,
  RetryBookingPaymentDto,
} from './payments.dto';
import { PaymentsService, type CardHolderRole } from './payments.service';
import type {
  BookingPaymentStatusView,
  CustomerWithdrawalView,
  PaymentTransactionListView,
  SavedPaymentMethodView,
  SetupIntentView,
  WalletTopupIntentView,
  WalletView,
} from './payments.types';

@ApiTags('07 Payments')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Customer)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  // Card routes are shared with Taskers (plan checkout "Card on File"); every other
  // /payments route stays customer-only via the controller-level @Roles.
  @Post('setup-intent')
  @Roles(UserRole.Customer, UserRole.Tasker)
  @ApiOperation({
    summary: 'Create a Stripe SetupIntent for a saved card (Customer or Tasker)',
    description:
      'Saves a card for future charges (customer bookings, Tasker plan checkout) without charging it now. ' +
      'The frontend confirms the SetupIntent with Stripe.js/SDK.',
  })
  createSetupIntent(@CurrentUser() user: User): Promise<SetupIntentView> {
    return this.payments.createSetupIntent(user.id, this.cardHolderRole(user));
  }

  @Get('methods')
  @Roles(UserRole.Customer, UserRole.Tasker)
  @ApiOperation({ summary: 'List saved Stripe card payment methods (Customer or Tasker)' })
  methods(@CurrentUser() user: User): Promise<SavedPaymentMethodView[]> {
    return this.payments.listPaymentMethods(user.id, this.cardHolderRole(user));
  }

  @Patch('methods/:id/default')
  @Roles(UserRole.Customer, UserRole.Tasker)
  @ApiParam({ name: 'id', required: true, type: String, description: 'Saved payment method ID.', example: 'pm_123' })
  @ApiOperation({ summary: 'Set the default saved card (Customer or Tasker)' })
  defaultMethod(
    @CurrentUser() user: User,
    @Param() params: PaymentMethodParamDto,
  ): Promise<SavedPaymentMethodView> {
    return this.payments.setDefaultPaymentMethod(user.id, params.id, this.cardHolderRole(user));
  }

  /** request.user.role is the role selected by the session's access token. */
  private cardHolderRole(user: User): CardHolderRole {
    return user.role === UserRole.Tasker ? 'tasker' : 'customer';
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
    return this.payments.createWalletTopup(
      user.id,
      dto.amount,
      idempotencyKey ?? '',
      dto.stripePaymentMethodId,
    );
  }

  @Post('wallet/withdrawals')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Unique key per withdrawal attempt. Reusing it with different parameters is rejected.',
    example: 'wallet-withdrawal-20260907-01',
  })
  @ApiOperation({
    summary: 'Request a wallet withdrawal',
    description:
      'Reserves the requested amount out of the available wallet balance for an auditable pending-review withdrawal. This backend has no configured customer payout destination/provider yet, so the request is rejected with 503 WALLET_WITHDRAWAL_EXECUTION_NOT_CONFIGURED (no funds reserved) unless that has been explicitly configured.',
  })
  requestWithdrawal(
    @CurrentUser() user: User,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateWalletWithdrawalDto,
  ): Promise<CustomerWithdrawalView> {
    return this.payments.requestWalletWithdrawal(user.id, dto.amount, idempotencyKey ?? '');
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
