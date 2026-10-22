/**
 * One-off backfill for ticket 25.
 *
 * Context: before this fix, PlatformSettingsService stored
 * commission.{standardMinTaskPrice,goldMinTaskPrice,platinumMinTaskPrice,
 * diamondMinTaskPrice,minimumCommissionAmount} converted to USD on write
 * (convertPlatformAmountToUsd) and converted back to the platform's active
 * display currency on every read (convertUsdAmount). For a non-USD platform
 * currency (e.g. MAD, rate 9 from USD) this round-trip compounded rounding
 * error (entering 30 stored 3.33 USD, read back as 29.97).
 *
 * The code fix (platform-settings.service.ts) now stores and reads these 5
 * fields directly in the platform's active display currency, with no USD
 * conversion at all. That means the value CURRENTLY sitting in the
 * PlatformSetting('commission').value JSON column is still in the OLD format
 * (a USD amount) and needs to be converted to display currency exactly once,
 * so it keeps meaning what admins currently see on screen, and so all future
 * reads/writes (which no longer convert) stay numerically exact.
 *
 * This script performs that one-time conversion: for each of the 5 fields,
 * it takes the currently stored raw value (USD, pre-fix format) and
 * overwrites it with convertUsdAmount(value, currentPlatformCurrency) — the
 * exact same conversion the old serializeMonetarySection() used to apply on
 * every read — "locking in" today's displayed number as the new raw stored
 * value.
 *
 * HOW / WHEN TO RUN
 * ------------------
 * Run this EXACTLY ONCE, immediately after the code fix is deployed, and
 * BEFORE any admin opens/re-saves the commission settings screen (a save
 * before this script runs would persist values already in the new format,
 * and running the script afterwards would incorrectly re-convert them).
 *
 * This repo's other one-off scripts (see scripts/verify-project.ts) are
 * invoked via `node --import tsx <script>`, and prisma/seed.ts instantiates
 * PrismaClient directly against DATABASE_URL with the pg adapter — this
 * script follows the same pattern. Run with:
 *
 *   DATABASE_URL="<production connection string>" node --import tsx scripts/backfill-platform-settings-min-task-price.ts
 *
 * Add --dry-run to only print what would change without writing anything:
 *
 *   DATABASE_URL="..." node --import tsx scripts/backfill-platform-settings-min-task-price.ts --dry-run
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client';
import {
  PLATFORM_CURRENCY_PRESETS,
  usdAmountToPlatform,
} from '../src/modules/platform-settings/platform-currency.presets';
import type { PlatformMarket } from '../src/modules/platform-settings/platform-settings.types';

const FIELDS = [
  'standardMinTaskPrice',
  'goldMinTaskPrice',
  'platinumMinTaskPrice',
  'diamondMinTaskPrice',
  'minimumCommissionAmount',
] as const;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required to run this backfill');
}

const dryRun = process.argv.includes('--dry-run');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

function marketForCurrency(code: string): PlatformMarket {
  const normalized = code.toUpperCase();
  if (normalized === 'MAD') return 'morocco';
  if (normalized === 'PKR') return 'pakistan';
  if (normalized === 'EUR') return 'france';
  return 'us';
}

async function main(): Promise<void> {
  const [commissionRow, currencyRow] = await Promise.all([
    prisma.platformSetting.findUnique({ where: { key: 'commission' } }),
    prisma.platformSetting.findUnique({ where: { key: 'currency' } }),
  ]);

  if (!commissionRow) {
    console.log('No commission PlatformSetting row found; nothing to backfill.');
    return;
  }

  const currencyValue = (currencyRow?.value as Record<string, unknown> | undefined) ?? {};
  const market =
    (currencyValue.primaryMarket as PlatformMarket | undefined) ??
    marketForCurrency(String(currencyValue.primaryCurrency ?? 'USD'));
  const currency = PLATFORM_CURRENCY_PRESETS[market];

  console.log(`Active platform currency: ${currency.code} (rateFromUsd=${currency.rateFromUsd})`);

  const existing = commissionRow.value as Record<string, unknown>;
  const updated: Record<string, unknown> = { ...existing };
  let changedCount = 0;

  for (const field of FIELDS) {
    const raw = existing[field];
    if (typeof raw !== 'number') continue;
    const converted = usdAmountToPlatform(raw, currency);
    if (converted !== raw) changedCount += 1;
    updated[field] = converted;
    console.log(`  ${field}: ${raw} (old USD-stored) -> ${converted} (${currency.code}, locked in)`);
  }

  if (changedCount === 0) {
    console.log('No numeric change for any of the 5 fields (currency is USD, or values already 0).');
  }

  if (dryRun) {
    console.log('Dry run: no write performed.');
    return;
  }

  await prisma.platformSetting.update({
    where: { key: 'commission' },
    data: { value: updated as Prisma.InputJsonValue },
  });
  console.log('commission PlatformSetting row updated.');
}

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
