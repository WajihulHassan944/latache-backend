import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import type { User } from '../../../generated/prisma/client';
import { UserRole } from '../../../common/enums/user-role.enum';
import { AdminAuthGuard } from '../../auth/guards/admin-auth.guard';
import { AdminFinanceQueryDto, AdminPayoutActionDto } from '../dto/admin-finance.dto';
import { AdminEarningActionDto } from '../../tasker-finance/dto/tasker-finance.dto';
import { AdminFinanceService } from '../services/admin-finance.service';
import { PlatformPayableSettlementsService } from '../../tasker-finance/platform-payable-settlements.service';
import {
  AdminRecordPlatformSettlementDto,
  ApprovePlatformSettlementDto,
  ListPlatformSettlementsQueryDto,
  RejectPlatformSettlementDto,
} from '../../tasker-finance/dto/platform-settlement.dto';

@ApiTags('58 Admin - Payments & Finance')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'A valid administrator session is required.' })
@ApiForbiddenResponse({ description: 'The administrator lacks the required finance permission.' })
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Controller('admin/finance')
export class AdminFinanceController {
  constructor(
    private readonly finance: AdminFinanceService,
    private readonly settlements: PlatformPayableSettlementsService,
  ) {}

  @Get('platform-payables/settlements')
  @Permissions('finance.read')
  @ApiOperation({
    summary: 'Tasker payments of cash-commission payables (status=pending_review is the confirmation queue)',
  })
  platformSettlements(@Query() query: ListPlatformSettlementsQueryDto) {
    return this.settlements.list(
      {
        ...(query.status ? { status: query.status } : {}),
        ...(query.taskerId ? { taskerId: query.taskerId } : {}),
      },
      query.page,
      query.limit,
    );
  }

  @Post('platform-payables/settlements')
  @Permissions('finance.manage')
  @ApiHeader({ name: 'Idempotency-Key', required: true, example: 'bank-stmt-2026-09-24-17' })
  @ApiOperation({
    summary: 'Record an offline payment received from a Tasker (bank transfer, cash deposit, other)',
    description:
      'Applied immediately: FIFO against open cash receivables, platform ledger entries written, cash restriction re-evaluated. Excess over the outstanding payable is credited to the Tasker wallet. Audited.',
  })
  recordPlatformSettlement(
    @CurrentUser() actor: User,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: AdminRecordPlatformSettlementDto,
  ) {
    return this.settlements.adminRecord(actor.id, dto, idempotencyKey ?? '');
  }

  @Post('platform-payables/settlements/:id/approve')
  @Permissions('finance.manage')
  @ApiParam({ name: 'id', required: true, type: String })
  @ApiOperation({ summary: 'Confirm a Tasker-declared bank transfer was received (optionally a different amount)' })
  approvePlatformSettlement(
    @CurrentUser() actor: User,
    @Param('id') id: string,
    @Body() dto: ApprovePlatformSettlementDto,
  ) {
    return this.settlements.approve(actor.id, id, dto);
  }

  @Post('platform-payables/settlements/:id/reject')
  @Permissions('finance.manage')
  @ApiParam({ name: 'id', required: true, type: String })
  @ApiOperation({ summary: 'Reject a Tasker-declared bank transfer that was not received' })
  rejectPlatformSettlement(
    @CurrentUser() actor: User,
    @Param('id') id: string,
    @Body() dto: RejectPlatformSettlementDto,
  ) {
    return this.settlements.reject(actor.id, id, dto.note);
  }

  @Get()
  @Permissions('finance.read')
  @ApiOperation({
    summary: 'Unified Payments & Finance dashboard read API',
    description:
      'Use view=overview|transactions|refunds|payouts|revenue|earnings|cash_receivables|chargebacks. Earnings and cash receivables read the same ledger/state records used by Taskers and settlement workers. chargebacks exposes Stripe provider disputes received through verified webhooks; internal Latache complaints remain in Dispute Management. Commission, tax, and taskerFinance policy are managed through Platform Settings. Refund execution remains in Dispute Management.',
  })
  @ApiProduces('application/json', 'text/csv')
  @ApiOkResponse({
    description:
      'Finance dashboard data generated exclusively from persisted payment/wallet/payout/dispute records.',
  })
  async read(
    @CurrentUser() actor: User,
    @Query() query: AdminFinanceQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (query.format === 'csv') {
      if (actor.role !== UserRole.SuperAdmin && !actor.permissions.includes('reports.read')) {
        throw new ForbiddenException('reports.read is required for finance CSV exports');
      }
      const result = await this.finance.csv(query);
      response.setHeader('Content-Type', 'text/csv; charset=utf-8');
      response.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      response.setHeader('X-Export-Truncated', String(result.truncated));
      return result.body;
    }
    return this.finance.read(query);
  }

  @Post('payouts/:id/actions')
  @Permissions('finance.manage')
  @ApiParam({ name: 'id', required: true, type: String, description: 'Payout request ID.' })
  @ApiOperation({
    summary: 'Review and settle a Tasker payout request',
    description:
      'approve only changes pending_review → processing. mark_paid requires a real external transfer reference and consumes the reserved pending wallet balance. reject/mark_failed release reserved funds. No provider transfer is fabricated by this endpoint.',
  })
  @ApiBody({
    type: AdminPayoutActionDto,
    examples: {
      approve: { value: { action: 'approve', note: 'Payout details verified.' } },
      paid: {
        value: {
          action: 'mark_paid',
          providerReference: 'bank-transfer-482901',
          note: 'Verified in bank portal.',
        },
      },
      reject: {
        value: { action: 'reject', note: 'Payout account ownership could not be verified.' },
      },
    },
  })
  payoutAction(
    @CurrentUser() actor: User,
    @Param('id') id: string,
    @Body() dto: AdminPayoutActionDto,
  ) {
    return this.finance.payoutAction(actor, id, dto);
  }

  @Post('earnings/:id/actions')
  @Permissions('finance.manage')
  @ApiParam({ name: 'id', required: true, type: String, description: 'Earning record ID.' })
  @ApiOperation({
    summary: 'Block, unblock, or explicitly extend one pending earning clearance',
    description:
      'Every action is audited and uses the same earning record consumed by the release worker. Active disputes prevent unblocking. extend_clearance requires a later explicit timestamp and reason.',
  })
  earningAction(
    @CurrentUser() actor: User,
    @Param('id') id: string,
    @Body() dto: AdminEarningActionDto,
  ) {
    return this.finance.earningAction(actor, id, dto);
  }
}
