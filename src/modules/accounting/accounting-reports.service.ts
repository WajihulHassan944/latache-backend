import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { AccountingBooksService } from './accounting-books.service';
import { AccountingPostingService, dayOf } from './accounting-posting.service';
import { ACC, type AccountType, DEBIT_NORMAL } from './accounting.constants';

const r2 = (value: number) => Math.round((value + (value < 0 ? -Number.EPSILON : Number.EPSILON)) * 100) / 100 || 0;
const sum = <T>(rows: T[], pick: (row: T) => number) => r2(rows.reduce((total, row) => total + pick(row), 0));
const isoDate = (date: Date) => date.toISOString().slice(0, 10);
export const parseDay = (value: string): Date => {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || isoDate(date) !== value) {
    throw new BadRequestException(`Invalid date "${value}" (expected YYYY-MM-DD)`);
  }
  return date;
};
export const entryCode = (number: number) => `JE-${String(number).padStart(6, '0')}`;

export interface AccountBalance {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  isControl: boolean;
  isActive: boolean;
  debit: number;
  credit: number;
}

@Injectable()
export class AccountingReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly books: AccountingBooksService,
    private readonly posting: AccountingPostingService,
  ) {}

  /** Debit and credit totals per account for entries dated inside [from, to]. */
  async totals(from?: Date, to?: Date): Promise<AccountBalance[]> {
    const dates: Prisma.DateTimeFilter = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    const [accounts, grouped] = await Promise.all([
      this.prisma.ledgerAccount.findMany({ orderBy: { code: 'asc' } }),
      this.prisma.journalLine.groupBy({
        by: ['accountId'],
        where: from || to ? { entry: { entryDate: dates } } : {},
        _sum: { debit: true, credit: true },
      }),
    ]);
    const byId = new Map(grouped.map((row) => [row.accountId, row._sum]));
    return accounts.map((account) => ({
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type as AccountType,
      isControl: account.isControl,
      isActive: account.isActive,
      debit: r2(Number(byId.get(account.id)?.debit ?? 0)),
      credit: r2(Number(byId.get(account.id)?.credit ?? 0)),
    }));
  }

  private balanceOf(row: AccountBalance): number {
    return r2(DEBIT_NORMAL.has(row.type) ? row.debit - row.credit : row.credit - row.debit);
  }

  async fiscalYearStart(asOf: Date): Promise<Date> {
    const { fiscalYearStartMonth } = await this.books.settings();
    const month = fiscalYearStartMonth - 1;
    const year = asOf.getUTCMonth() >= month ? asOf.getUTCFullYear() : asOf.getUTCFullYear() - 1;
    return new Date(Date.UTC(year, month, 1));
  }

  async chart() {
    await this.posting.sync();
    await this.books.accountIds();
    const [rows, accounts] = await Promise.all([this.totals(), this.prisma.ledgerAccount.findMany()]);
    const meta = new Map(accounts.map((account) => [account.id, account]));
    return rows.map((row) => ({
      ...row,
      balance: this.balanceOf(row),
      description: meta.get(row.id)?.description ?? null,
      isSystem: meta.get(row.id)?.isSystem ?? false,
      isCash: meta.get(row.id)?.isCash ?? false,
    }));
  }

  async trialBalance(from: string, to: string) {
    await this.posting.sync();
    const start = parseDay(from);
    const end = parseDay(to);
    const [before, within, settings] = await Promise.all([
      this.totals(undefined, new Date(start.getTime() - 86_400_000)),
      this.totals(start, end),
      this.books.settings(),
    ]);
    const opening = new Map(before.map((row) => [row.id, r2(row.debit - row.credit)]));
    const rows = within
      .map((row) => {
        const open = opening.get(row.id) ?? 0;
        const closing = r2(open + row.debit - row.credit);
        return {
          code: row.code,
          name: row.name,
          type: row.type,
          openingBalance: open,
          debit: row.debit,
          credit: row.credit,
          closingDebit: closing > 0 ? closing : 0,
          closingCredit: closing < 0 ? -closing : 0,
        };
      })
      .filter((row) => row.openingBalance || row.debit || row.credit);
    const totals = {
      debit: sum(rows, (row) => row.debit),
      credit: sum(rows, (row) => row.credit),
      closingDebit: sum(rows, (row) => row.closingDebit),
      closingCredit: sum(rows, (row) => row.closingCredit),
    };
    return {
      from,
      to,
      currency: settings.baseCurrency,
      rows,
      totals,
      isBalanced: Math.abs(totals.debit - totals.credit) < 0.005 && Math.abs(totals.closingDebit - totals.closingCredit) < 0.005,
    };
  }

  async profitAndLoss(from: string, to: string) {
    await this.posting.sync();
    const [rows, settings] = await Promise.all([this.totals(parseDay(from), parseDay(to)), this.books.settings()]);
    const section = (type: AccountType) =>
      rows
        .filter((row) => row.type === type)
        .map((row) => ({ code: row.code, name: row.name, amount: this.balanceOf(row) }))
        .filter((row) => row.amount !== 0);
    const revenue = section('revenue');
    const expenses = section('expense');
    const totalRevenue = sum(revenue, (row) => row.amount);
    const totalExpenses = sum(expenses, (row) => row.amount);
    return {
      from,
      to,
      currency: settings.baseCurrency,
      revenue,
      expenses,
      totalRevenue,
      totalExpenses,
      netProfit: r2(totalRevenue - totalExpenses),
    };
  }

  async balanceSheet(asOf: string) {
    await this.posting.sync();
    const date = parseDay(asOf);
    const yearStart = await this.fiscalYearStart(date);
    const [rows, priorRows, yearRows, settings] = await Promise.all([
      this.totals(undefined, date),
      this.totals(undefined, new Date(yearStart.getTime() - 86_400_000)),
      this.totals(yearStart, date),
      this.books.settings(),
    ]);
    // Profit is never closed by an entry: it is rolled into equity here.
    const profit = (list: AccountBalance[]) =>
      r2(list.filter((row) => row.type === 'revenue' || row.type === 'expense').reduce((total, row) => total + row.credit - row.debit, 0));
    const section = (type: AccountType) =>
      rows
        .filter((row) => row.type === type)
        .map((row) => ({ code: row.code, name: row.name, amount: this.balanceOf(row) }))
        .filter((row) => row.amount !== 0);
    const assets = section('asset');
    const liabilities = section('liability');
    const equity = section('equity');
    const prior = profit(priorRows);
    if (prior !== 0) equity.push({ code: '', name: 'Retained earnings from earlier years', amount: prior });
    equity.push({ code: '', name: `Profit for the year since ${isoDate(yearStart)}`, amount: profit(yearRows) });
    const totalAssets = sum(assets, (row) => row.amount);
    const totalLiabilities = sum(liabilities, (row) => row.amount);
    const totalEquity = sum(equity, (row) => row.amount);
    return {
      asOf,
      currency: settings.baseCurrency,
      assets,
      liabilities,
      equity,
      totalAssets,
      totalLiabilities,
      totalEquity,
      totalLiabilitiesAndEquity: r2(totalLiabilities + totalEquity),
      isBalanced: Math.abs(totalAssets - totalLiabilities - totalEquity) < 0.005,
    };
  }

  async journal(query: { from?: string; to?: string; source?: string; search?: string; page?: number; limit?: number }) {
    await this.posting.sync();
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(5000, Math.max(1, query.limit ?? 25));
    const search = query.search?.trim();
    const number = search ? Number(/^(?:JE-)?0*(\d{1,9})$/i.exec(search)?.[1] ?? Number.NaN) : Number.NaN;
    const booking = search ? Number(/^B-0*(\d{1,9})$/i.exec(search)?.[1] ?? Number.NaN) : Number.NaN;
    const where: Prisma.JournalEntryWhereInput = {
      ...(query.from || query.to
        ? { entryDate: { ...(query.from ? { gte: parseDay(query.from) } : {}), ...(query.to ? { lte: parseDay(query.to) } : {}) } }
        : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(search
        ? !Number.isNaN(booking)
          ? { bookingId: booking }
          : !Number.isNaN(number)
            ? { number }
            : { OR: [{ memo: { contains: search, mode: 'insensitive' } }, { reference: { contains: search, mode: 'insensitive' } }] }
        : {}),
    };
    const [total, entries, settings] = await Promise.all([
      this.prisma.journalEntry.count({ where }),
      this.prisma.journalEntry.findMany({
        where,
        include: { lines: { include: { account: { select: { code: true, name: true } } }, orderBy: { position: 'asc' } } },
        orderBy: [{ entryDate: 'desc' }, { number: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.books.settings(),
    ]);
    const reversed = new Set(
      (
        await this.prisma.journalEntry.findMany({
          where: { reversalOfId: { in: entries.map((entry) => entry.id) } },
          select: { reversalOfId: true },
        })
      ).map((row) => row.reversalOfId),
    );
    return {
      currency: settings.baseCurrency,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      items: entries.map((entry) => ({
        id: entry.id,
        number: entryCode(entry.number),
        date: isoDate(entry.entryDate),
        memo: entry.memo,
        source: entry.source,
        bookingId: entry.bookingId ? String(entry.bookingId) : null,
        reference: entry.reference,
        canReverse: ['manual', 'opening'].includes(entry.source) && !reversed.has(entry.id),
        isReversed: reversed.has(entry.id),
        total: sum(entry.lines, (line) => Number(line.debit)),
        lines: entry.lines.map((line) => ({
          accountCode: line.account.code,
          accountName: line.account.name,
          debit: Number(line.debit),
          credit: Number(line.credit),
          originalAmount: line.originalAmount === null ? null : Number(line.originalAmount),
          originalCurrency: line.originalCurrency,
        })),
      })),
    };
  }

  async generalLedger(accountCode: string, from: string, to: string) {
    await this.posting.sync();
    const account = await this.prisma.ledgerAccount.findUnique({ where: { code: accountCode } });
    if (!account) throw new NotFoundException('Account not found');
    const start = parseDay(from);
    const end = parseDay(to);
    const sign = DEBIT_NORMAL.has(account.type as AccountType) ? 1 : -1;
    const MAX = 3000;
    const [opening, lines, count, settings] = await Promise.all([
      this.prisma.journalLine.aggregate({
        where: { accountId: account.id, entry: { entryDate: { lt: start } } },
        _sum: { debit: true, credit: true },
      }),
      this.prisma.journalLine.findMany({
        where: { accountId: account.id, entry: { entryDate: { gte: start, lte: end } } },
        include: { entry: true },
        orderBy: [{ entry: { entryDate: 'asc' } }, { entry: { number: 'asc' } }],
        take: MAX,
      }),
      this.prisma.journalLine.count({ where: { accountId: account.id, entry: { entryDate: { gte: start, lte: end } } } }),
      this.books.settings(),
    ]);
    const openingBalance = r2(sign * (Number(opening._sum.debit ?? 0) - Number(opening._sum.credit ?? 0)));
    let running = openingBalance;
    const rows = lines.map((line) => {
      running = r2(running + sign * (Number(line.debit) - Number(line.credit)));
      return {
        date: isoDate(line.entry.entryDate),
        number: entryCode(line.entry.number),
        memo: line.entry.memo,
        bookingId: line.bookingId ? String(line.bookingId) : null,
        debit: Number(line.debit),
        credit: Number(line.credit),
        balance: running,
      };
    });
    return {
      account: { code: account.code, name: account.name, type: account.type },
      from,
      to,
      currency: settings.baseCurrency,
      openingBalance,
      rows,
      totalDebit: sum(rows, (row) => row.debit),
      totalCredit: sum(rows, (row) => row.credit),
      closingBalance: running,
      truncated: count > MAX,
    };
  }

  async vatReport(from: string, to: string) {
    await this.posting.sync();
    const range = { gte: parseDay(from), lte: parseDay(to) };
    const [lines, period, settings] = await Promise.all([
      this.prisma.journalLine.findMany({
        where: { account: { code: { in: [ACC.VatPayable, ACC.VatRecoverable] } }, entry: { entryDate: range } },
        include: { entry: true, account: { select: { code: true } } },
        orderBy: [{ entry: { entryDate: 'asc' } }, { entry: { number: 'asc' } }],
        take: 5000,
      }),
      this.totals(range.gte, range.lte),
      this.books.settings(),
    ]);
    // A manual debit to VAT payable is a payment to the tax office, not a change in VAT due on sales.
    const isPayment = (line: (typeof lines)[number]) =>
      line.account.code === ACC.VatPayable && line.entry.source === 'manual' && Number(line.debit) > 0;
    const rows = lines.map((line) => {
      const output = line.account.code === ACC.VatPayable && !isPayment(line) ? r2(Number(line.credit) - Number(line.debit)) : 0;
      const input = line.account.code === ACC.VatRecoverable ? r2(Number(line.debit) - Number(line.credit)) : 0;
      return {
        date: isoDate(line.entry.entryDate),
        number: entryCode(line.entry.number),
        memo: line.entry.memo,
        outputVat: output,
        inputVat: input,
        payment: isPayment(line) ? Number(line.debit) : 0,
      };
    });
    const outputVat = sum(rows, (row) => row.outputVat);
    const inputVat = sum(rows, (row) => row.inputVat);
    return {
      from,
      to,
      currency: settings.baseCurrency,
      outputVat,
      inputVat,
      netVatDue: r2(outputVat - inputVat),
      paidToTaxOffice: sum(rows, (row) => row.payment),
      netSalesRevenue: sum(
        period.filter((row) => row.type === 'revenue'),
        (row) => this.balanceOf(row),
      ),
      rows,
    };
  }

  /** Compares each control account with the live balances it mirrors. */
  async integrity() {
    const settings = await this.books.settings();
    const [rows, customerWallets, taskerWallets, receivables, customerWithdrawals, deposits, unbalanced] = await Promise.all([
      this.totals(),
      this.prisma.customerWallet.groupBy({ by: ['currency'], _sum: { availableBalance: true } }),
      this.prisma.taskerWallet.groupBy({ by: ['currency'], _sum: { availableBalance: true, pendingBalance: true } }),
      this.prisma.taskerPlatformAccount.groupBy({ by: ['currency'], _sum: { outstandingPayable: true } }),
      this.prisma.customerWithdrawal.groupBy({ by: ['currency'], where: { status: { in: ['pending_review', 'processing'] } }, _sum: { amount: true } }),
      this.prisma.taskerDeposit.groupBy({ by: ['currency'], where: { status: 'paid' }, _sum: { amount: true } }),
      this.prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count FROM (
          SELECT "entryId" FROM "JournalLines" GROUP BY "entryId" HAVING SUM("debit") <> SUM("credit")
        ) t`,
    ]);
    const live = <T extends { currency: string }>(list: T[], pick: (row: T) => Prisma.Decimal | null | undefined) =>
      r2(list.reduce((total, row) => total + this.books.convert(Number(pick(row) ?? 0), row.currency, settings.baseCurrency), 0));
    const booked = (code: string) => {
      const row = rows.find((entry) => entry.code === code);
      return row ? this.balanceOf(row) : 0;
    };
    const check = (code: string, label: string, actual: number) => {
      const ledger = booked(code);
      const difference = r2(ledger - actual);
      // Converting many records at static rates can leave a few cents.
      return { code, label, ledger, actual, difference, ok: Math.abs(difference) <= 0.05 };
    };
    const checks = [
      check(ACC.CustomerWallets, 'Customer wallets', live(customerWallets, (row) => row._sum.availableBalance)),
      check(ACC.TaskerAvailable, 'Tasker available balances', live(taskerWallets, (row) => row._sum.availableBalance)),
      check(ACC.TaskerClearing, 'Tasker clearing balances and payouts', live(taskerWallets, (row) => row._sum.pendingBalance)),
      check(ACC.CommissionReceivable, 'Cash commission owed by Taskers', live(receivables, (row) => row._sum.outstandingPayable)),
      check(ACC.CustomerWithdrawals, 'Customer withdrawals in process', live(customerWithdrawals, (row) => row._sum.amount)),
      check(ACC.TaskerDeposits, 'Tasker deposits held', live(deposits, (row) => row._sum.amount)),
      check(ACC.SettlementClearing, 'Settlement clearing (should be zero)', 0),
      check(ACC.Unmatched, 'Unmatched differences (should be zero)', 0),
    ];
    return {
      currency: settings.baseCurrency,
      unbalancedEntries: Number(unbalanced[0]?.count ?? 0),
      checks,
      ok: checks.every((row) => row.ok) && Number(unbalanced[0]?.count ?? 0) === 0,
    };
  }

  async overview() {
    await this.posting.sync();
    const today = dayOf(new Date());
    const yearStart = await this.fiscalYearStart(today);
    // One after another: each of these already runs several queries, and together they can drain the pool.
    const sheet = await this.balanceSheet(isoDate(today));
    const year = await this.profitAndLoss(isoDate(yearStart), isoDate(today));
    const integrity = await this.integrity();
    const settings = await this.books.settings();
    const entryCount = await this.prisma.journalEntry.count();
    const unpaid = await this.prisma.accountingExpense.aggregate({ where: { status: 'unpaid' }, _sum: { totalAmount: true }, _count: { _all: true } });
    return {
      currency: settings.baseCurrency,
      settings,
      yearStart: isoDate(yearStart),
      asOf: isoDate(today),
      totalAssets: sheet.totalAssets,
      totalLiabilities: sheet.totalLiabilities,
      totalEquity: sheet.totalEquity,
      isBalanced: sheet.isBalanced,
      revenue: year.totalRevenue,
      expenses: year.totalExpenses,
      netProfit: year.netProfit,
      entryCount,
      unpaidExpenses: { count: unpaid._count._all, total: r2(Number(unpaid._sum.totalAmount ?? 0)) },
      integrity,
    };
  }
}
