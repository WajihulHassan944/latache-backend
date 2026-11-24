import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiProduces, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { User } from '../../generated/prisma/client';
import { AdminAuditService } from '../admin-audit/admin-audit.service';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { FINANCE_EXPORT_DATASETS, type FinanceExportDataset, FinanceReportsService } from './finance-reports.service';
import { BadRequestException } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';

export class FinancePeriodQueryDto {
  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-30' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
}

@ApiTags('58 Admin - Payments & Finance')
@ApiBearerAuth('bearer')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Controller('admin/finance')
export class FinanceReportsController {
  constructor(
    private readonly reports: FinanceReportsService,
    private readonly audit: AdminAuditService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  @Get('reconciliation/:provider')
  @Permissions('finance.read')
  @ApiParam({ name: 'provider', enum: ['stripe', 'cmi'] })
  @ApiOperation({
    summary: 'Reconcile provider money vs the ledger for a period (from/to required, max ~3 months)',
    description:
      'stripe: pulls charges + refunds from Stripe and lists charge/refund missing in ledger, ledger missing in Stripe, status and amount mismatches. cmi: abandoned (no callback after 1h) and declined orders plus succeeded totals to compare with the CMI back-office report.',
  })
  reconcile(@Param('provider') provider: string, @Query() query: FinancePeriodQueryDto) {
    if (!query.from || !query.to) throw new BadRequestException('from and to are required');
    if (provider === 'stripe') return this.reconciliation.stripeReport(query.from, query.to);
    if (provider === 'cmi') return this.reconciliation.cmiReport(query.from, query.to);
    throw new BadRequestException('provider must be stripe or cmi');
  }

  @Get('overview')
  @Permissions('finance.read')
  @ApiOperation({
    summary: 'Finance overview per currency: revenue, money owed to Taskers/customers, payout queues, deposits held, cash debt',
  })
  overview(@Query() query: FinancePeriodQueryDto) {
    return this.reports.overview(query.from, query.to);
  }

  @Get('exports/:dataset')
  @Permissions('finance.read', 'reports.read')
  @ApiParam({ name: 'dataset', enum: FINANCE_EXPORT_DATASETS })
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'CSV export for the accountant (Excel-ready, UTF-8). Optional from/to (YYYY-MM-DD). Audited.' })
  async export(
    @CurrentUser() actor: User,
    @Param('dataset') dataset: string,
    @Query() query: FinancePeriodQueryDto,
    @Res() res: Response,
  ) {
    if (!(FINANCE_EXPORT_DATASETS as readonly string[]).includes(dataset)) {
      throw new BadRequestException(`dataset must be one of: ${FINANCE_EXPORT_DATASETS.join(', ')}`);
    }
    const { filename, csv } = await this.reports.export(dataset as FinanceExportDataset, query.from, query.to);
    await this.audit.record({
      actorId: actor.id,
      action: 'finance_export_downloaded',
      entityType: 'finance_export',
      entityId: dataset,
      metadata: { from: query.from ?? null, to: query.to ?? null },
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.end(csv);
  }
}
