import { BadRequestException, Injectable } from '@nestjs/common';
import type Stripe from 'stripe';
import { PrismaService } from '../../database/prisma.service';
import { StripeService } from '../payments/stripe.service';

const MAX_STRIPE_OBJECTS = 5_000;
const r2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
/** Stripe zero-decimal currencies are not used by Latache (USD/EUR/MAD/PKR are all 2-decimal). */
const fromMinor = (amount: number): number => r2(amount / 100);

type Issue = { reference: string; type: string; ledgerAmount: number | null; stripeAmount: number | null; currency: string; bookingId: number | null; createdAt: string; detail: string };

/**
 * Compares what Stripe actually charged/refunded with the PaymentTransactions
 * ledger for a period, so finance can catch payments that never reached the
 * ledger (e.g. a missed webhook), ledger rows Stripe does not know, and amount
 * drift. CMI has no pull API here, so CMI orders get a status health check.
 */
@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {}

  private period(from: string, to: string) {
    const gte = new Date(`${from}T00:00:00.000Z`);
    const lte = new Date(`${to}T23:59:59.999Z`);
    if (Number.isNaN(gte.getTime()) || Number.isNaN(lte.getTime()) || gte > lte) {
      throw new BadRequestException('from/to must be YYYY-MM-DD with from <= to');
    }
    if (lte.getTime() - gte.getTime() > 93 * 86_400_000) throw new BadRequestException('Reconcile at most ~3 months at a time');
    return { gte, lte };
  }

  async stripeReport(from: string, to: string) {
    const { gte, lte } = this.period(from, to);
    const client = this.stripe.client();
    const created = { gte: Math.floor(gte.getTime() / 1000), lte: Math.floor(lte.getTime() / 1000) };

    const charges: Stripe.Charge[] = [];
    for await (const charge of client.charges.list({ created, limit: 100 })) {
      charges.push(charge);
      if (charges.length >= MAX_STRIPE_OBJECTS) break;
    }
    const refunds: Stripe.Refund[] = [];
    for await (const refund of client.refunds.list({ created, limit: 100 })) {
      refunds.push(refund);
      if (refunds.length >= MAX_STRIPE_OBJECTS) break;
    }

    // Ledger rows with a 2-day buffer either side (webhooks can land after midnight).
    const buffer = 2 * 86_400_000;
    const ledger = await this.prisma.paymentTransaction.findMany({
      where: { provider: 'stripe', createdAt: { gte: new Date(gte.getTime() - buffer), lte: new Date(lte.getTime() + buffer) } },
      select: { id: true, kind: true, status: true, amount: true, currency: true, providerReference: true, bookingId: true, createdAt: true },
    });
    const ledgerByRef = new Map(ledger.filter((row) => row.providerReference).map((row) => [row.providerReference as string, row]));

    // One Stripe account can serve several environments (e.g. staging + prod on test keys):
    // only objects for this environment's Stripe customers are reconciled.
    const ownCustomers = new Set(
      (await this.prisma.user.findMany({ where: { stripeCustomerId: { not: null } }, select: { stripeCustomerId: true } }))
        .map((row) => row.stripeCustomerId as string),
    );
    const customerOf = (value: string | Stripe.Customer | Stripe.DeletedCustomer | null) =>
      typeof value === 'string' ? value : (value?.id ?? null);
    const chargeById = new Map(charges.map((charge) => [charge.id, charge]));
    let otherEnvironmentCharges = 0;
    let otherEnvironmentRefunds = 0;

    const issues: Issue[] = [];
    let matchedCharges = 0;
    let matchedChargeAmount = 0;
    const seenRefs = new Set<string>();
    for (const charge of charges) {
      if (charge.status !== 'succeeded') continue;
      const customer = customerOf(charge.customer);
      if (!customer || !ownCustomers.has(customer)) {
        otherEnvironmentCharges += 1;
        continue;
      }
      const intentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
      const reference = intentId ?? charge.id;
      seenRefs.add(reference);
      const row = ledgerByRef.get(reference);
      const stripeAmount = fromMinor(charge.amount_captured || charge.amount);
      const base = { reference, stripeAmount, currency: charge.currency.toUpperCase(), createdAt: new Date(charge.created * 1000).toISOString() };
      if (!row) {
        issues.push({ ...base, type: 'charge_missing_in_ledger', ledgerAmount: null, bookingId: Number(charge.metadata?.latacheBookingId) || null, detail: `Stripe charged ${charge.id} (${charge.metadata?.kind ?? 'no kind'}) but no ledger row references it.` });
      } else if (row.status !== 'succeeded' && row.status !== 'refunded') {
        issues.push({ ...base, type: 'charge_status_mismatch', ledgerAmount: Number(row.amount), bookingId: row.bookingId, detail: `Stripe succeeded but the ledger says "${row.status}".` });
      } else if (Math.abs(Number(row.amount) - stripeAmount) > 0.009) {
        issues.push({ ...base, type: 'charge_amount_mismatch', ledgerAmount: Number(row.amount), bookingId: row.bookingId, detail: 'Amounts differ.' });
      } else {
        matchedCharges += 1;
        matchedChargeAmount += stripeAmount;
      }
    }

    let matchedRefunds = 0;
    let matchedRefundAmount = 0;
    for (const refund of refunds) {
      if (refund.status !== 'succeeded' && refund.status !== 'pending') continue;
      const refundedCharge = typeof refund.charge === 'string' ? chargeById.get(refund.charge) : refund.charge ?? undefined;
      const refundCustomer = refundedCharge ? customerOf(refundedCharge.customer) : null;
      if (refundedCharge && (!refundCustomer || !ownCustomers.has(refundCustomer))) {
        otherEnvironmentRefunds += 1;
        continue;
      }
      seenRefs.add(refund.id);
      const row = ledgerByRef.get(refund.id);
      const stripeAmount = fromMinor(refund.amount);
      const base = { reference: refund.id, stripeAmount, currency: refund.currency.toUpperCase(), createdAt: new Date(refund.created * 1000).toISOString() };
      if (!row) {
        issues.push({ ...base, type: 'refund_missing_in_ledger', ledgerAmount: null, bookingId: Number(refund.metadata?.latacheBookingId) || null, detail: `Stripe refund (${refund.metadata?.kind ?? 'no kind'}) not found in the ledger.` });
      } else if (Math.abs(Number(row.amount) - stripeAmount) > 0.009) {
        issues.push({ ...base, type: 'refund_amount_mismatch', ledgerAmount: Number(row.amount), bookingId: row.bookingId, detail: 'Amounts differ.' });
      } else {
        matchedRefunds += 1;
        matchedRefundAmount += stripeAmount;
      }
    }

    // Ledger says succeeded inside the period, but Stripe returned nothing for it.
    for (const row of ledger) {
      if (!row.providerReference || row.createdAt < gte || row.createdAt > lte) continue;
      if (row.status !== 'succeeded') continue;
      if (seenRefs.has(row.providerReference)) continue;
      issues.push({
        reference: row.providerReference,
        type: 'ledger_missing_in_stripe',
        ledgerAmount: Number(row.amount),
        stripeAmount: null,
        currency: row.currency,
        bookingId: row.bookingId,
        createdAt: row.createdAt.toISOString(),
        detail: `Ledger ${row.kind} ${row.id} is succeeded but Stripe returned no matching object in this period.`,
      });
    }

    return {
      provider: 'stripe',
      period: { from, to },
      stripe: {
        succeededCharges: charges.filter((c) => c.status === 'succeeded').length,
        refunds: refunds.length,
        truncated: charges.length >= MAX_STRIPE_OBJECTS || refunds.length >= MAX_STRIPE_OBJECTS,
        skippedOtherEnvironment: { charges: otherEnvironmentCharges, refunds: otherEnvironmentRefunds },
      },
      matched: { charges: matchedCharges, chargeAmount: r2(matchedChargeAmount), refunds: matchedRefunds, refundAmount: r2(matchedRefundAmount) },
      issueCount: issues.length,
      balanced: issues.length === 0,
      issues: issues.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    };
  }

  /** CMI health: abandoned orders (no callback), declines, and paid volume. */
  async cmiReport(from: string, to: string) {
    const { gte, lte } = this.period(from, to);
    const rows = await this.prisma.paymentTransaction.findMany({
      where: { provider: 'cmi', createdAt: { gte, lte } },
      select: { id: true, kind: true, status: true, amount: true, currency: true, idempotencyKey: true, failureReason: true, createdAt: true, customerId: true },
      orderBy: { createdAt: 'asc' },
    });
    const staleBefore = Date.now() - 60 * 60_000;
    const totals = new Map<string, { count: number; amount: number }>();
    for (const row of rows) {
      const key = `${row.status}:${row.currency}`;
      const t = totals.get(key) ?? { count: 0, amount: 0 };
      t.count += 1;
      t.amount = r2(t.amount + Number(row.amount));
      totals.set(key, t);
    }
    return {
      provider: 'cmi',
      period: { from, to },
      totals: [...totals.entries()].map(([key, t]) => ({ status: key.split(':')[0], currency: key.split(':')[1], ...t })),
      abandoned: rows
        .filter((row) => row.status === 'initiated' && row.createdAt.getTime() < staleBefore)
        .map((row) => ({ orderId: row.idempotencyKey.replace(/^cmi:/, ''), userId: row.customerId, amount: Number(row.amount), currency: row.currency, createdAt: row.createdAt.toISOString() })),
      declined: rows
        .filter((row) => row.status === 'failed')
        .map((row) => ({ orderId: row.idempotencyKey.replace(/^cmi:/, ''), userId: row.customerId, amount: Number(row.amount), currency: row.currency, reason: row.failureReason, createdAt: row.createdAt.toISOString() })),
      note: 'Compare "succeeded" totals with the CMI merchant back-office settlement report for the same dates.',
    };
  }
}
