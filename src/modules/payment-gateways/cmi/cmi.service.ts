import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { UserRole } from '../../../common/enums/user-role.enum';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma, type User } from '../../../generated/prisma/client';
import { NotificationsService } from '../../notifications/notifications.service';
import { CUSTOMER_WALLET_ENTRY_KIND } from '../../payments/payments.constants';
import { PaymentsService } from '../../payments/payments.service';
import { TaskerDepositsService } from '../../tasker-deposits/tasker-deposits.service';
import { cmiHash, cmiHashMatches } from './cmi-hash';

export type CmiPurpose = 'wallet_topup' | 'booking' | 'tasker_deposit';

const ISO_NUMERIC: Record<string, string> = { MAD: '504', EUR: '978', USD: '840', PKR: '586' };
const TEST_GATEWAY = 'https://testpayment.cmi.co.ma/fim/est3Dgate';

const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * CMI (Centre Monetique Interbancaire) 3D Pay Hosting.
 *
 * Flow: the app asks /checkout for a signed form, auto-POSTs it to the CMI
 * hosted card page, CMI calls our server-to-server callback (source of truth;
 * hash verified, we answer ACTION=POSTAUTH to capture), then sends the shopper
 * back to okUrl/failUrl which bounce to the frontend return page.
 *
 * Every purpose settles through rails that already handle refunds/adjustments:
 * - wallet_topup: credits the customer wallet;
 * - booking: credits the wallet, then pays the awaiting_payment booking from it;
 * - tasker_deposit: marks the Tasker signup deposit paid (+ receipt invoice).
 *
 * mode=simulator (never in production) points the form at a local page that
 * signs approve/decline callbacks with the store key, so the full loop is
 * testable before CMI merchant credentials exist.
 */
@Injectable()
export class CmiService {
  private readonly logger = new Logger(CmiService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly deposits: TaskerDepositsService,
    private readonly notifications: NotificationsService,
  ) {}

  status() {
    const mode = this.mode();
    return {
      provider: 'cmi',
      enabled: mode !== 'disabled' && this.configured(),
      mode,
      currencyCode: this.currencyCode(),
      purposes: ['wallet_topup', 'booking', 'tasker_deposit'],
    };
  }

