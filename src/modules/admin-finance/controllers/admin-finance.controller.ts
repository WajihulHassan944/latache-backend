import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
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
import { AdminFinanceService } from '../services/admin-finance.service';

@ApiTags('26 Admin - Payments & Finance')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'A valid administrator session is required.' })
@ApiForbiddenResponse({ description: 'The administrator lacks the required finance permission.' })
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Controller('admin/finance')
export class AdminFinanceController {
  constructor(private readonly finance: AdminFinanceService) {}

  @Get()
  @Permissions('finance.read')
  @ApiOperation({
    summary: 'Unified Payments & Finance dashboard read API',
    description:
      'Use view=overview|transactions|refunds|payouts|revenue. Commission and tax tabs read/write through the single Platform Settings API. Refund execution stays in Dispute Management, preventing a second refund mutation flow. format=csv exports the same filtered records for transactions/refunds/payouts/revenue.',
  })
  @ApiProduces('application/json', 'text/csv')
  @ApiOkResponse({ description: 'Finance dashboard data generated exclusively from persisted payment/wallet/payout/dispute records.' })
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
  @ApiOperation({
    summary: 'Review and settle a Tasker payout request',
    description:
      'approve only changes pending_review → processing. mark_paid requires a real external transfer reference and consumes the reserved pending wallet balance. reject/mark_failed release reserved funds. No provider transfer is fabricated by this endpoint.',
  })
  @ApiBody({
    type: AdminPayoutActionDto,
    examples: {
      approve: { value: { action: 'approve', note: 'Payout details verified.' } },
      paid: { value: { action: 'mark_paid', providerReference: 'bank-transfer-482901', note: 'Verified in bank portal.' } },
      reject: { value: { action: 'reject', note: 'Payout account ownership could not be verified.' } },
    },
  })
  payoutAction(
    @CurrentUser() actor: User,
    @Param('id') id: string,
    @Body() dto: AdminPayoutActionDto,
  ) {
    return this.finance.payoutAction(actor, id, dto);
  }
}
