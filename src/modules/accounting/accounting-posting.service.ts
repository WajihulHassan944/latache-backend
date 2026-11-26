import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { AccountingBooksService, type BookSettings } from './accounting-books.service';
import { ACC } from './accounting.constants';
import {
  customerWalletDraft,
  paymentDraft,
  platformLedgerDraft,
  recognitionDraft,
  taskerWalletDraft,
  type Draft,
} from './posting-rules';

const BATCH = 400;
const MIN_SYNC_GAP_MS = 15_000;
export const newId = (prefix: string) => `${prefix}_${randomBytes(15).toString('hex')}`;
export const dayOf = (date: Date) => new Date(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`);

/**
 * Builds the journal from the operational money records. Every source record is
 * booked at most once (unique sourceKey), so this is safe to run repeatedly and
 * also backfills history. Payment flows are never modified by accounting.
 */
@Injectable()
export class AccountingPostingService {
  private readonly logger = new Logger(AccountingPostingService.name);
  private running: Promise<{ posted: number }> | null = null;
  private lastRunAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly books: AccountingBooksService,
    ) {}

  /** Shared in-flight run; reports call this so they are never stale. */
  sync(force = false): Promise<{ posted: number }> {
    if (this.running) return this.running;
    if (!force && Date.now() - this.lastRunAt < MIN_SYNC_GAP_MS) return Promise.resolve({ posted: 0 });
    this.running = this.run().finally(() => {
      this.running = null;
      this.lastRunAt = Date.now();
    });
    return this.running;
  }

  private async run(): Promise<{ posted: number }> {
    const settings = await this.books.settings();
    const accounts = await this.books.accountIds();
    let posted = 0;
    for (const load of [
      () => this.customerWalletDrafts(),
      () => this.taskerWalletDrafts(),
      () => this.platformLedgerDrafts(),
      () => this.paymentDrafts(),
      () => this.customerWithdrawalDrafts(),
      () => this.settlementDrafts(),
      () => this.depositDrafts(),
      () => this.planDrafts(),
      // Last: it clears whatever the entries above left in "Booking funds held".
      () => this.recognitionDrafts(),
    ]) {
      // Loop until the source has no unposted records left.
      for (let pass = 0; pass < 100; pass += 1) {
        const drafts = await load();
        const inserted = await this.persist(drafts, settings, accounts);
        posted += inserted;
        if (inserted === 0 || drafts.length < BATCH) break;
      }
    }
    if (posted > 0) this.logger.log(`Posted ${posted} journal entries`);
    return { posted };
  }

  private async persist(drafts: Draft[], settings: BookSettings, accounts: Map<string, string>): Promise<number> {
    if (drafts.length === 0) return 0;
    const lockedThrough = settings.booksClosedThrough ? new Date(`${settings.booksClosedThrough}T00:00:00.000Z`) : null;
    const entries: Prisma.JournalEntryCreateManyInput[] = [];
    const linesByEntry = new Map<string, Prisma.JournalLineCreateManyInput[]>();
    for (const draft of drafts) {
      const converted = draft.lines.map((line) => ({
        ...line,
        value: this.books.convert(line.amount, draft.currency, settings.baseCurrency),
      }));
      // Currency conversion can leave a cent of difference: put it on the largest line.
      const difference = Math.round(converted.reduce((sum, line) => sum + line.value, 0) * 100) / 100;
      if (difference !== 0) {
        const largest = converted.reduce((a, b) => (Math.abs(b.value) > Math.abs(a.value) ? b : a));
        largest.value = Math.round((largest.value - difference) * 100) / 100;
      }
      const real = converted.filter((line) => line.value !== 0);
      if (real.length === 0) continue;

      let entryDate = dayOf(draft.date);
      let memo = draft.memo;
      if (lockedThrough && entryDate <= lockedThrough) {
        memo = `${memo} (dated ${entryDate.toISOString().slice(0, 10)}, posted after the period was closed)`;
        entryDate = new Date(lockedThrough.getTime() + 86_400_000);
      }
      const id = newId('je');
      entries.push({
        id,
        entryDate,
        memo: memo.slice(0, 500),
        source: 'auto',
        sourceType: draft.sourceType,
        sourceKey: draft.sourceKey,
        bookingId: draft.bookingId ?? null,
        reference: draft.reference?.slice(0, 255) ?? null,
      });
      linesByEntry.set(
        id,
        real.map((line, position) => {
          const accountId = accounts.get(line.account);
          if (!accountId) throw new Error(`Ledger account ${line.account} is missing`);
          const foreign = draft.currency.toUpperCase() !== settings.baseCurrency;
          return {
            id: newId('jl'),
            entryId: id,
            accountId,
            position,
            // Positive values are debits, negative values are credits.
            debit: (line.value > 0 ? line.value : 0).toFixed(2),
            credit: (line.value < 0 ? -line.value : 0).toFixed(2),
            bookingId: line.bookingId === undefined ? (draft.bookingId ?? null) : line.bookingId,
            originalAmount: foreign ? Math.abs(line.amount).toFixed(2) : null,
            originalCurrency: foreign ? draft.currency.toUpperCase() : null,
          };
        }),
      );
    }
    if (entries.length === 0) return 0;
    return this.prisma.$transaction(
      async (transaction) => {
        await transaction.journalEntry.createMany({ data: entries, skipDuplicates: true });
        // Only entries that were really inserted get lines (another worker may have won).
        const inserted = await transaction.journalEntry.findMany({
          where: { id: { in: entries.map((entry) => entry.id as string) } },
          select: { id: true },
        });
        await transaction.journalLine.createMany({ data: inserted.flatMap((row) => linesByEntry.get(row.id) ?? []) });
        return inserted.length;
      },
      { timeout: 60_000, maxWait: 20_000 },
    );
  }

  private async unposted<T>(table: string, prefix: string, where: Prisma.Sql, keySql?: Prisma.Sql): Promise<T[]> {
    const key = keySql ?? Prisma.sql`${prefix} || s."id"::text`;
    return this.prisma.$queryRaw<T[]>(Prisma.sql`
      SELECT s.* FROM ${Prisma.raw(`"${table}"`)} s
      WHERE ${where}
        AND NOT EXISTS (SELECT 1 FROM "JournalEntries" j WHERE j."sourceKey" = ${key})
      ORDER BY s."createdAt" ASC
      LIMIT ${BATCH}`);
  }

  private async customerWalletDrafts(): Promise<Draft[]> {
    const rows = await this.unposted<Parameters<typeof customerWalletDraft>[0]>('CustomerWalletLedger', 'cwl:', Prisma.sql`s."balanceDelta" <> 0`);
    return rows.map(customerWalletDraft);
  }

  private async taskerWalletDrafts(): Promise<Draft[]> {
    const rows = await this.unposted<Parameters<typeof taskerWalletDraft>[0]>(
      'TaskerWalletLedger',
      'twl:',
      Prisma.sql`(s."availableDelta" <> 0 OR s."pendingDelta" <> 0)`,
    );
    return rows.map(taskerWalletDraft);
  }

  private async platformLedgerDrafts(): Promise<Draft[]> {
    // earning_debt_offset is already booked by the matching wallet earning_release entry.
    const rows = await this.unposted<Parameters<typeof platformLedgerDraft>[0]>(
      'TaskerPlatformLedger',
      'tpl:',
      Prisma.sql`s."payableDelta" <> 0 AND s."kind" <> 'earning_debt_offset'`,
    );
    return rows.map(platformLedgerDraft);
  }

  private async paymentDrafts(): Promise<Draft[]> {
    // Wallet movements are booked from the wallet ledgers; here only real card money.
    const rows = await this.unposted<Parameters<typeof paymentDraft>[0]>(
      'PaymentTransactions',
      'pay:',
      Prisma.sql`s."status" = 'succeeded' AND s."amount" > 0
        AND s."provider" IN ('stripe', 'cmi') AND s."kind" IN ('booking_charge', 'refund', 'chargeback')`,
    );
    return rows.map(paymentDraft);
  }

  private async customerWithdrawalDrafts(): Promise<Draft[]> {
    const rows = await this.unposted<{ id: string; amount: Prisma.Decimal; currency: string; processedAt: Date | null; updatedAt: Date; providerReference: string | null }>(
      'CustomerWithdrawals',
      'cwd:',
      Prisma.sql`s."status" = 'paid'`,
    );
    return rows.map((row) => ({
      sourceType: 'customer_withdrawal',
      sourceKey: `cwd:${row.id}`,
      date: row.processedAt ?? row.updatedAt,
      memo: 'Customer wallet withdrawal paid by bank transfer',
      currency: row.currency,
      reference: row.providerReference,
      lines: [
        { account: ACC.CustomerWithdrawals, amount: Number(row.amount) },
        { account: ACC.Bank, amount: -Number(row.amount) },
      ],
    }));
  }

  private async settlementDrafts(): Promise<Draft[]> {
    const rows = await this.unposted<{ id: string; method: string; amount: Prisma.Decimal; currency: string; completedAt: Date | null; updatedAt: Date; providerReference: string | null; externalReference: string | null }>(
      'TaskerPlatformSettlements',
      'stl:',
      Prisma.sql`s."status" = 'completed' AND s."method" <> 'wallet' AND s."amount" > 0`,
    );
    return rows.map((row) => ({
      sourceType: 'tasker_settlement',
      sourceKey: `stl:${row.id}`,
      date: row.completedAt ?? row.updatedAt,
      memo: `Tasker paid cash commission to the platform (${row.method.replace(/_/g, ' ')})`,
      currency: row.currency,
      reference: row.providerReference ?? row.externalReference,
      lines: [
        { account: /card|stripe/.test(row.method) ? ACC.Stripe : ACC.Bank, amount: Number(row.amount) },
        { account: ACC.SettlementClearing, amount: -Number(row.amount) },
      ],
    }));
  }

  private async depositDrafts(): Promise<Draft[]> {
    type Row = { id: string; taskerId: number; amount: Prisma.Decimal; currency: string; paymentMethod: string | null; providerReference: string | null; paidAt: Date | null; refundedAt: Date | null; status: string };
    const money = (row: Row) => (row.paymentMethod === 'stripe' ? ACC.Stripe : row.paymentMethod === 'cmi' ? ACC.Cmi : ACC.Bank);
    const paid = await this.unposted<Row>('TaskerDeposits', 'dep-paid:', Prisma.sql`s."paidAt" IS NOT NULL`);
    const refunded = await this.unposted<Row>('TaskerDeposits', 'dep-refund:', Prisma.sql`s."refundedAt" IS NOT NULL AND s."paidAt" IS NOT NULL`);
    return [
      ...paid.map((row) => ({
        sourceType: 'tasker_deposit',
        sourceKey: `dep-paid:${row.id}`,
        date: row.paidAt as Date,
        memo: `Tasker signup deposit received (Tasker #${row.taskerId})`,
        currency: row.currency,
        reference: row.providerReference,
        lines: [
          { account: money(row), amount: Number(row.amount) },
          { account: ACC.TaskerDeposits, amount: -Number(row.amount) },
        ],
      })),
      ...refunded.map((row) => ({
        sourceType: 'tasker_deposit_refund',
        sourceKey: `dep-refund:${row.id}`,
        date: row.refundedAt as Date,
        memo: `Tasker signup deposit refunded (Tasker #${row.taskerId})`,
        currency: row.currency,
        reference: row.providerReference,
        lines: [
          { account: ACC.TaskerDeposits, amount: Number(row.amount) },
          { account: ACC.Bank, amount: -Number(row.amount) },
        ],
      })),
    ];
  }

  /**
   * Card-paid Tasker plans leave no payment row; the subscription carries the
   * latest charge reference, which changes on every renewal.
   */
  private async planDrafts(): Promise<Draft[]> {
    type Row = { id: string; taskerId: number; planId: string; priceAmount: Prisma.Decimal; currency: string; paymentReference: string; status: string; activatedAt: Date | null; endedAt: Date | null; updatedAt: Date; purchasedAt: Date };
    const where = Prisma.sql`s."paymentMethod" = 'stripe' AND s."paymentReference" IS NOT NULL`;
    const charges = await this.unposted<Row>('TaskerSubscriptions', '', where, Prisma.sql`'plan-card:' || s."paymentReference"`);
    const refunds = await this.unposted<Row>(
      'TaskerSubscriptions',
      'plan-card-refund:',
      Prisma.sql`${where} AND s."activatedAt" IS NULL AND s."status" IN ('rejected', 'cancelled')`,
    );
    const line = (row: Row, sign: 1 | -1) => [
      { account: ACC.Stripe, amount: sign * Number(row.priceAmount) },
      { account: ACC.PlanRevenue, amount: -sign * Number(row.priceAmount) },
    ];
    return [
      ...charges.map((row) => ({
        sourceType: 'tasker_plan_card',
        sourceKey: `plan-card:${row.paymentReference}`,
        date: row.activatedAt && row.activatedAt > row.purchasedAt ? row.updatedAt : row.purchasedAt,
        memo: `Tasker ${row.planId} plan paid by card (Tasker #${row.taskerId})`,
        currency: row.currency,
        reference: row.paymentReference,
        lines: line(row, 1),
      })),
      ...refunds.map((row) => ({
        sourceType: 'tasker_plan_card_refund',
        sourceKey: `plan-card-refund:${row.id}`,
        date: row.endedAt ?? row.updatedAt,
        memo: `Tasker ${row.planId} plan card payment refunded (Tasker #${row.taskerId})`,
        currency: row.currency,
        reference: row.paymentReference,
        lines: line(row, -1),
      })),
    ];
  }

  /**
   * A finished booking must hold no customer money: whatever stays in "Booking
   * funds held" is the platform's share (fee, VAT, ...), or a refund it absorbed.
   */
  private async recognitionDrafts(): Promise<Draft[]> {
    const settings = await this.books.settings();
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      WITH held AS (
        SELECT l."bookingId" AS id, SUM(l."credit" - l."debit") AS balance, MAX(e."entryDate") AS last_date
        FROM "JournalLines" l
        JOIN "JournalEntries" e ON e."id" = l."entryId"
        JOIN "LedgerAccounts" a ON a."id" = l."accountId"
        WHERE a."code" = ${ACC.BookingFunds} AND l."bookingId" IS NOT NULL
        GROUP BY l."bookingId"
        HAVING SUM(l."credit" - l."debit") <> 0
      )
      SELECT b."id", b."status", b."paymentStatus", b."paymentCurrency", b."taxAmount", b."donationAmount",
             b."serviceSurchargeAmount", h.balance, h.last_date,
             (SELECT COUNT(*)::int FROM "JournalEntries" j WHERE j."sourceType" = 'booking_settlement' AND j."bookingId" = b."id") AS previous,
             EXISTS (SELECT 1 FROM "PaymentTransactions" p WHERE p."bookingId" = b."id" AND p."kind" = 'refund' AND p."status" = 'succeeded') AS refunded
      FROM held h JOIN "Bookings" b ON b."id" = h.id
      WHERE (
          (b."status" = 'completed' AND b."paymentStatus" IN ('paid', 'cash_confirmed', 'partially_refunded', 'refunded'))
          OR (b."status" = 'cancelled' AND b."paymentStatus" <> 'refund_pending')
        )
        AND NOT EXISTS (SELECT 1 FROM "PaymentTransactions" p WHERE p."bookingId" = b."id" AND p."kind" = 'refund' AND p."status" IN ('pending', 'processing'))
      LIMIT ${BATCH}`);
    return rows.map((row) => recognitionDraft(row as never, settings.baseCurrency));
  }
}
