import { BadRequestException, Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { toCsv } from '../finance-reports/finance-reports.service';
import { InvoicesService } from '../invoices/invoices.service';
import {
  BRAND_PAGE,
  LATACHE_THEME as T,
  drawBrandFooter,
  drawBrandHeader,
  enableArabicText,
  formatDate,
  pdfText,
} from '../invoices/invoice-pdf.renderer';
import { AccountingReportsService } from './accounting-reports.service';
import type { ExportQueryDto } from './accounting.dto';

export const REPORTS = ['trial-balance', 'profit-loss', 'balance-sheet', 'journal', 'general-ledger', 'vat'] as const;
export type ReportName = (typeof REPORTS)[number];

interface Column {
  label: string;
  width: number;
  numeric?: boolean;
}
interface Row {
  cells: Array<string | number | null>;
  bold?: boolean;
  section?: boolean;
}
export interface ReportTable {
  title: string;
  subtitle: string;
  period: string;
  columns: Column[];
  rows: Row[];
  note?: string;
}

const amount = (value: number | null | string) =>
  typeof value === 'number' ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : (value ?? '');

@Injectable()
export class AccountingExportService {
  constructor(
    private readonly reports: AccountingReportsService,
    private readonly invoices: InvoicesService,
  ) {}

  async export(report: ReportName, query: ExportQueryDto): Promise<{ filename: string; contentType: string; body: Buffer }> {
    const table = await this.table(report, query);
    const filename = `latache-${report}-${query.asOf ?? `${query.from}_${query.to}`}.${query.format}`;
    if (query.format === 'csv') {
      const csv = toCsv(
        table.columns.map((column) => column.label),
        table.rows.map((row) =>
          table.columns.map((column, index) => {
            const value = row.cells[index] ?? '';
            return typeof value === 'number' && column.numeric ? value.toFixed(2) : value;
          }),
        ),
      );
      return { filename, contentType: 'text/csv; charset=utf-8', body: Buffer.from(csv, 'utf8') };
    }
    return { filename, contentType: 'application/pdf', body: await this.pdf(table, await this.invoices.sellerIdentity()) };
  }

  private need(query: ExportQueryDto): { from: string; to: string } {
    if (!query.from || !query.to) throw new BadRequestException('from and to are required');
    return { from: query.from, to: query.to };
  }

  async table(report: ReportName, query: ExportQueryDto): Promise<ReportTable> {
    const period = (from: string, to: string) =>
      `${formatDate(`${from}T00:00:00Z`)} to ${formatDate(`${to}T00:00:00Z`)}`;
    const blank = (value: number) => (value === 0 ? null : value);

    if (report === 'balance-sheet') {
      if (!query.asOf) throw new BadRequestException('asOf is required');
      const data = await this.reports.balanceSheet(query.asOf);
      const block = (title: string, lines: Array<{ code: string; name: string; amount: number }>, total: number): Row[] => [
        { cells: ['', title, null], section: true },
        ...lines.map((line) => ({ cells: [line.code, line.name, line.amount] })),
        { cells: ['', `Total ${title.toLowerCase()}`, total], bold: true },
      ];
      return {
        title: 'Balance sheet',
        subtitle: data.currency,
        period: `As of ${formatDate(`${data.asOf}T00:00:00Z`)}`,
        columns: [{ label: 'Code', width: 0.12 }, { label: 'Account', width: 0.63 }, { label: `Amount (${data.currency})`, width: 0.25, numeric: true }],
        rows: [
          ...block('Assets', data.assets, data.totalAssets),
          ...block('Liabilities', data.liabilities, data.totalLiabilities),
          ...block('Equity', data.equity, data.totalEquity),
          { cells: ['', 'Total liabilities and equity', data.totalLiabilitiesAndEquity], bold: true },
        ],
        note: data.isBalanced ? 'Balanced: assets equal liabilities plus equity.' : 'NOT BALANCED.',
      };
    }

    const { from, to } = this.need(query);
    if (report === 'profit-loss') {
      const data = await this.reports.profitAndLoss(from, to);
      const block = (title: string, lines: Array<{ code: string; name: string; amount: number }>, total: number): Row[] => [
        { cells: ['', title, null], section: true },
        ...lines.map((line) => ({ cells: [line.code, line.name, line.amount] })),
        { cells: ['', `Total ${title.toLowerCase()}`, total], bold: true },
      ];
      return {
        title: 'Profit and loss',
        subtitle: data.currency,
        period: period(from, to),
        columns: [{ label: 'Code', width: 0.12 }, { label: 'Account', width: 0.63 }, { label: `Amount (${data.currency})`, width: 0.25, numeric: true }],
        rows: [
          ...block('Revenue', data.revenue, data.totalRevenue),
          ...block('Expenses', data.expenses, data.totalExpenses),
          { cells: ['', data.netProfit < 0 ? 'Net loss' : 'Net profit', data.netProfit], bold: true },
        ],
      };
    }
    if (report === 'trial-balance') {
      const data = await this.reports.trialBalance(from, to);
      return {
        title: 'Trial balance',
        subtitle: data.currency,
        period: period(from, to),
        columns: [
          { label: 'Code', width: 0.08 },
          { label: 'Account', width: 0.4 },
          { label: 'Debit', width: 0.13, numeric: true },
          { label: 'Credit', width: 0.13, numeric: true },
          { label: 'Closing Dr', width: 0.13, numeric: true },
          { label: 'Closing Cr', width: 0.13, numeric: true },
        ],
        rows: [
          ...data.rows.map((row) => ({ cells: [row.code, row.name, blank(row.debit), blank(row.credit), blank(row.closingDebit), blank(row.closingCredit)] })),
          { cells: ['', 'Total', data.totals.debit, data.totals.credit, data.totals.closingDebit, data.totals.closingCredit], bold: true },
        ],
        note: data.isBalanced ? 'Balanced: total debits equal total credits.' : 'NOT BALANCED.',
      };
    }
    if (report === 'journal') {
      const data = await this.reports.journal({ from, to, limit: 5000 });
      const rows: Row[] = [];
      for (const entry of [...data.items].reverse()) {
        rows.push({ cells: [entry.date, entry.number, entry.memo, null, null], section: true });
        for (const line of entry.lines) rows.push({ cells: ['', line.accountCode, line.accountName, blank(line.debit), blank(line.credit)] });
      }
      return {
        title: 'Company journal',
        subtitle: data.currency,
        period: period(from, to),
        columns: [
          { label: 'Date', width: 0.12 },
          { label: 'Entry / account', width: 0.15 },
          { label: 'Description', width: 0.47 },
          { label: 'Debit', width: 0.13, numeric: true },
          { label: 'Credit', width: 0.13, numeric: true },
        ],
        rows,
        note: data.total > data.items.length ? `Only the latest ${data.items.length} of ${data.total} entries are included; narrow the dates.` : undefined,
      };
    }
    if (report === 'general-ledger') {
      if (!query.account) throw new BadRequestException('account is required');
      const data = await this.reports.generalLedger(query.account, from, to);
      return {
        title: 'General ledger',
        subtitle: `${data.account.code} ${data.account.name}`,
        period: period(from, to),
        columns: [
          { label: 'Date', width: 0.11 },
          { label: 'Entry', width: 0.12 },
          { label: 'Description', width: 0.41 },
          { label: 'Debit', width: 0.12, numeric: true },
          { label: 'Credit', width: 0.12, numeric: true },
          { label: 'Balance', width: 0.12, numeric: true },
        ],
        rows: [
          { cells: [from, '', 'Opening balance', null, null, data.openingBalance], bold: true },
          ...data.rows.map((row) => ({ cells: [row.date, row.number, row.memo, blank(row.debit), blank(row.credit), row.balance] })),
          { cells: [to, '', 'Closing balance', data.totalDebit, data.totalCredit, data.closingBalance], bold: true },
        ],
        note: data.truncated ? 'List truncated; narrow the dates.' : undefined,
      };
    }
    const data = await this.reports.vatReport(from, to);
    return {
      title: 'VAT report',
      subtitle: data.currency,
      period: period(from, to),
      columns: [
        { label: 'Date', width: 0.12 },
        { label: 'Entry', width: 0.13 },
        { label: 'Description', width: 0.47 },
        { label: 'VAT on sales', width: 0.14, numeric: true },
        { label: 'VAT on purchases', width: 0.14, numeric: true },
      ],
      rows: [
        ...data.rows.filter((row) => row.outputVat || row.inputVat).map((row) => ({ cells: [row.date, row.number, row.memo, blank(row.outputVat), blank(row.inputVat)] })),
        { cells: ['', '', 'Total', data.outputVat, data.inputVat], bold: true },
        { cells: ['', '', 'Net VAT due (sales minus purchases)', data.netVatDue, null], bold: true },
      ],
    };
  }

  private pdf(table: ReportTable, seller: Record<string, unknown>): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: BRAND_PAGE.margin, info: { Title: table.title } });
      enableArabicText(doc);
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = BRAND_PAGE.margin;
      const width = BRAND_PAGE.contentWidth;
      const bottom = BRAND_PAGE.height - BRAND_PAGE.footerHeight - 14;
      const widths = table.columns.map((column) => column.width * width);
      let y = 0;

      const cell = (text: string, index: number, x: number, bold: boolean, color: string) => {
        doc.fillColor(color).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
        // One line per cell, cut with an ellipsis.
        let value = pdfText(text);
        const room = (widths[index] ?? 0) - 8;
        if (doc.widthOfString(value) > room) {
          while (value.length > 1 && doc.widthOfString(`${value}...`) > room) value = value.slice(0, -1);
          value = `${value}...`;
        }
        doc.text(value, x + 4, y + 4, { width: room, align: table.columns[index]?.numeric ? 'right' : 'left', lineBreak: false });
      };
      const draw = (values: string[], options: { bold?: boolean; fill?: string; color?: string; span?: boolean }) => {
        if (options.fill) doc.rect(left, y, width, 16).fill(options.fill);
        let x = left;
        values.forEach((value, index) => {
          if (value) cell(value, index, x, options.bold ?? false, options.color ?? T.heading);
          x += widths[index] ?? 0;
        });
        y += 16;
      };
      const page = () => {
        drawBrandHeader(doc, { title: table.title, subtitle: table.subtitle, rightTop: table.period, rightBottom: `Generated ${formatDate(new Date().toISOString())}` });
        y = BRAND_PAGE.headerHeight + 14;
        draw(table.columns.map((column) => column.label), { bold: true, fill: T.heading, color: '#FFFFFF' });
      };
      const footer = () => drawBrandFooter(doc, seller, 'Generated from the Latache accounting ledger.');

      page();
      for (const row of table.rows) {
        if (y + 16 > bottom) {
          footer();
          doc.addPage();
          page();
        }
        // Section headings may use the free columns to their right.
        const values: string[] = table.columns.map((column, index) => String(column.numeric ? amount(row.cells[index] ?? null) : (row.cells[index] ?? '')));
        const [first = '', second = '', third = ''] = values;
        const offset = (widths[0] ?? 0) + (widths[1] ?? 0);
        if (row.section && table.columns.length === 5 && table.columns[0]?.label === 'Date') {
          doc.rect(left, y, width, 16).fill(T.creamDeep);
          cell(first, 0, left, true, T.heading);
          cell(second, 1, left + (widths[0] ?? 0), true, T.heading);
          doc.fillColor(T.heading).font('Helvetica-Bold').fontSize(8).text(pdfText(third).slice(0, 100), left + offset + 4, y + 4, { width: width - offset - 8, lineBreak: false, ellipsis: true });
          y += 16;
        } else {
          draw(values, { bold: row.bold || row.section, fill: row.section ? T.creamDeep : undefined });
        }
      }
      if (table.note) {
        if (y + 22 > bottom) {
          footer();
          doc.addPage();
          page();
        }
        doc.fillColor(T.brown).font('Helvetica-Oblique').fontSize(8).text(pdfText(table.note), left + 4, y + 8, { width });
      }
      footer();
      doc.end();
    });
  }
}