  async checkout(user: User, dto: { purpose: CmiPurpose; amount?: number; bookingId?: number }) {
    this.assertEnabled();
    const purpose = dto.purpose;
    let amount: number;
    let currency: string;
    let bookingId: number | null = null;
    if (purpose === 'tasker_deposit') {
      if (user.role !== UserRole.Tasker) throw new ForbiddenException('Only a Tasker pays a signup deposit');
      const deposit = await this.deposits.requirePayable(user.id);
      amount = Number(deposit.amount);
      currency = deposit.currency;
    } else {
      if (user.role !== UserRole.Customer) throw new ForbiddenException('Only customers can pay with CMI here');
      const wallet = await this.prisma.customerWallet.findUnique({ where: { customerId: user.id } });
      if (purpose === 'booking') {
        if (!dto.bookingId) throw new BadRequestException('bookingId is required for purpose=booking');
        const booking = await this.prisma.booking.findFirst({ where: { id: dto.bookingId, customerId: user.id } });
        if (!booking) throw new NotFoundException('Booking not found');
        if (booking.status !== 'awaiting_payment') {
          throw new ConflictException('Payment can only be completed after tasker acceptance');
        }
        const estimate = booking.paymentEstimate as { total?: number } | null;
        const due = typeof estimate?.total === 'number' ? estimate.total : null;
        if (due === null) throw new ConflictException('The booking amount is not ready yet; retry in a moment');
        // Only the shortfall is charged: existing wallet balance is used first.
        const balance = wallet ? Number(wallet.availableBalance) : 0;
        amount = money(Math.max(0, due - balance));
        if (amount <= 0) {
          throw new ConflictException({
            code: 'WALLET_COVERS_BOOKING',
            message: 'Your wallet already covers this booking; pay with source=wallet',
          });
        }
        currency = booking.paymentCurrency;
        bookingId = booking.id;
      } else {
        if (!dto.amount || dto.amount <= 0) throw new BadRequestException('amount is required for purpose=wallet_topup');
        amount = money(dto.amount);
        currency = wallet?.currency ?? this.config.get<string>('payments.currency', 'USD');
      }
    }
    const currencyCode = ISO_NUMERIC[currency.toUpperCase()];
    if (!currencyCode || (this.mode() !== 'simulator' && currencyCode !== this.currencyCode())) {
      throw new ConflictException({
        code: 'CMI_CURRENCY_UNSUPPORTED',
        message: `CMI settles in ISO ${this.currencyCode()} but this payment is in ${currency}. Switch the platform currency to MAD to use CMI.`,
      });
    }

    const orderId = `CMI${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString('hex').toUpperCase()}`;
    await this.prisma.paymentTransaction.create({
      data: {
        customerId: user.id,
        bookingId,
        kind: purpose === 'tasker_deposit' ? 'tasker_deposit' : 'wallet_topup',
        provider: 'cmi',
        status: 'initiated',
        amount: amount.toFixed(2),
        currency,
        idempotencyKey: `cmi:${orderId}`,
        metadata: { purpose, orderId, ...(bookingId ? { bookingId } : {}) },
      },
    });

    const apiBase = this.config.get<string>('app.baseUrl', 'http://localhost:8080').replace(/\/$/, '');
    const fields: Record<string, string> = {
      clientid: this.config.get<string>('cmi.clientId') ?? 'simulator',
      storetype: '3D_PAY_HOSTING',
      hashAlgorithm: 'ver3',
      TranType: 'PreAuth',
      amount: amount.toFixed(2),
      currency: currencyCode,
      oid: orderId,
      okUrl: `${apiBase}/api/payments/cmi/return/ok`,
      failUrl: `${apiBase}/api/payments/cmi/return/fail`,
      callbackUrl: `${apiBase}/api/payments/cmi/callback`,
      shopurl: this.returnUrl(),
      lang: this.config.get<string>('cmi.language', 'fr'),
      rnd: randomBytes(10).toString('hex'),
      BillToName: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || 'Latache customer',
      email: user.email,
      tel: user.phoneNumber ?? '',
      refreshtime: '5',
      AutoRedirect: 'true',
      encoding: 'UTF-8',
    };
    fields.HASH = cmiHash(fields, this.storeKey());
    return {
      provider: 'cmi',
      orderId,
      purpose,
      amount,
      currency,
      method: 'POST',
      url: this.gatewayUrl(),
      fields,
      instructions: 'Render a form with these hidden fields and auto-submit it (POST) to url. Then poll GET /api/payments/cmi/orders/:orderId.',
    };
  }

