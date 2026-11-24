import { Controller, Get, Header, Param, ParseIntPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiProduces, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { User } from '../../generated/prisma/client';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminListInvoicesQueryDto, ListInvoicesQueryDto } from './invoices.dto';
import { InvoicesService } from './invoices.service';

const sendPdf = (res: Response, number: string, pdf: Buffer) => {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${number}.pdf"`);
  res.setHeader('Content-Length', String(pdf.length));
  res.end(pdf);
};

@ApiTags('60 Invoices')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Customer, UserRole.Tasker)
@Controller()
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get('invoices')
  @ApiOperation({
    summary: 'My invoices',
    description:
      'Customer: invoices for their completed, settled bookings. Tasker: their deposit receipt plus the customer invoices of the jobs they performed. Issued automatically once a booking is completed and paid (card, wallet or confirmed cash).',
  })
  async list(@CurrentUser() user: User, @Query() query: ListInvoicesQueryDto) {
    return this.invoices.listForUser(user.id, user.role, query);
  }

  @Get('invoices/:invoiceId')
  @ApiParam({ name: 'invoiceId', type: String })
  async get(@CurrentUser() user: User, @Param('invoiceId') invoiceId: string) {
    return this.invoices.view(await this.invoices.getForUser(user.id, user.role, invoiceId));
  }

  @Get('invoices/:invoiceId/html')
  @ApiParam({ name: 'invoiceId', type: String })
  @ApiProduces('text/html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @ApiOperation({ summary: 'Printable invoice document (use the browser print dialog to save as PDF)' })
  async html(@CurrentUser() user: User, @Param('invoiceId') invoiceId: string) {
    return this.invoices.renderHtml(await this.invoices.getForUser(user.id, user.role, invoiceId));
  }

  @Get('invoices/:invoiceId/pdf')
  @ApiParam({ name: 'invoiceId', type: String })
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'Download the invoice as a PDF (A4)' })
  async pdf(@CurrentUser() user: User, @Param('invoiceId') invoiceId: string, @Res() res: Response) {
    const invoice = await this.invoices.getForUser(user.id, user.role, invoiceId);
    sendPdf(res, invoice.number, await this.invoices.renderPdf(invoice));
  }

  @Get('bookings/:bookingId/invoice')
  @ApiParam({ name: 'bookingId', type: Number })
  @ApiOperation({ summary: "A booking's invoice (404 INVOICE_NOT_YET_AVAILABLE until completed and settled)" })
  async forBooking(@CurrentUser() user: User, @Param('bookingId', ParseIntPipe) bookingId: number) {
    return this.invoices.view(await this.invoices.getForBooking(user.id, user.role, bookingId));
  }
}

@ApiTags('60 Invoices')
@ApiBearerAuth('bearer')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Permissions('finance.read')
@Controller('admin/invoices')
export class AdminInvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @ApiOperation({ summary: 'All invoices, with totals and platform-fee sums per type and currency' })
  list(@Query() query: AdminListInvoicesQueryDto) {
    return this.invoices.adminList(query);
  }

  @Get(':invoiceId')
  @ApiParam({ name: 'invoiceId', type: String })
  async get(@Param('invoiceId') invoiceId: string) {
    return this.invoices.view(await this.invoices.adminGet(invoiceId));
  }

  @Post(':invoiceId/resend-email')
  @Permissions('finance.manage')
  @ApiParam({ name: 'invoiceId', type: String })
  @ApiOperation({ summary: 'Email the invoice PDF to the billed user again' })
  resendEmail(@Param('invoiceId') invoiceId: string) {
    return this.invoices.resendEmail(invoiceId);
  }

  @Get(':invoiceId/pdf')
  @ApiParam({ name: 'invoiceId', type: String })
  @ApiProduces('application/pdf')
  async pdf(@Param('invoiceId') invoiceId: string, @Res() res: Response) {
    const invoice = await this.invoices.adminGet(invoiceId);
    sendPdf(res, invoice.number, await this.invoices.renderPdf(invoice));
  }

  @Get(':invoiceId/html')
  @ApiParam({ name: 'invoiceId', type: String })
  @ApiProduces('text/html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async html(@Param('invoiceId') invoiceId: string) {
    return this.invoices.renderHtml(await this.invoices.adminGet(invoiceId));
  }
}
