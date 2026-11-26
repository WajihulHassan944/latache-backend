import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { PLATFORM_CURRENCY_PRESETS } from '../platform-settings/platform-currency.presets';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { ACCOUNTING_SETTING_KEY, SYSTEM_CHART } from './accounting.constants';

export interface BookSettings {
  /** Fixed when the books are first opened. */
  baseCurrency: string;
  fiscalYearStartMonth: number;
  /** YYYY-MM-DD; nothing can be posted on or before this date. */
  booksClosedThrough: string | null;
}

/** The chart of accounts and the settings of the company books. */
@Injectable()
export class AccountingBooksService {
  private accounts: Map<string, string> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly platformSettings: PlatformSettingsService,
  ) {}

  async settings(): Promise<BookSettings> {
    const row = await this.prisma.platformSetting.findUnique({ where: { key: ACCOUNTING_SETTING_KEY } });
    const stored = (row?.value ?? null) as Partial<BookSettings> | null;
    if (stored?.baseCurrency) {
      return {
        baseCurrency: stored.baseCurrency,
        fiscalYearStartMonth: stored.fiscalYearStartMonth ?? 1,
        booksClosedThrough: stored.booksClosedThrough ?? null,
      };
    }
    const opened: BookSettings = {
      baseCurrency: (await this.platformSettings.currencyContext()).code,
      fiscalYearStartMonth: 1,
      booksClosedThrough: null,
    };
    await this.prisma.platformSetting.upsert({
      where: { key: ACCOUNTING_SETTING_KEY },
      create: { key: ACCOUNTING_SETTING_KEY, value: opened as unknown as Prisma.InputJsonValue },
      update: {},
    });
    return opened;
  }

  async saveSettings(next: BookSettings, actorId: number): Promise<BookSettings> {
    await this.prisma.platformSetting.update({
      where: { key: ACCOUNTING_SETTING_KEY },
      data: { value: next as unknown as Prisma.InputJsonValue, updatedById: actorId, version: { increment: 1 } },
    });
    return next;
  }

  /** Account code -> id, creating any missing built-in account. */
  async accountIds(): Promise<Map<string, string>> {
    if (!this.accounts) {
      const existing = await this.prisma.ledgerAccount.findMany({ select: { code: true } });
      const known = new Set(existing.map((row) => row.code));
      const missing = SYSTEM_CHART.filter((account) => !known.has(account.code));
      // Optional accounts are seeded once, with the first chart; deleting them sticks.
      const seed = missing.filter((account) => !account.optional || known.size === 0);
      if (seed.length > 0) {
        await this.prisma.ledgerAccount.createMany({
          skipDuplicates: true,
          data: seed.map((account) => ({
            code: account.code,
            name: account.name,
            type: account.type,
            description: account.description ?? null,
            isSystem: !account.optional,
            isControl: account.isControl ?? false,
            isCash: account.isCash ?? false,
          })),
        });
      }
    }
    const rows = await this.prisma.ledgerAccount.findMany({ select: { id: true, code: true } });
    this.accounts = new Map(rows.map((row) => [row.code, row.id]));
    return this.accounts;
  }

  /** Static platform rates, the same ones the finance overview uses. */
  convert(amount: number, from: string, to: string): number {
    if (from.toUpperCase() === to.toUpperCase()) return Math.round(amount * 100) / 100;
    const rate = (code: string) => {
      const preset = Object.values(PLATFORM_CURRENCY_PRESETS).find((entry) => entry.code === code.toUpperCase());
      if (!preset) throw new BadRequestException(`No exchange rate configured for ${code}`);
      return preset.rateFromUsd;
    };
    const value = (amount / rate(from)) * rate(to);
    return Math.sign(value) * (Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100);
  }
}
