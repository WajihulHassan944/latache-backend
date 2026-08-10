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
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { RolesGuard } from '../../../common/guards/roles.guard';
import type { User } from '../../../generated/prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type {
  PayoutCapabilityView,
  PayoutMethodView,
  PayoutSecurityView,
  WalletSummaryView,
  WalletTransactionsListView,
  WithdrawalView,
} from '../tasker-dashboard.contracts';
import {
  ChangePayoutPinDto,
  ConfigurePayoutPinDto,
  CreatePayoutMethodDto,
  ListWalletTransactionsQueryDto,
  RequestWithdrawalDto,
  StringIdParamDto,
} from '../dto';
import { TaskerWalletService } from '../services/tasker-wallet.service';

@ApiTags('12 Tasker Wallet & Payouts')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Tasker)
@Controller('tasker-dashboard/wallet')
export class TaskerWalletController {
  constructor(private readonly wallet: TaskerWalletService) {}

  @Get()
  @ApiOperation({
    summary: 'Get real tasker wallet totals',
    description:
      'The wallet is ledger-backed and starts at zero. Task completion never creates fake earnings. Only verified settlement code can credit earnings.',
  })
  summary(@CurrentUser() user: User): Promise<WalletSummaryView> {
    return this.wallet.summary(user.id);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'List persisted wallet ledger transactions' })
  transactions(
    @CurrentUser() user: User,
    @Query() query: ListWalletTransactionsQueryDto,
  ): Promise<WalletTransactionsListView> {
    return this.wallet.listTransactions(user.id, query);
  }

  @Get('payout-capabilities')
  @ApiOperation({
    summary: 'Get payout-method capabilities for the current deployment',
    description:
      'Clearly distinguishes method setup from withdrawal execution. Google Pay is not represented as a payout rail. Disabled execution returns disabled capability rather than pretending a payout can succeed.',
  })
  capabilities(): PayoutCapabilityView[] {
    return this.wallet.payoutCapabilities();
  }

  @Get('payout-security')
  @ApiOperation({ summary: 'Get payout PIN setup/lock state' })
  payoutSecurity(@CurrentUser() user: User): Promise<PayoutSecurityView> {
    return this.wallet.payoutSecurity(user.id);
  }

  @Post('payout-pin')
  @ApiOperation({
    summary: 'Configure the six-digit payout PIN',
    description:
      'Initial setup requires the current Latache account password. The PIN is bcrypt-hashed and never returned or logged.',
  })
  configurePayoutPin(
    @CurrentUser() user: User,
    @Body() dto: ConfigurePayoutPinDto,
  ): Promise<PayoutSecurityView> {
    return this.wallet.configurePayoutPin(user.id, dto);
  }

  @Patch('payout-pin')
  @ApiOperation({
    summary: 'Change the payout PIN',
    description:
      'Requires the existing payout PIN. Five consecutive failures temporarily lock payout-PIN verification for 15 minutes.',
  })
  changePayoutPin(
    @CurrentUser() user: User,
    @Body() dto: ChangePayoutPinDto,
  ): Promise<PayoutSecurityView> {
    return this.wallet.changePayoutPin(user.id, dto);
  }

  @Get('payout-methods')
  @ApiOperation({ summary: 'List active masked payout methods' })
  payoutMethods(@CurrentUser() user: User): Promise<PayoutMethodView[]> {
    return this.wallet.listPayoutMethods(user.id);
  }

  @Post('payout-methods')
  @ApiOperation({
    summary: 'Store an encrypted payout method',
    description:
      'Requires PAYOUT_DATA_ENCRYPTION_KEY. Raw bank/mobile-wallet/PayPal identifiers are AES-256-GCM encrypted and never returned by the API.',
  })
  @ApiServiceUnavailableResponse({ description: 'Encrypted payout storage is not configured.' })
  @ApiBadRequestResponse({ description: 'Method-specific fields are invalid or unsupported.' })
  createPayoutMethod(
    @CurrentUser() user: User,
    @Body() dto: CreatePayoutMethodDto,
  ): Promise<PayoutMethodView> {
    return this.wallet.createPayoutMethod(user.id, dto);
  }

  @Patch('payout-methods/:id/default')
  @ApiOperation({ summary: 'Set one payout method as the tasker default' })
  setDefault(
    @CurrentUser() user: User,
    @Param() params: StringIdParamDto,
  ): Promise<PayoutMethodView> {
    return this.wallet.setDefaultPayoutMethod(user.id, params.id);
  }

  @Delete('payout-methods/:id')
  @ApiOperation({ summary: 'Soft-delete a payout method when no active withdrawal references it' })
  @ApiConflictResponse({ description: 'An active withdrawal still references this method.' })
  deletePayoutMethod(
    @CurrentUser() user: User,
    @Param() params: StringIdParamDto,
  ): Promise<{ deleted: true; id: string }> {
    return this.wallet.deletePayoutMethod(user.id, params.id);
  }

  @Get('withdrawals')
  @ApiOperation({ summary: 'List actual withdrawal requests' })
  withdrawals(@CurrentUser() user: User): Promise<WithdrawalView[]> {
    return this.wallet.listWithdrawals(user.id);
  }

  @Post('withdrawals')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Unique client-generated key used to prevent duplicate withdrawal reservations.',
    example: 'withdrawal-20260807-5c671d72',
  })
  @ApiOperation({
    summary: 'Request a withdrawal',
    description:
      'In disabled mode this returns 503 and does not reserve funds. In manual mode it atomically reserves real available funds and creates pending_review; it never returns a fake paid/success state.',
  })
  @ApiServiceUnavailableResponse({ description: 'Withdrawal execution is disabled for this deployment.' })
  @ApiConflictResponse({ description: 'Insufficient balance or payout method is unavailable.' })
  requestWithdrawal(
    @CurrentUser() user: User,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: RequestWithdrawalDto,
  ): Promise<WithdrawalView> {
    return this.wallet.requestWithdrawal(user.id, dto, idempotencyKey ?? '');
  }

  @Get('withdrawals/:id')
  @ApiOperation({ summary: 'Get one withdrawal request owned by the tasker' })
  withdrawal(
    @CurrentUser() user: User,
    @Param() params: StringIdParamDto,
  ): Promise<WithdrawalView> {
    return this.wallet.getWithdrawal(user.id, params.id);
  }

  @Post('withdrawals/:id/cancel')
  @ApiOperation({
    summary: 'Cancel a pending-review withdrawal',
    description: 'Atomically releases reserved funds back to the available balance.',
  })
  cancelWithdrawal(
    @CurrentUser() user: User,
    @Param() params: StringIdParamDto,
  ): Promise<WithdrawalView> {
    return this.wallet.cancelWithdrawal(user.id, params.id);
  }
}
