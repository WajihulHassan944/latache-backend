import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { User } from '../../generated/prisma/client';
import { AdminAuditService } from '../admin-audit/admin-audit.service';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminCustomerWithdrawalActionDto, AdminCustomerWithdrawalsQueryDto } from './payments.dto';
import { PaymentsService } from './payments.service';

@ApiTags('58 Admin - Payments & Finance')
@ApiBearerAuth('bearer')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Controller('admin/finance/customer-withdrawals')
export class AdminCustomerWithdrawalsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get()
  @Permissions('finance.read')
  @ApiOperation({ summary: 'Customer wallet withdrawal queue (oldest first) with pending totals' })
  list(@Query() query: AdminCustomerWithdrawalsQueryDto) {
    return this.payments.adminListCustomerWithdrawals(query);
  }

  @Get(':id/reveal-destination')
  @Permissions('finance.manage')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Decrypt the bank details to execute the transfer (audited)' })
  async reveal(@CurrentUser() actor: User, @Param('id') id: string) {
    const result = await this.payments.adminRevealCustomerWithdrawalDestination(id);
    await this.audit.record({
      actorId: actor.id,
      targetUserId: Number(result.customerId),
      action: 'customer_withdrawal_destination_revealed',
      entityType: 'customer_withdrawal',
      entityId: id,
    });
    return result;
  }

  @Post(':id/actions')
  @Permissions('finance.manage')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({
    summary: 'approve | mark_paid (needs providerReference) | reject | mark_failed (need note; money returns to wallet)',
  })
  async action(@CurrentUser() actor: User, @Param('id') id: string, @Body() dto: AdminCustomerWithdrawalActionDto) {
    const result = await this.payments.adminCustomerWithdrawalAction(actor.id, id, dto);
    await this.audit.record({
      actorId: actor.id,
      action: `customer_withdrawal_${dto.action}`,
      entityType: 'customer_withdrawal',
      entityId: id,
      reason: dto.note ?? null,
      metadata: { providerReference: dto.providerReference ?? null, status: result.status },
    });
    return result;
  }
}