  /**
   * Server-to-server callback. Returns the plain-text body CMI expects:
   * ACTION=POSTAUTH (capture), APPROVED (already handled) or FAILURE.
   */
  async handleCallback(body: Record<string, unknown>): Promise<string> {
    if (!cmiHashMatches(body, this.storeKey())) {
      this.logger.warn(`CMI callback with invalid hash for oid=${String(body.oid ?? '')}`);
      return 'FAILURE';
    }
    const orderId = String(body.oid ?? '');
    const approved = String(body.ProcReturnCode ?? '') === '00' && String(body.Response ?? '').toLowerCase() === 'approved';
    const reference = String(body.TransId ?? body.AuthCode ?? orderId);
    let postCommitBooking: { customerId: number; bookingId: number } | null = null;
    const answer = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "PaymentTransactions" WHERE "idempotencyKey" = ${`cmi:${orderId}`} FOR UPDATE`;
      const row = await transaction.paymentTransaction.findUnique({ where: { idempotencyKey: `cmi:${orderId}` } });
      if (!row) return 'FAILURE';
      if (row.status === 'succeeded') return 'APPROVED';
      if (Math.abs(Number(String(body.amount ?? '').replace(',', '.')) - Number(row.amount)) > 0.009) {
        await transaction.paymentTransaction.update({ where: { id: row.id }, data: { status: 'failed', failureReason: 'Amount mismatch in CMI callback' } });
        return 'FAILURE';
      }
      if (!approved) {
        await transaction.paymentTransaction.update({
          where: { id: row.id },
          data: { status: 'failed', failureReason: String(body.ErrMsg ?? body.Response ?? 'Declined').slice(0, 1000) },
        });
        return 'FAILURE';
      }
      const metadata = (row.metadata ?? {}) as { purpose?: CmiPurpose; bookingId?: number };
      await transaction.paymentTransaction.update({
        where: { id: row.id },
        data: { status: 'succeeded', providerReference: `cmi:${reference}`, failureReason: null },
      });
      if (metadata.purpose === 'tasker_deposit') {
        await this.deposits.markPaid(
          row.customerId,
          { amount: Number(row.amount), currency: row.currency, method: 'cmi', reference: `cmi:${reference}` },
          transaction,
        );
      } else {
        await this.creditWallet(transaction, row.customerId, Number(row.amount), row.currency, reference, row.id);
        if (metadata.purpose === 'booking' && metadata.bookingId) {
          postCommitBooking = { customerId: row.customerId, bookingId: metadata.bookingId };
        }
      }
      return 'ACTION=POSTAUTH';
    });
    if (postCommitBooking) await this.payBookingFromWallet(postCommitBooking);
    return answer;
  }

  async order(user: User, orderId: string) {
    const row = await this.prisma.paymentTransaction.findFirst({
      where: { idempotencyKey: `cmi:${orderId}`, customerId: user.id },
    });
    if (!row) throw new NotFoundException('Order not found');
    const metadata = (row.metadata ?? {}) as { purpose?: string; bookingId?: number };
    const booking = metadata.bookingId
      ? await this.prisma.booking.findUnique({ where: { id: metadata.bookingId }, select: { status: true, paymentSource: true } })
      : null;
    return {
      orderId,
      purpose: metadata.purpose ?? null,
      status: row.status,
      amount: Number(row.amount),
      currency: row.currency,
      failureReason: row.failureReason,
      bookingId: metadata.bookingId ? String(metadata.bookingId) : null,
      bookingStatus: booking?.status ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Where the shopper's browser goes after CMI's ok/fail redirect. */
  returnRedirect(outcome: 'ok' | 'fail', body: Record<string, unknown>): string {
    const url = new URL(this.returnUrl());
    url.searchParams.set('provider', 'cmi');
    url.searchParams.set('status', outcome === 'ok' ? 'processing' : 'failed');
    if (body.oid) url.searchParams.set('orderId', String(body.oid));
    return url.toString();
  }

  /** Local-only stand-in for the CMI hosted page. */
  simulatorPage(fields: Record<string, unknown>): string {
    this.assertSimulator();
    if (!cmiHashMatches(fields, this.storeKey())) throw new BadRequestException('Invalid request hash');
    const e = (value: unknown) => String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
    const hidden = Object.entries(fields)
      .filter(([key]) => key !== 'HASH')
      .map(([key, value]) => `<input type="hidden" name="${e(key)}" value="${e(value)}">`)
      .join('');
    return `<!doctype html><html><head><meta charset="utf-8"><title>CMI simulator</title>
<style>body{font:15px system-ui;max-width:420px;margin:60px auto;padding:24px;border:1px solid #ddd;border-radius:12px}
button{font-size:15px;padding:10px 18px;margin-right:8px;border-radius:8px;border:0;cursor:pointer}.ok{background:#0a7d32;color:#fff}.ko{background:#b3261e;color:#fff}</style></head>
<body><h2>CMI payment simulator</h2><p>Local development only. No card is charged.</p>
<p><b>Order</b> ${e(fields.oid)}<br><b>Amount</b> ${e(fields.amount)} (ISO ${e(fields.currency)})</p>
<form method="post" action="/api/payments/cmi/simulator/complete">${hidden}
<button class="ok" name="outcome" value="approve">Approve</button><button class="ko" name="outcome" value="decline">Decline</button></form></body></html>`;
  }

  /** Signs a CMI-shaped callback like the real gateway, delivers it, and returns where to send the browser. */
  async simulatorComplete(fields: Record<string, unknown>): Promise<string> {
    this.assertSimulator();
    const approve = fields.outcome === 'approve';
    const { outcome: _outcome, ...request } = fields;
    const callback: Record<string, unknown> = {
      ...request,
      ProcReturnCode: approve ? '00' : '05',
      Response: approve ? 'Approved' : 'Declined',
      ErrMsg: approve ? '' : 'Simulated decline',
      TransId: `SIM${Date.now()}`,
      AuthCode: approve ? 'SIM123' : '',
      mdStatus: '1',
    };
    delete callback.HASH;
    callback.HASH = cmiHash(callback, this.storeKey());
    const answer = await this.handleCallback(callback);
    this.logger.log(`CMI simulator callback for ${String(fields.oid)} answered ${answer}`);
    return this.returnRedirect(approve ? 'ok' : 'fail', callback);
  }

  private async creditWallet(
    transaction: Prisma.TransactionClient,
    customerId: number,
    amount: number,
    currency: string,
    reference: string,
    paymentTransactionId: string,
  ) {
    await transaction.customerWallet.upsert({
      where: { customerId },
      create: { customerId, currency, availableBalance: 0 },
      update: {},
    });
    await transaction.$queryRaw`SELECT "customerId" FROM "CustomerWallets" WHERE "customerId" = ${customerId} FOR UPDATE`;
    const ledgerKey = `cmi:wallet-topup:${paymentTransactionId}`;
    const existing = await transaction.customerWalletLedgerEntry.findUnique({ where: { idempotencyKey: ledgerKey } });
    if (existing) return;
    await transaction.customerWallet.update({
      where: { customerId },
      data: { availableBalance: { increment: amount.toFixed(2) } },
    });
    await transaction.customerWalletLedgerEntry.create({
      data: {
        customerId,
        kind: CUSTOMER_WALLET_ENTRY_KIND.Topup,
        status: 'settled',
        amount: amount.toFixed(2),
        balanceDelta: amount.toFixed(2),
        currency,
        description: 'CMI card payment',
        providerReference: `cmi:${reference}`,
        idempotencyKey: ledgerKey,
      },
    });
    await this.notifications.create(
      customerId,
      {
        category: 'wallet',
        type: 'wallet_topup_succeeded',
        title: 'Wallet balance updated',
        body: `${currency} ${amount.toFixed(2)} was added to your Latache wallet.`,
        entityType: 'payment_transaction',
        entityId: paymentTransactionId,
      },
      transaction,
    );
  }

  /** The money is already in the wallet; if the booking expired meanwhile it simply stays there. */
  private async payBookingFromWallet(input: { customerId: number; bookingId: number }) {
    try {
      await this.payments.completeAcceptancePayment(input.customerId, input.bookingId, { source: 'wallet' });
    } catch (error) {
      this.logger.warn(
        `CMI booking ${input.bookingId}: funds credited to wallet but booking capture failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private mode(): string {
    return this.config.get<string>('cmi.mode', 'disabled');
  }

  private configured(): boolean {
    if (this.mode() === 'simulator') return true;
    const credentials = Boolean(this.config.get<string>('cmi.clientId') && this.config.get<string>('cmi.storeKey'));
    // The live gateway URL comes from the acquiring bank's onboarding pack.
    return credentials && (this.mode() !== 'production' || Boolean(this.config.get<string>('cmi.gatewayUrl')));
  }

  private assertEnabled() {
    if (this.mode() === 'disabled' || !this.configured()) {
      throw new ServiceUnavailableException({ code: 'CMI_DISABLED', message: 'CMI payments are not configured' });
    }
    if (this.mode() === 'simulator' && process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException({ code: 'CMI_SIMULATOR_IN_PRODUCTION', message: 'The CMI simulator cannot run in production' });
    }
  }

  private assertSimulator() {
    if (this.mode() !== 'simulator' || process.env.NODE_ENV === 'production') throw new NotFoundException();
  }

  private storeKey(): string {
    return this.config.get<string>('cmi.storeKey') ?? (this.mode() === 'simulator' ? 'latache-local-simulator-key' : '');
  }

  private currencyCode(): string {
    return this.config.get<string>('cmi.currencyCode', '504');
  }

  private gatewayUrl(): string {
    const apiBase = this.config.get<string>('app.baseUrl', 'http://localhost:8080').replace(/\/$/, '');
    const mode = this.mode();
    if (mode === 'simulator') return `${apiBase}/api/payments/cmi/simulator`;
    return this.config.get<string>('cmi.gatewayUrl') || TEST_GATEWAY;
  }

  private returnUrl(): string {
    return (
      this.config.get<string>('cmi.returnUrl') ||
      `${this.config.get<string>('frontend.baseUrl', 'http://localhost:3000').replace(/\/$/, '')}/payment/return`
    );
  }
}
