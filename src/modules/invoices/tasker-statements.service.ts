import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { UserRole } from '../../common/enums/user-role.enum';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { toCsv } from '../finance-reports/finance-reports.service';
import {
  BRAND_ASSETS,
  BRAND_PAGE,
  LATACHE_THEME as T,
  drawBrandFooter,
  drawBrandHeader,
  enableArabicText,
  formatDate,
  formatMoney,
  pdfText,
} from './invoice-pdf.renderer';
import { InvoicesService } from './invoices.service';
import { bookingRef } from '../../common/utils/booking-ref.util';

const num = (value: Prisma.Decimal | number | null | undefined): number => (value === null || value === undefined ? 0 : Number(value));
const r2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const who = (p: { firstName: string | null; lastName: string | null } | null | undefined) =>
  p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() : '';

export interface TaskerStatement {
  tasker: { id: string; name: string; email: string };
  month: string;
  period: { from: string; to: string };
  currency: string;
  summary: {
    completedJobs: number;
    grossCustomerAmount: number;
    platformCommission: number;
    tips: number;
    netEarned: number;
    paidOut: number;
    payoutsInProgress: number;
    walletOpening: number;
    walletClosing: number;
    owedToPlatformOpening: number;
    owedToPlatformClosing: number;
    cashCommissionCharged: number;
    cashCommissionSettled: number;
  };
  earnings: Array<{ date: string; bookingId: string; service: string; customer: string; paymentSource: string; gross: number; commission: number; tip: number; net: number; status: string }>;
  payouts: Array<{ requestedAt: string; id: string; amount: number; status: string; destination: string; reference: string | null; processedAt: string | null }>;
  walletMovements: Array<{ date: string; kind: string; description: string; availableDelta: number; pendingDelta: number }>;
}

/**
 * Monthly Tasker statement (UTC calendar month): jobs and earnings, payouts,
 * wallet opening/closing balances from the ledger deltas, and the cash
 * commission owed to the platform. JSON, CSV and a branded PDF.
 */
