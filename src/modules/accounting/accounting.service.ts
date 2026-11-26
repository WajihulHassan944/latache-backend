import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { hasPrismaErrorCode } from '../../database/prisma-error.util';
import { AdminAuditService } from '../admin-audit/admin-audit.service';
import { AccountingBooksService } from './accounting-books.service';
import { AccountingPostingService, dayOf, newId } from './accounting-posting.service';
import { entryCode, parseDay } from './accounting-reports.service';
import { ACC, ACCOUNTING_SETTING_KEY } from './accounting.constants';
import type {
  CreateAccountDto,
  CreateEntryDto,
  CreateExpenseDto,
  ExpenseQueryDto,
  PayExpenseDto,
  ReverseEntryDto,
  UpdateAccountDto,
} from './accounting.dto';

const cents = (value: number) => Math.round(value * 100);
const isoDate = (date: Date) => date.toISOString().slice(0, 10);

interface PostLine {
  accountId: string;
  debit: number;
  credit: number;
  memo?: string | null;
}

/** Everything an accountant types in: accounts, journal entries, expenses and period closing. */
@Injectable()
export class AccountingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly books: AccountingBooksService,
    private readonly posting: AccountingPostingService,
    private readonly audit: AdminAuditService,
  ) {}

  async createAccount(actorId: number, dto: CreateAccountDto) {
    await this.books.accountIds();
    if (dto.isCash && dto.type !== 'asset') throw new BadRequestException('Only an asset account can be a money account');
    try {
      const account = await this.prisma.ledgerAccount.create({
        data: { code: dto.code, name: dto.name.trim(), type: dto.type, description: dto.description?.trim() || null, isCash: dto.isCash ?? false },
      });
      await this.audit.record({ actorId, action: 'accounting_account_created', entityType: 'ledger_account', entityId: account.id, metadata: { code: account.code } });
      return account;
    } catch (error) {
      if (hasPrismaErrorCode(error, 'P2002')) throw new ConflictException(`Account code ${dto.code} already exists`);
      throw error;
    }
  }

  async updateAccount(actorId: number, code: string, dto: UpdateAccountDto) {
    const account = await this.prisma.ledgerAccount.findUnique({ where: { code } });
    if (!account) throw new NotFoundException('Account not found');
    if (dto.isActive === false) {
      if (account.isSystem) throw new ConflictException('Built-in accounts cannot be deactivated');
      const totals = await this.prisma.journalLine.aggregate({ where: { accountId: account.id }, _sum: { debit: true, credit: true } });
      if (cents(Number(totals._sum.debit ?? 0)) !== cents(Number(totals._sum.credit ?? 0))) {
        throw new ConflictException('Move the balance to another account before deactivating this one');
      }
    }
    const updated = await this.prisma.ledgerAccount.update({
      where: { code },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
        ...(dto.description === undefined ? {} : { description: dto.description.trim() || null }),
        ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
      },
    });
    await this.audit.record({ actorId, action: 'accounting_account_updated', entityType: 'ledger_account', entityId: account.id, metadata: { code, ...dto } });
    return updated;
  }

  private async assertOpenDate(date: Date): Promise<void> {
    const { booksClosedThrough } = await this.books.settings();
    if (booksClosedThrough && date <= parseDay(booksClosedThrough)) {
      throw new ConflictException({
        code: 'ACCOUNTING_PERIOD_CLOSED',
        message: `The books are closed through ${booksClosedThrough}. Use a later date or reopen the period.`,
      });
    }
    if (date > new Date(dayOf(new Date()).getTime() + 86_400_000)) {
      throw new BadRequestException('Journal entries cannot be dated in the future');
    }
  }

  private async account(code: string) {
    const account = await this.prisma.ledgerAccount.findUnique({ where: { code } });
    if (!account) throw new BadRequestException(`Unknown account ${code}`);
    if (!account.isActive) throw new BadRequestException(`Account ${code} is inactive`);
    return account;
  }

  private async cashAccount(code: string) {
    const account = await this.account(code);
    if (!account.isCash) throw new BadRequestException(`${account.name} is not a money account`);
    return account;
  }

  private write(
    transaction: Prisma.TransactionClient,
    entry: { date: Date; memo: string; source: string; createdById: number; reference?: string | null; reversalOfId?: string; sourceType?: string; sourceKey?: string },
    lines: PostLine[],
  ) {
    return transaction.journalEntry.create({
      data: {
        id: newId('je'),
        entryDate: entry.date,
        memo: entry.memo.slice(0, 500),
        source: entry.source,
        sourceType: entry.sourceType ?? null,
        sourceKey: entry.sourceKey ?? null,
        reference: entry.reference ?? null,
        reversalOfId: entry.reversalOfId ?? null,
        createdById: entry.createdById,
        lines: {
          create: lines.map((line, position) => ({
            id: newId('jl'),
            accountId: line.accountId,
            position,
            debit: line.debit.toFixed(2),
            credit: line.credit.toFixed(2),
            memo: line.memo ?? null,
          })),
        },
      },
    });
  }

  async createEntry(actorId: number, dto: CreateEntryDto) {
    await this.books.accountIds();
    const date = parseDay(dto.date);
    await this.assertOpenDate(date);
    const lines: PostLine[] = [];
    for (const line of dto.lines) {
      if ((line.debit > 0) === (line.credit > 0)) {
        throw new BadRequestException('Each line needs either a debit or a credit');
      }
      const account = await this.account(line.accountCode);
      if (account.isControl) {
        throw new BadRequestException(
          `${account.name} is updated automatically from wallets and payments, so it cannot be posted to by hand`,
        );
      }
      lines.push({ accountId: account.id, debit: line.debit, credit: line.credit, memo: line.memo?.trim() || null });
    }
    const difference = lines.reduce((total, line) => total + cents(line.debit) - cents(line.credit), 0);
    if (difference !== 0) {
      throw new BadRequestException({
        code: 'ACCOUNTING_ENTRY_UNBALANCED',
        message: `Debits and credits must be equal (difference ${(difference / 100).toFixed(2)})`,
      });
    }
    return this.prisma.$transaction(async (transaction) => {
      const entry = await this.write(
        transaction,
        { date, memo: dto.memo.trim(), source: dto.type, createdById: actorId, reference: dto.reference?.trim() || null },
        lines,
      );
      await this.audit.record({ actorId, action: 'accounting_entry_created', entityType: 'journal_entry', entityId: entry.id }, transaction);
      return { id: entry.id, number: entryCode(entry.number) };
    });
  }

  private async mirror(
    transaction: Prisma.TransactionClient,
    originalId: string,
    input: { date: Date; memo: string; actorId: number; source: string; linkAsReversal: boolean; sourceKey?: string },
  ) {
    const lines = await transaction.journalLine.findMany({ where: { entryId: originalId }, orderBy: { position: 'asc' } });
    return this.write(
      transaction,
      {
        date: input.date,
        memo: input.memo,
        source: input.source,
        createdById: input.actorId,
        reversalOfId: input.linkAsReversal ? originalId : undefined,
        sourceKey: input.sourceKey,
      },
      lines.map((line) => ({ accountId: line.accountId, debit: Number(line.credit), credit: Number(line.debit), memo: line.memo })),
    );
  }

  async reverseEntry(actorId: number, id: string, dto: ReverseEntryDto) {
    const original = await this.prisma.journalEntry.findUnique({ where: { id } });
    if (!original) throw new NotFoundException('Journal entry not found');
    if (!['manual', 'opening'].includes(original.source)) {
      throw new ConflictException('Only manual and opening entries can be reversed. Expenses are voided from the Expenses tab.');
    }
    const date = parseDay(dto.date);
    await this.assertOpenDate(date);
    if (date < original.entryDate) throw new BadRequestException('A reversal cannot be dated before the original entry');
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const entry = await this.mirror(transaction, id, {
          date,
          memo: `Reversal of ${entryCode(original.number)}: ${dto.reason.trim()}`,
          actorId,
          source: 'reversal',
          linkAsReversal: true,
        });
        await this.audit.record({ actorId, action: 'accounting_entry_reversed', entityType: 'journal_entry', entityId: id, reason: dto.reason }, transaction);
        return { id: entry.id, number: entryCode(entry.number) };
      });
    } catch (error) {
      if (hasPrismaErrorCode(error, 'P2002')) throw new ConflictException('This entry was already reversed');
      throw error;
    }
  }

  async listExpenses(query: ExpenseQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const where: Prisma.AccountingExpenseWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? { expenseDate: { ...(query.from ? { gte: parseDay(query.from) } : {}), ...(query.to ? { lte: parseDay(query.to) } : {}) } }
        : {}),
    };
    const [total, rows, sums, settings] = await Promise.all([
      this.prisma.accountingExpense.count({ where }),
      this.prisma.accountingExpense.findMany({
        where,
        include: { account: { select: { code: true, name: true } }, paidFrom: { select: { code: true, name: true } } },
        orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.accountingExpense.groupBy({ by: ['status'], where, _sum: { totalAmount: true }, _count: { _all: true } }),
      this.books.settings(),
    ]);
    return {
      currency: settings.baseCurrency,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      summary: sums.map((row) => ({ status: row.status, count: row._count._all, total: Number(row._sum.totalAmount ?? 0) })),
      items: rows.map((row) => ({
        id: row.id,
        date: isoDate(row.expenseDate),
        vendor: row.vendor,
        description: row.description,
        category: row.account,
        netAmount: Number(row.netAmount),
        vatAmount: Number(row.vatAmount),
        totalAmount: Number(row.totalAmount),
        currency: row.currency,
        status: row.status,
        paidFrom: row.paidFrom,
        paidDate: row.paidDate ? isoDate(row.paidDate) : null,
        reference: row.reference,
        voidReason: row.voidReason,
      })),
    };
  }

  async createExpense(actorId: number, dto: CreateExpenseDto) {
    const accounts = await this.books.accountIds();
    const settings = await this.books.settings();
    const date = parseDay(dto.date);
    await this.assertOpenDate(date);
    const category = await this.account(dto.accountCode);
    if (category.type !== 'expense' && category.type !== 'asset') {
      throw new BadRequestException('Pick an expense account (or an asset account for a purchase)');
    }
    if (category.isControl || category.isCash) throw new BadRequestException(`${category.name} cannot be used as an expense category`);
    const paidFrom = dto.paidFromCode ? await this.cashAccount(dto.paidFromCode) : null;
    const vat = dto.vatAmount ?? 0;
    const total = (cents(dto.netAmount) + cents(vat)) / 100;
    const id = newId('exp');
    const credit = paidFrom?.id ?? (accounts.get(ACC.AccountsPayable) as string);
    return this.prisma.$transaction(async (transaction) => {
      await transaction.accountingExpense.create({
        data: {
          id,
          expenseDate: date,
          accountId: category.id,
          vendor: dto.vendor.trim(),
          description: dto.description.trim(),
          netAmount: dto.netAmount.toFixed(2),
          vatAmount: vat.toFixed(2),
          totalAmount: total.toFixed(2),
          currency: settings.baseCurrency,
          status: paidFrom ? 'paid' : 'unpaid',
          paidFromId: paidFrom?.id ?? null,
          paidDate: paidFrom ? date : null,
          reference: dto.reference?.trim() || null,
          createdById: actorId,
        },
      });
      await this.write(
        transaction,
        { date, memo: `Expense: ${dto.vendor.trim()} - ${dto.description.trim()}`, source: 'expense', sourceType: 'expense', sourceKey: `expense:${id}`, createdById: actorId, reference: dto.reference?.trim() || null },
        [
          { accountId: category.id, debit: dto.netAmount, credit: 0 },
          ...(vat > 0 ? [{ accountId: accounts.get(ACC.VatRecoverable) as string, debit: vat, credit: 0 }] : []),
          { accountId: credit, debit: 0, credit: total },
        ],
      );
      await this.audit.record({ actorId, action: 'accounting_expense_created', entityType: 'accounting_expense', entityId: id, metadata: { total } }, transaction);
      return { id };
    });
  }

  async payExpense(actorId: number, id: string, dto: PayExpenseDto) {
    const accounts = await this.books.accountIds();
    const date = parseDay(dto.date);
    await this.assertOpenDate(date);
    const paidFrom = await this.cashAccount(dto.paidFromCode);
    return this.prisma.$transaction(async (transaction) => {
      const expense = await transaction.accountingExpense.findUnique({ where: { id } });
      if (!expense) throw new NotFoundException('Expense not found');
      if (date < expense.expenseDate) throw new BadRequestException('Payment cannot be dated before the expense');
      const claimed = await transaction.accountingExpense.updateMany({
        where: { id, status: 'unpaid' },
        data: { status: 'paid', paidFromId: paidFrom.id, paidDate: date },
      });
      if (claimed.count === 0) throw new ConflictException(`Expense is ${expense.status}, not unpaid`);
      const total = Number(expense.totalAmount);
      await this.write(
        transaction,
        { date, memo: `Expense paid: ${expense.vendor} - ${expense.description}`, source: 'expense', sourceType: 'expense_payment', sourceKey: `expense-payment:${id}`, createdById: actorId },
        [
          { accountId: accounts.get(ACC.AccountsPayable) as string, debit: total, credit: 0 },
          { accountId: paidFrom.id, debit: 0, credit: total },
        ],
      );
      await this.audit.record({ actorId, action: 'accounting_expense_paid', entityType: 'accounting_expense', entityId: id }, transaction);
      return { id };
    });
  }

  async voidExpense(actorId: number, id: string, reason: string) {
    const today = dayOf(new Date());
    await this.assertOpenDate(today);
    return this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.accountingExpense.updateMany({
        where: { id, status: { in: ['paid', 'unpaid'] } },
        data: { status: 'void', voidReason: reason.trim() },
      });
      if (claimed.count === 0) throw new ConflictException('Expense not found or already void');
      const entries = await transaction.journalEntry.findMany({ where: { sourceKey: { in: [`expense:${id}`, `expense-payment:${id}`] } } });
      for (const entry of entries) {
        await this.mirror(transaction, entry.id, {
          date: today > entry.entryDate ? today : entry.entryDate,
          memo: `Void of ${entryCode(entry.number)}: ${reason.trim()}`,
          actorId,
          source: 'reversal',
          linkAsReversal: true,
        });
      }
      await this.audit.record({ actorId, action: 'accounting_expense_voided', entityType: 'accounting_expense', entityId: id, reason }, transaction);
      return { id };
    });
  }

  async updateSettings(actorId: number, fiscalYearStartMonth?: number) {
    const current = await this.books.settings();
    const next = await this.books.saveSettings(
      { ...current, fiscalYearStartMonth: fiscalYearStartMonth ?? current.fiscalYearStartMonth },
      actorId,
    );
    await this.audit.record({ actorId, action: 'accounting_settings_updated', entityType: 'platform_setting', entityId: ACCOUNTING_SETTING_KEY, metadata: { ...next } });
    return next;
  }

  async closePeriod(actorId: number, through: string | null) {
    const current = await this.books.settings();
    if (through) {
      if (parseDay(through) >= dayOf(new Date())) throw new BadRequestException('Only periods before today can be closed');
      // Book everything that already happened before locking the dates.
      await this.posting.sync(true);
    }
    const next = await this.books.saveSettings({ ...current, booksClosedThrough: through }, actorId);
    await this.audit.record({
      actorId,
      action: through ? 'accounting_period_closed' : 'accounting_periods_reopened',
      entityType: 'platform_setting',
      entityId: ACCOUNTING_SETTING_KEY,
      metadata: { from: current.booksClosedThrough, to: through },
    });
    return next;
  }
}
