import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { User } from '../../generated/prisma/client';
import { AdminAuditService } from '../admin-audit/admin-audit.service';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AccountingExportService, REPORTS, type ReportName } from './accounting-export.service';
import { AccountingPostingService } from './accounting-posting.service';
import { AccountingReportsService } from './accounting-reports.service';
import {
  AsOfQueryDto,
  ClosePeriodDto,
  CreateAccountDto,
  CreateEntryDto,
  CreateExpenseDto,
  ExpenseQueryDto,
  ExportQueryDto,
  JournalQueryDto,
  LedgerQueryDto,
  PayExpenseDto,
  PeriodQueryDto,
  ReverseEntryDto,
  UpdateAccountDto,
  UpdateBookSettingsDto,
  VoidExpenseDto,
} from './accounting.dto';
import { AccountingService } from './accounting.service';

@ApiTags('66 Admin - Accounting')
@ApiBearerAuth('bearer')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Permissions('finance.read')
@Controller('admin/accounting')
export class AccountingController {
  constructor(
    private readonly reports: AccountingReportsService,
    private readonly accounting: AccountingService,
    private readonly posting: AccountingPostingService,
    private readonly exports: AccountingExportService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'Totals, profit for the year and the books-versus-wallets check' })
  overview() {
    return this.reports.overview();
  }

  @Post('sync')
  @Permissions('finance.manage')
  @ApiOperation({ summary: 'Post any money movement that is not in the journal yet (also runs automatically)' })
  sync() {
    return this.posting.sync(true);
  }

  @Get('accounts')
  @ApiOperation({ summary: 'Chart of accounts with current balances' })
  accounts() {
    return this.reports.chart();
  }

  @Post('accounts')
  @Permissions('finance.manage')
  createAccount(@CurrentUser() actor: User, @Body() dto: CreateAccountDto) {
    return this.accounting.createAccount(actor.id, dto);
  }

  @Patch('accounts/:code')
  @Permissions('finance.manage')
  updateAccount(@CurrentUser() actor: User, @Param('code') code: string, @Body() dto: UpdateAccountDto) {
    return this.accounting.updateAccount(actor.id, code, dto);
  }

  @Get('journal')
  @ApiOperation({ summary: 'Company journal (every double-entry record)' })
  journal(@Query() query: JournalQueryDto) {
    return this.reports.journal(query);
  }

  @Post('journal')
  @Permissions('finance.manage')
  @ApiOperation({ summary: 'Record a manual or opening-balance entry (must balance)' })
  createEntry(@CurrentUser() actor: User, @Body() dto: CreateEntryDto) {
    return this.accounting.createEntry(actor.id, dto);
  }

  @Post('journal/:id/reverse')
  @Permissions('finance.manage')
  reverse(@CurrentUser() actor: User, @Param('id') id: string, @Body() dto: ReverseEntryDto) {
    return this.accounting.reverseEntry(actor.id, id, dto);
  }

  @Get('general-ledger')
  ledger(@Query() query: LedgerQueryDto) {
    return this.reports.generalLedger(query.account, query.from, query.to);
  }

  @Get('trial-balance')
  trialBalance(@Query() query: PeriodQueryDto) {
    return this.reports.trialBalance(query.from, query.to);
  }

  @Get('profit-loss')
  profitLoss(@Query() query: PeriodQueryDto) {
    return this.reports.profitAndLoss(query.from, query.to);
  }

  @Get('balance-sheet')
  balanceSheet(@Query() query: AsOfQueryDto) {
    return this.reports.balanceSheet(query.asOf);
  }

  @Get('vat')
  vat(@Query() query: PeriodQueryDto) {
    return this.reports.vatReport(query.from, query.to);
  }

  @Get('reports/:report/export')
  @Permissions('finance.read', 'reports.read')
  @ApiParam({ name: 'report', enum: REPORTS })
  @ApiOperation({ summary: 'Download a report as PDF or CSV. Audited.' })
  async export(@CurrentUser() actor: User, @Param('report') report: string, @Query() query: ExportQueryDto, @Res() res: Response) {
    if (!(REPORTS as readonly string[]).includes(report)) {
      throw new BadRequestException(`report must be one of: ${REPORTS.join(', ')}`);
    }
    const file = await this.exports.export(report as ReportName, query);
    await this.audit.record({
      actorId: actor.id,
      action: 'accounting_report_downloaded',
      entityType: 'accounting_report',
      entityId: report,
      metadata: { ...query },
    });
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Content-Length', String(file.body.length));
    res.end(file.body);
  }

  @Get('expenses')
  expenses(@Query() query: ExpenseQueryDto) {
    return this.accounting.listExpenses(query);
  }

  @Post('expenses')
  @Permissions('finance.manage')
  createExpense(@CurrentUser() actor: User, @Body() dto: CreateExpenseDto) {
    return this.accounting.createExpense(actor.id, dto);
  }

  @Post('expenses/:id/pay')
  @Permissions('finance.manage')
  payExpense(@CurrentUser() actor: User, @Param('id') id: string, @Body() dto: PayExpenseDto) {
    return this.accounting.payExpense(actor.id, id, dto);
  }

  @Post('expenses/:id/void')
  @Permissions('finance.manage')
  voidExpense(@CurrentUser() actor: User, @Param('id') id: string, @Body() dto: VoidExpenseDto) {
    return this.accounting.voidExpense(actor.id, id, dto.reason);
  }

  @Patch('settings')
  @Permissions('finance.manage')
  settings(@CurrentUser() actor: User, @Body() dto: UpdateBookSettingsDto) {
    return this.accounting.updateSettings(actor.id, dto.fiscalYearStartMonth);
  }

  @Post('periods/close')
  @Permissions('finance.manage')
  @ApiOperation({ summary: 'Lock the books through a date (send through=null to reopen). Audited.' })
  closePeriod(@CurrentUser() actor: User, @Body() dto: ClosePeriodDto) {
    return this.accounting.closePeriod(actor.id, dto.through ?? null);
  }
}