@Injectable()
export class TaskerStatementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoicesService,
  ) {}

  async build(taskerId: number, month: string): Promise<TaskerStatement> {
    const match = /^(\d{4})-(\d{2})$/.exec(month);
    if (!match) throw new BadRequestException('month must be YYYY-MM');
    const from = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
    const to = new Date(Date.UTC(Number(match[1]), Number(match[2]), 1));
    if (Number.isNaN(from.getTime()) || Number(match[2]) < 1 || Number(match[2]) > 12) throw new BadRequestException('month must be YYYY-MM');

    const tasker = await this.prisma.user.findFirst({
      where: { id: taskerId, roles: { has: UserRole.Tasker } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    if (!tasker) throw new NotFoundException('Tasker not found');

    const inMonth = { gte: from, lt: to };
    const [earnings, payouts, movements, walletBefore, walletEnd, payableBefore, payableEnd, payableEntries, wallet] = await Promise.all([
      this.prisma.taskerEarning.findMany({
        where: { taskerId, createdAt: inMonth },
        include: {
          booking: {
            select: { id: true, bookingDate: true, paymentSource: true, service: { select: { name: true } }, customer: { select: { firstName: true, lastName: true } } },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.taskerWithdrawal.findMany({
        where: { taskerId, requestedAt: inMonth },
        include: { payoutMethod: { select: { maskedIdentifier: true } } },
        orderBy: { requestedAt: 'asc' },
      }),
      this.prisma.taskerWalletLedgerEntry.findMany({ where: { taskerId, createdAt: inMonth }, orderBy: { createdAt: 'asc' } }),
      this.prisma.taskerWalletLedgerEntry.aggregate({ where: { taskerId, createdAt: { lt: from } }, _sum: { availableDelta: true, pendingDelta: true } }),
      this.prisma.taskerWalletLedgerEntry.aggregate({ where: { taskerId, createdAt: { lt: to } }, _sum: { availableDelta: true, pendingDelta: true } }),
      this.prisma.taskerPlatformLedgerEntry.aggregate({ where: { taskerId, createdAt: { lt: from } }, _sum: { payableDelta: true } }),
      this.prisma.taskerPlatformLedgerEntry.aggregate({ where: { taskerId, createdAt: { lt: to } }, _sum: { payableDelta: true } }),
      this.prisma.taskerPlatformLedgerEntry.findMany({ where: { taskerId, createdAt: inMonth }, select: { payableDelta: true } }),
      this.prisma.taskerWallet.findUnique({ where: { taskerId }, select: { currency: true } }),
    ]);

    const earningRows = earnings.map((row) => ({
      date: (row.booking?.bookingDate ?? row.createdAt).toISOString().slice(0, 10),
      bookingId: String(row.bookingId),
      service: row.booking?.service.name ?? '',
      customer: who(row.booking?.customer),
      paymentSource: row.booking?.paymentSource ?? '',
      gross: num(row.grossCustomerAmount),
      commission: num(row.platformCommissionAmount),
      tip: num(row.tipAmount),
      net: r2(num(row.taskerNetAmount) - num(row.reversedAmount)),
      status: row.status,
    }));
    const sum = (values: number[]) => r2(values.reduce((a, b) => a + b, 0));
    const charged = payableEntries.filter((e) => num(e.payableDelta) > 0).map((e) => num(e.payableDelta));
    const settled = payableEntries.filter((e) => num(e.payableDelta) < 0).map((e) => -num(e.payableDelta));

    return {
      tasker: { id: String(tasker.id), name: who(tasker), email: tasker.email },
      month,
      period: { from: from.toISOString().slice(0, 10), to: new Date(to.getTime() - 1).toISOString().slice(0, 10) },
      currency: wallet?.currency ?? earnings[0]?.currency ?? 'USD',
      summary: {
        completedJobs: earningRows.length,
        grossCustomerAmount: sum(earningRows.map((e) => e.gross)),
        platformCommission: sum(earningRows.map((e) => e.commission)),
        tips: sum(earningRows.map((e) => e.tip)),
        netEarned: sum(earningRows.map((e) => e.net)),
        paidOut: sum(payouts.filter((p) => p.status === 'paid').map((p) => num(p.amount))),
        payoutsInProgress: sum(payouts.filter((p) => ['pending_review', 'processing'].includes(p.status)).map((p) => num(p.amount))),
        walletOpening: r2(num(walletBefore._sum.availableDelta) + num(walletBefore._sum.pendingDelta)),
        walletClosing: r2(num(walletEnd._sum.availableDelta) + num(walletEnd._sum.pendingDelta)),
        owedToPlatformOpening: r2(num(payableBefore._sum.payableDelta)),
        owedToPlatformClosing: r2(num(payableEnd._sum.payableDelta)),
        cashCommissionCharged: sum(charged),
        cashCommissionSettled: sum(settled),
      },
      earnings: earningRows,
      payouts: payouts.map((p) => ({
        requestedAt: p.requestedAt.toISOString(),
        id: p.id,
        amount: num(p.amount),
        status: p.status,
        destination: p.payoutMethod.maskedIdentifier,
        reference: p.providerReference,
        processedAt: p.processedAt?.toISOString() ?? null,
      })),
      walletMovements: movements.map((e) => ({
        date: e.createdAt.toISOString(),
        kind: e.kind,
        description: e.description,
        availableDelta: num(e.availableDelta),
        pendingDelta: num(e.pendingDelta),
      })),
    };
  }

  csv(statement: TaskerStatement): string {
    const s = statement.summary;
    const rows: Array<Array<unknown>> = [
      ['summary', 'completed_jobs', s.completedJobs],
      ['summary', 'gross_customer_amount', s.grossCustomerAmount.toFixed(2)],
      ['summary', 'platform_commission', s.platformCommission.toFixed(2)],
      ['summary', 'tips', s.tips.toFixed(2)],
      ['summary', 'net_earned', s.netEarned.toFixed(2)],
      ['summary', 'paid_out', s.paidOut.toFixed(2)],
      ['summary', 'wallet_opening', s.walletOpening.toFixed(2)],
      ['summary', 'wallet_closing', s.walletClosing.toFixed(2)],
      ['summary', 'owed_to_platform_closing', s.owedToPlatformClosing.toFixed(2)],
      ...statement.earnings.map((e) => ['earning', e.date, `${bookingRef(e.bookingId)}`, e.service, e.customer, e.paymentSource, e.gross.toFixed(2), e.commission.toFixed(2), e.tip.toFixed(2), e.net.toFixed(2), e.status]),
      ...statement.payouts.map((p) => ['payout', p.requestedAt, p.id, p.destination, p.status, p.amount.toFixed(2), p.reference ?? '', p.processedAt ?? '']),
      ...statement.walletMovements.map((m) => ['wallet', m.date, m.kind, m.description, m.availableDelta.toFixed(2), m.pendingDelta.toFixed(2)]),
    ];
    return toCsv(['section', 'field_or_date', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11'], rows);
  }

  async pdf(statement: TaskerStatement): Promise<Buffer> {
    const seller = await this.invoices.sellerIdentity();
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: BRAND_PAGE.margin, info: { Title: `Earnings statement ${statement.month}`, Author: 'Latache' } });
      enableArabicText(doc);
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const m = BRAND_PAGE.margin;
      const W = BRAND_PAGE.contentWidth;
      const money = (v: number) => formatMoney(v, statement.currency);
      const monthLabel = new Date(`${statement.month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      const fine = `Earnings statement ${statement.month} for ${statement.tasker.name}. Electronically generated.`;
      const bottomLimit = BRAND_PAGE.height - BRAND_PAGE.footerHeight - 16;

      drawBrandHeader(doc, { title: 'Earnings statement', subtitle: 'RELEVÉ DE GAINS', rightTop: monthLabel, rightBottom: `${formatDate(statement.period.from)} - ${formatDate(statement.period.to)}` });
      let y = BRAND_PAGE.headerHeight + 8;
      if (BRAND_ASSETS.logo) doc.image(BRAND_ASSETS.logo, m - 4, y, { width: 130 });
      doc.fillColor(T.copper).font('Helvetica-Bold').fontSize(7.5).text('TASKER', m + W - 230, y + 4, { width: 230, align: 'right', characterSpacing: 1.2 });
      doc.fillColor(T.heading).font('Times-Bold').fontSize(14).text(pdfText(statement.tasker.name), m + W - 230, y + 16, { width: 230, align: 'right' });
      doc.fillColor(T.muted).font('Helvetica').fontSize(8.5).text(pdfText(statement.tasker.email), m + W - 230, doc.y + 1, { width: 230, align: 'right' });
      y += 56;

      // ---- KPI tiles ----
      const s = statement.summary;
      const tiles: Array<[string, string, string]> = [
        ['NET EARNED', money(s.netEarned), `${s.completedJobs} job${s.completedJobs === 1 ? '' : 's'}`],
        ['PAID OUT', money(s.paidOut), s.payoutsInProgress > 0 ? `${money(s.payoutsInProgress)} in progress` : 'to your bank'],
        ['WALLET BALANCE', money(s.walletClosing), `opened at ${money(s.walletOpening)}`],
        ['OWED TO LATACHE', money(s.owedToPlatformClosing), 'cash-job commission'],
      ];
      const tileW = (W - 3 * 10) / 4;
      tiles.forEach(([label, value, note], i) => {
        const x = m + i * (tileW + 10);
        doc.roundedRect(x, y, tileW, 62, 10).lineWidth(1).fillAndStroke(i === 0 ? T.brown : T.cream, T.rule);
        doc.fillColor(i === 0 ? T.gold : T.copper).font('Helvetica-Bold').fontSize(6.5).text(label, x + 10, y + 10, { width: tileW - 20, characterSpacing: 1 });
        doc.fillColor(i === 0 ? '#FFFFFF' : T.heading).font('Times-Bold').fontSize(13).text(value, x + 10, y + 24, { width: tileW - 20 });
        doc.fillColor(i === 0 ? T.gold : T.muted).font('Helvetica').fontSize(7).text(pdfText(note), x + 10, y + 45, { width: tileW - 20 });
      });
      y += 78;

      const newPageIfNeeded = (needed: number) => {
        if (y + needed <= bottomLimit) return;
        drawBrandFooter(doc, seller, fine);
        doc.addPage();
        doc.rect(0, 0, BRAND_PAGE.width, BRAND_PAGE.height).fill(T.page);
        doc.rect(0, 0, BRAND_PAGE.width, 6).fill(T.brown);
        y = 36;
      };
      const table = (title: string, headers: Array<[string, number, 'left' | 'right']>, rows: string[][], empty: string) => {
        newPageIfNeeded(70);
        doc.fillColor(T.copper).font('Helvetica-Bold').fontSize(7.5).text(title, m, y, { characterSpacing: 1.2 });
        y += 14;
        const drawHead = () => {
          doc.roundedRect(m, y, W, 22, 6).fill(T.heading);
          let x = m + 10;
          for (const [label, width, align] of headers) {
            doc.fillColor(T.gold).font('Helvetica-Bold').fontSize(7.5).text(label, x, y + 7, { width: width - 6, align, characterSpacing: 0.8 });
            x += width;
          }
          y += 22;
        };
        drawHead();
        if (rows.length === 0) {
          doc.fillColor(T.muted).font('Helvetica-Oblique').fontSize(8.5).text(empty, m + 10, y + 7);
          y += 24;
          return;
        }
        rows.forEach((row, index) => {
          if (y + 20 > bottomLimit) {
            newPageIfNeeded(40);
            drawHead();
          }
          if (index % 2 === 1) doc.rect(m, y, W, 20).fill(T.cream);
          let x = m + 10;
          row.forEach((cell, c) => {
            const [, width, align] = headers[c] as [string, number, "left" | "right"];
            doc.fillColor(T.ink).font(c === row.length - 1 && align === 'right' ? 'Helvetica-Bold' : 'Helvetica').fontSize(8)
              .text(pdfText(cell), x, y + 6, { width: width - 6, align, lineBreak: false, ellipsis: true });
            x += width;
          });
          y += 20;
        });
        doc.moveTo(m, y).lineTo(m + W, y).lineWidth(0.5).strokeColor(T.rule).stroke();
        y += 16;
      };

      table(
        'JOBS & EARNINGS',
        [['DATE', 62, 'left'], ['BOOKING', 52, 'left'], ['SERVICE', 92, 'left'], ['CUSTOMER', 92, 'left'], ['GROSS', 64, 'right'], ['COMMISSION', 66, 'right'], ['NET', 69, 'right']],
        statement.earnings.map((e) => [formatDate(e.date), `${bookingRef(e.bookingId)}`, e.service, e.customer, money(e.gross), money(-e.commission), money(e.net)]),
        'No completed jobs this month.',
      );
      table(
        'PAYOUTS TO YOUR BANK',
        [['REQUESTED', 72, 'left'], ['DESTINATION', 140, 'left'], ['STATUS', 80, 'left'], ['REFERENCE', 113, 'left'], ['AMOUNT', 92, 'right']],
        statement.payouts.map((p) => [formatDate(p.requestedAt), p.destination, p.status.replace('_', ' '), p.reference ?? '-', money(p.amount)]),
        'No payouts requested this month.',
      );

      // ---- Reconciliation box ----
      newPageIfNeeded(110);
      doc.roundedRect(m, y, W, 96, 10).lineWidth(1).fillAndStroke('#FFFFFF', T.rule);
      const line = (label: string, value: string, row: number, strong = false) => {
        doc.fillColor(strong ? T.heading : T.muted).font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).text(label, m + 16, y + 12 + row * 16, { width: 260 });
        doc.fillColor(T.heading).font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).text(value, m + W - 176, y + 12 + row * 16, { width: 160, align: 'right' });
      };
      line('Gross paid by customers', money(s.grossCustomerAmount), 0);
      line('Platform commission', money(-s.platformCommission), 1);
      line('Cash-job commission charged / settled', `${money(s.cashCommissionCharged)} / ${money(s.cashCommissionSettled)}`, 2);
      line('Owed to Latache at month start / end', `${money(s.owedToPlatformOpening)} / ${money(s.owedToPlatformClosing)}`, 3);
      line('Net earned this month', money(s.netEarned), 4, true);
      y += 110;

      drawBrandFooter(doc, seller, fine);
      doc.end();
    });
  }
}
