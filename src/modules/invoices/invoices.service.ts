import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { normalizePagination } from '../../common/utils/pagination.util';
import { hasPrismaErrorCode } from '../../database/prisma-error.util';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { MailService } from '../mail/mail.service';
import { BookingEventCardsService } from '../notifications/booking-event-cards.service';
import { bookingRef } from '../../common/utils/booking-ref.util';
import { DEFAULT_INVOICE_SELLER, presentableWebsite } from './invoice-defaults';
import { PAYMENT_STATUS } from '../payments/payments.constants';
import { PAYMENT_LABELS, formatDate, formatMoney, renderInvoicePdf } from './invoice-pdf.renderer';

export const INVOICE_TYPE = { Booking: 'booking', TaskerDeposit: 'tasker_deposit', CreditNote: 'credit_note', PaymentReceipt: 'payment_receipt' } as const;

/** Statuses in which an online-prepaid booking already holds the customer's money and deserves a receipt. */
const RECEIPT_BOOKING_STATUSES = ['confirmed', 'en_route', 'arrived', 'in_progress', 'awaiting_customer_approval', 'completed'];

/** A booking gets its invoice once the job is completed and the money is settled. */
const INVOICEABLE_PAYMENT_STATUSES = [
  PAYMENT_STATUS.Paid,
  PAYMENT_STATUS.CashConfirmed,
  PAYMENT_STATUS.PartiallyRefunded,
];

export interface InvoiceLine {
  code: string;
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
}

type InvoiceRow = Prisma.InvoiceGetPayload<object>;

const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const num = (value: Prisma.Decimal | number | null | undefined): number => (value === null || value === undefined ? 0 : Number(value));

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
    private readonly mail: MailService,
    private readonly cards: BookingEventCardsService,
  ) {}

  /**
   * Emails every issued invoice that has not been sent yet, PDF attached.
   * Runs after issuePending in the same sweep; failures retry (max 5).
   */
  async emailPending(limit = 50): Promise<number> {
    const due = await this.prisma.invoice.findMany({
      where: { emailedAt: null, emailAttempts: { lt: 5 }, status: 'issued' },
      include: { billedTo: { select: { email: true, firstName: true, lastName: true, preferredLanguage: true } } },
      orderBy: { issuedAt: 'asc' },
      take: limit,
    });
    let sent = 0;
    for (const invoice of due) {
      if (await this.emailInvoice(invoice)) sent += 1;
    }
    return sent;
  }

  /** Admin "resend": emails one invoice now (to the address on the account), regardless of earlier sends. */
  async resendEmail(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { billedTo: { select: { email: true, firstName: true, lastName: true, preferredLanguage: true } } },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const sent = await this.emailInvoice(invoice);
    if (!sent) throw new ServiceUnavailableException({ code: 'INVOICE_EMAIL_FAILED', message: 'The invoice email could not be sent; check the mail provider and retry.' });
    return { sent: true, to: invoice.billedTo.email, number: invoice.number };
  }

  private async emailInvoice(
    invoice: InvoiceRow & { billedTo: { email: string; firstName: string | null; lastName: string | null; preferredLanguage: string | null } },
  ): Promise<boolean> {
    try {
      const pdf = await this.renderPdf(invoice);
      const details = (invoice.details ?? {}) as Record<string, unknown>;
      await this.mail.sendInvoiceEmail({
        to: invoice.billedTo.email,
        name: this.fullName(invoice.billedTo),
        number: invoice.number,
        kind: invoice.type === INVOICE_TYPE.TaskerDeposit ? 'tasker_deposit' : details.kind === 'late_cancellation' ? 'late_cancellation' : 'booking',
        bookingId: invoice.bookingId !== null ? String(invoice.bookingId) : null,
        total: formatMoney(num(invoice.total), invoice.currency),
        locale: invoice.billedTo.preferredLanguage ?? undefined,
        pdf,
      });
      await this.prisma.invoice.update({ where: { id: invoice.id }, data: { emailedAt: new Date(), emailAttempts: { increment: 1 } } });
      return true;
    } catch (error) {
      await this.prisma.invoice.update({ where: { id: invoice.id }, data: { emailAttempts: { increment: 1 } } });
      this.logger.warn(`Invoice ${invoice.number} email failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /** Idempotent: returns the existing invoice, null when the booking is not invoiceable yet. */
  async issueBookingInvoice(bookingId: number): Promise<InvoiceRow | null> {
    const existing = await this.prisma.invoice.findUnique({
      where: { type_bookingId: { type: INVOICE_TYPE.Booking, bookingId } },
    });
    if (existing) return existing;
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        service: { select: { name: true } },
        serviceOption: { select: { name: true } },
        customer: { select: { id: true, firstName: true, lastName: true, email: true, phoneCountryCode: true, phoneNumber: true } },
        tasker: { select: { id: true, firstName: true, lastName: true } },
        workSession: { select: { startedAt: true, stoppedAt: true, accumulatedPausedSecs: true } },
      },
    });
    if (!booking) return null;
    const cancellationFee = num(booking.cancellationFeeAmount);
    if (booking.status === 'cancelled' && cancellationFee > 0) {
      return this.issueCancellationFeeInvoice(booking, cancellationFee);
    }
    if (booking.status !== 'completed') return null;
    if (!INVOICEABLE_PAYMENT_STATUSES.includes(booking.paymentStatus as never)) return null;

    const serviceAmount = num(booking.serviceAmount);
    const platformFee = num(booking.platformFeeAmount);
    const surcharge = num(booking.serviceSurchargeAmount);
    const tax = num(booking.taxAmount);
    const tip = num(booking.tipAmount);
    const donation = num(booking.donationAmount);
    const discount = num(booking.referralDiscountAmount);
    const hours =
      booking.workSession?.stoppedAt
        ? Math.max(
            0,
            (booking.workSession.stoppedAt.getTime() - booking.workSession.startedAt.getTime()) / 3_600_000 -
              booking.workSession.accumulatedPausedSecs / 3600,
          )
        : null;
    const serviceLabel = [booking.service.name, booking.serviceOption?.name].filter(Boolean).join(' - ') || 'Service';
    const hourlyRate = num(booking.hourlyRate);
    // Billed time = what the service amount actually pays for (never less than the minimum billable time).
    const billedHours = hourlyRate > 0 && serviceAmount > 0 ? Math.round((serviceAmount / hourlyRate) * 100) / 100 : 0;
    const lines: InvoiceLine[] = [
      {
        code: 'service',
        description: `${serviceLabel} service${billedHours ? ` - ${billedHours} h billed` : ''}`,
        quantity: billedHours || 1,
        unitAmount: billedHours ? money(serviceAmount / billedHours) : serviceAmount,
        amount: serviceAmount,
      },
    ];
    if (platformFee > 0) lines.push(this.line('platform_fee', `Platform service fee (${num(booking.commissionRatePercent)}%)`, platformFee));
    if (surcharge > 0) lines.push(this.line('service_surcharge', 'Service surcharge', surcharge));
    if (tax > 0 && !booking.taxInclusive) lines.push(this.line('tax', `Tax (${num(booking.taxRatePercent)}%)`, tax));
    if (tip > 0) lines.push(this.line('tip', 'Tip for your Tasker', tip));
    if (donation > 0) lines.push(this.line('donation', 'Donation', donation));
    if (discount > 0) lines.push(this.line('referral_discount', 'Referral discount', -discount));
    const computedTotal = money(lines.reduce((sum, item) => sum + item.amount, 0));
    const total = booking.totalChargedAmount === null ? computedTotal : num(booking.totalChargedAmount);

    return this.create(
      {
        type: INVOICE_TYPE.Booking,
        billedToId: booking.customerId,
        bookingId,
        currency: booking.paymentCurrency,
        subtotal: serviceAmount,
        platformFee,
        taxAmount: tax,
        discountAmount: discount,
        total,
        paymentMethod: booking.paymentSource,
        lines,
        details: {
          service: serviceLabel,
          tasker: this.fullName(booking.tasker),
          date: booking.bookingDate.toISOString().slice(0, 10),
          // The day the work was actually done (the scheduled slot can be days earlier or later).
          serviceDate: (booking.taskCompletedAt ?? booking.paidAt ?? booking.bookingDate).toISOString().slice(0, 10),
          startTime: booking.startTime,
          endTime: booking.endTime,
          hoursWorked: hours === null ? null : Math.round(hours * 100) / 100,
          billedHours: billedHours || null,
          hourlyRate: hourlyRate || null,
          location: [booking.venueAddress, booking.apartmentSuite, booking.locationCity].filter(Boolean).join(', '),
        },
        buyer: {
          id: booking.customer.id,
          name: this.fullName(booking.customer),
          email: booking.customer.email,
          phone: booking.customer.phoneNumber ? `${booking.customer.phoneCountryCode ?? ''} ${booking.customer.phoneNumber}`.trim() : null,
        },
        issuedAt: booking.paidAt ?? booking.taskCompletedAt ?? new Date(),
      },
      { type: INVOICE_TYPE.Booking, bookingId },
    );
  }

  /**
   * Receipt for the prepayment, issued as soon as an online (card/wallet) payment is captured so the customer and the
   * Tasker can both download a payment document straight away. The real invoice still follows after the job, for the
   * time actually worked (any unused prepaid time is refunded). Idempotent: one receipt per booking.
   */
  async issuePaymentReceipt(bookingId: number): Promise<InvoiceRow | null> {
    const existing = await this.prisma.invoice.findUnique({
      where: { type_bookingId: { type: INVOICE_TYPE.PaymentReceipt, bookingId } },
    });
    if (existing) return existing;
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        service: { select: { name: true } },
        serviceOption: { select: { name: true } },
        customer: { select: { id: true, firstName: true, lastName: true, email: true, phoneCountryCode: true, phoneNumber: true } },
        tasker: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!booking || booking.capturedAt === null || booking.capturedAmount === null) return null;
    if (booking.paymentSource === 'cash' || !RECEIPT_BOOKING_STATUSES.includes(booking.status)) return null;

    const estimate = (booking.paymentEstimate ?? {}) as { serviceAmount?: number; platformFeeAmount?: number; serviceSurchargeAmount?: number; taxAmount?: number; taxInclusive?: boolean; tipAmount?: number; donationAmount?: number };
    const serviceLabel = [booking.service.name, booking.serviceOption?.name].filter(Boolean).join(' - ') || 'Service';
    const serviceAmount = num(estimate.serviceAmount);
    const platformFee = num(estimate.platformFeeAmount);
    const lines: InvoiceLine[] = [this.line('service', `${serviceLabel} service (prepaid)`, serviceAmount)];
    if (platformFee > 0) lines.push(this.line('platform_fee', 'Platform service fee', platformFee));
    if (num(estimate.serviceSurchargeAmount) > 0) lines.push(this.line('service_surcharge', 'Service surcharge', num(estimate.serviceSurchargeAmount)));
    if (num(estimate.taxAmount) > 0 && !estimate.taxInclusive) lines.push(this.line('tax', 'Tax', num(estimate.taxAmount)));
    if (num(estimate.tipAmount) > 0) lines.push(this.line('tip', 'Tip for your Tasker', num(estimate.tipAmount)));
    if (num(estimate.donationAmount) > 0) lines.push(this.line('donation', 'Donation', num(estimate.donationAmount)));
    const captured = num(booking.capturedAmount);

    const row = await this.create(
      {
        type: INVOICE_TYPE.PaymentReceipt,
        numberPrefix: 'RCT',
        billedToId: booking.customerId,
        bookingId,
        currency: booking.paymentCurrency,
        subtotal: serviceAmount,
        platformFee,
        taxAmount: num(estimate.taxAmount),
        discountAmount: 0,
        total: captured,
        paymentMethod: booking.paymentSource,
        lines,
        details: {
          kind: 'payment_receipt',
          service: serviceLabel,
          tasker: this.fullName(booking.tasker),
          date: booking.bookingDate.toISOString().slice(0, 10),
          serviceDate: booking.bookingDate.toISOString().slice(0, 10),
          startTime: booking.startTime,
          endTime: booking.endTime,
          location: [booking.venueAddress, booking.apartmentSuite, booking.locationCity].filter(Boolean).join(', '),
        },
        buyer: {
          id: booking.customer.id,
          name: this.fullName(booking.customer),
          email: booking.customer.email,
          phone: booking.customer.phoneNumber ? `${booking.customer.phoneCountryCode ?? ''} ${booking.customer.phoneNumber}`.trim() : null,
        },
        issuedAt: booking.capturedAt,
      },
      { type: INVOICE_TYPE.PaymentReceipt, bookingId },
    );
    // The payment confirmation email already went out; the receipt is available in the app and in the chat.
    return this.prisma.invoice.update({ where: { id: row.id }, data: { emailedAt: new Date() } });
  }

  /**
   * Credit note for money refunded on an invoiced booking (dispute refunds). One per booking, for the
   * total refunded so far; idempotent. Not emailed automatically - it is available in the invoice list.
   */
  async issueCreditNote(bookingId: number): Promise<InvoiceRow | null> {
    const existing = await this.prisma.invoice.findUnique({
      where: { type_bookingId: { type: INVOICE_TYPE.CreditNote, bookingId } },
    });
    if (existing) return existing;
    const original = await this.prisma.invoice.findUnique({
      where: { type_bookingId: { type: INVOICE_TYPE.Booking, bookingId } },
    });
    if (!original) return null;
    const resolutions = await this.prisma.disputeResolution.findMany({
      where: { status: 'applied', refundAmount: { gt: 0 }, refundTransactionId: { not: null }, complaint: { bookingId } },
      select: { refundAmount: true },
    });
    const refunded = money(resolutions.reduce((sum, row) => sum + num(row.refundAmount), 0));
    if (refunded <= 0) return null;
    const credited = Math.min(refunded, num(original.total));
    const originalDetails = (original.details ?? {}) as Record<string, unknown>;
    return this.create(
      {
        type: INVOICE_TYPE.CreditNote,
        numberPrefix: 'CN',
        billedToId: original.billedToId,
        bookingId,
        currency: original.currency,
        subtotal: credited,
        platformFee: 0,
        taxAmount: 0,
        discountAmount: 0,
        total: credited,
        paymentMethod: original.paymentMethod,
        lines: [this.line('refund', `Refund against invoice ${original.number}`, credited)],
        details: { ...originalDetails, kind: 'credit_note', originalInvoiceNumber: original.number },
        buyer: original.buyer as Record<string, unknown>,
        issuedAt: new Date(),
      },
      { type: INVOICE_TYPE.CreditNote, bookingId },
    ).then(async (row) => {
      // No email template for credit notes yet: mark as delivered so the email sweep skips it.
      return this.prisma.invoice.update({ where: { id: row.id }, data: { emailedAt: new Date() } });
    });
  }

  private async issueCancellationFeeInvoice(
    booking: Prisma.BookingGetPayload<{
      include: {
        service: { select: { name: true } };
        serviceOption: { select: { name: true } };
        customer: { select: { id: true; firstName: true; lastName: true; email: true; phoneCountryCode: true; phoneNumber: true } };
        tasker: { select: { id: true; firstName: true; lastName: true } };
      };
    }>,
    fee: number,
  ) {
    const serviceLabel = [booking.service.name, booking.serviceOption?.name].filter(Boolean).join(' - ') || 'Service';
    return this.create(
      {
        type: INVOICE_TYPE.Booking,
        billedToId: booking.customerId,
        bookingId: booking.id,
        currency: booking.paymentCurrency,
        subtotal: fee,
        platformFee: 0,
        taxAmount: 0,
        discountAmount: 0,
        total: fee,
        paymentMethod: booking.paymentSource,
        lines: [this.line('late_cancellation_fee', `Late cancellation fee - ${serviceLabel}`, fee)],
        details: {
          service: serviceLabel,
          tasker: this.fullName(booking.tasker),
          date: booking.bookingDate.toISOString().slice(0, 10),
          startTime: booking.startTime,
          endTime: booking.endTime,
          cancelledAt: booking.cancelledAt?.toISOString() ?? null,
          kind: 'late_cancellation',
        },
        buyer: {
          id: booking.customer.id,
          name: this.fullName(booking.customer),
          email: booking.customer.email,
          phone: booking.customer.phoneNumber ? `${booking.customer.phoneCountryCode ?? ''} ${booking.customer.phoneNumber}`.trim() : null,
        },
        issuedAt: booking.cancelledAt ?? new Date(),
      },
      { type: INVOICE_TYPE.Booking, bookingId: booking.id },
    );
  }

  /** Receipt for a paid Tasker signup deposit. Idempotent. */
  async issueDepositInvoice(depositId: string, transaction?: Prisma.TransactionClient): Promise<InvoiceRow | null> {
    const client = transaction ?? this.prisma;
    const existing = await client.invoice.findUnique({
      where: { type_taskerDepositId: { type: INVOICE_TYPE.TaskerDeposit, taskerDepositId: depositId } },
    });
    if (existing) return existing;
    const deposit = await client.taskerDeposit.findUnique({
      where: { id: depositId },
      include: { tasker: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
    if (!deposit || deposit.status !== 'paid') return null;
    const amount = num(deposit.amount);
    return this.create(
      {
        type: INVOICE_TYPE.TaskerDeposit,
        billedToId: deposit.taskerId,
        taskerDepositId: deposit.id,
        currency: deposit.currency,
        subtotal: amount,
        platformFee: 0,
        taxAmount: 0,
        discountAmount: 0,
        total: amount,
        paymentMethod: deposit.paymentMethod,
        lines: [this.line('tasker_deposit', 'Tasker signup security deposit (refundable)', amount)],
        buyer: { id: deposit.tasker.id, name: this.fullName(deposit.tasker), email: deposit.tasker.email },
        issuedAt: deposit.paidAt ?? new Date(),
      },
      { type: INVOICE_TYPE.TaskerDeposit, taskerDepositId: deposit.id },
      transaction,
    );
  }

  /** Background sweep (and on-read catch-up): invoice every settled completed booking that has none yet. */
  async issuePending(filter: Prisma.BookingWhereInput = {}, limit = 200): Promise<number> {
    const due = await this.prisma.booking.findMany({
      where: {
        ...filter,
        OR: [
          { status: 'completed', paymentStatus: { in: INVOICEABLE_PAYMENT_STATUSES } },
          { status: 'cancelled', cancellationFeeAmount: { gt: 0 } },
        ],
        invoices: { none: { type: INVOICE_TYPE.Booking } },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: limit,
    });
    let issued = 0;
    const refunded = await this.prisma.booking.findMany({
      where: {
        ...filter,
        paymentStatus: { in: [PAYMENT_STATUS.PartiallyRefunded, PAYMENT_STATUS.Refunded] },
        invoices: { some: { type: INVOICE_TYPE.Booking }, none: { type: INVOICE_TYPE.CreditNote } },
      },
      select: { id: true },
      take: limit,
    });
    for (const row of refunded) {
      try {
        if (await this.issueCreditNote(row.id)) issued += 1;
      } catch (error) {
        this.logger.error(`Credit note for booking ${row.id} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const receiptsDue = await this.prisma.booking.findMany({
      where: {
        ...filter,
        capturedAt: { not: null },
        paymentSource: { not: 'cash' },
        status: { in: RECEIPT_BOOKING_STATUSES },
        invoices: { none: { type: INVOICE_TYPE.PaymentReceipt } },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: limit,
    });
    for (const row of receiptsDue) {
      try {
        if (await this.issuePaymentReceipt(row.id)) issued += 1;
      } catch (error) {
        this.logger.error(`Receipt for booking ${row.id} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    for (const row of due) {
      try {
        if (await this.issueBookingInvoice(row.id)) issued += 1;
      } catch (error) {
        this.logger.error(`Invoice for booking ${row.id} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return issued;
  }

  /** Invoices billed to the user, plus (for a Tasker) the customer invoices of their own jobs. */
  async listForUser(userId: number, role: string, query: { page?: number; limit?: number; type?: string }) {
    await this.issuePending(role === 'tasker' ? { taskerId: userId } : { customerId: userId }, 50);
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 20);
    const where: Prisma.InvoiceWhereInput = {
      ...(role === 'tasker' ? { OR: [{ billedToId: userId }, { booking: { taskerId: userId } }] } : { billedToId: userId }),
      ...(query.type ? { type: query.type } : {}),
    };
    return this.page(where, page, limit, offset);
  }

  async getForUser(userId: number, role: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        ...(role === 'tasker' ? { OR: [{ billedToId: userId }, { booking: { taskerId: userId } }] } : { billedToId: userId }),
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  async getForBooking(userId: number, role: string, bookingId: number) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, ...(role === 'tasker' ? { taskerId: userId } : { customerId: userId }) },
      select: { id: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    const invoice = await this.issueBookingInvoice(bookingId);
    if (!invoice) {
      throw new NotFoundException({
        code: 'INVOICE_NOT_YET_AVAILABLE',
        message: 'The invoice is issued once the booking is completed and payment is settled.',
      });
    }
    return invoice;
  }

  async adminList(query: { page?: number; limit?: number; type?: string; billedToId?: number; bookingId?: number; search?: string; from?: string; to?: string }) {
    await this.issuePending({}, 200);
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    const search = query.search?.trim();
    const where: Prisma.InvoiceWhereInput = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.billedToId ? { billedToId: query.billedToId } : {}),
      ...(query.bookingId ? { bookingId: query.bookingId } : {}),
      ...(query.from || query.to
        ? {
            issuedAt: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: 'insensitive' } },
              { billedTo: { email: { contains: search, mode: 'insensitive' } } },
              { billedTo: { firstName: { contains: search, mode: 'insensitive' } } },
              { billedTo: { lastName: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [result, totals] = await Promise.all([
      this.page(where, page, limit, offset),
      this.prisma.invoice.groupBy({
        by: ['currency', 'type'],
        where: { ...where, status: 'issued' },
        _sum: { total: true, platformFee: true },
        _count: { _all: true },
      }),
    ]);
    return {
      ...result,
      totals: totals.map((row) => ({
        type: row.type,
        currency: row.currency,
        count: row._count._all,
        total: num(row._sum.total),
        platformFee: num(row._sum.platformFee),
      })),
    };
  }

  async adminGet(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  view(invoice: InvoiceRow) {
    return {
      id: invoice.id,
      number: invoice.number,
      type: invoice.type,
      status: invoice.status,
      billedToId: String(invoice.billedToId),
      bookingId: invoice.bookingId !== null ? String(invoice.bookingId) : null,
      taskerDepositId: invoice.taskerDepositId,
      currency: invoice.currency,
      subtotal: num(invoice.subtotal),
      platformFee: num(invoice.platformFee),
      taxAmount: num(invoice.taxAmount),
      discountAmount: num(invoice.discountAmount),
      total: num(invoice.total),
      paymentMethod: invoice.paymentMethod,
      lines: invoice.lines as unknown as InvoiceLine[],
      details: (invoice.details ?? null) as Record<string, unknown> | null,
      seller: invoice.seller,
      buyer: invoice.buyer,
      issuedAt: invoice.issuedAt.toISOString(),
      voidedAt: invoice.voidedAt?.toISOString() ?? null,
      htmlPath: `/api/invoices/${invoice.id}/html`,
      pdfPath: `/api/invoices/${invoice.id}/pdf`,
    };
  }

  renderPdf(invoice: InvoiceRow): Promise<Buffer> {
    const view = this.view(invoice);
    return renderInvoicePdf({
      ...view,
      seller: (view.seller ?? {}) as Record<string, unknown>,
      buyer: (view.buyer ?? {}) as Record<string, unknown>,
    });
  }

  /** In-app view of the same document as the PDF. Every value is escaped. */
  renderHtml(invoice: InvoiceRow): string {
    const view = this.view(invoice);
    const seller = (view.seller ?? {}) as Record<string, unknown>;
    const buyer = (view.buyer ?? {}) as Record<string, unknown>;
    const details = view.details ?? {};
    const fmt = (amount: number) => formatMoney(amount, view.currency);
    const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    const e = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c) => entities[c] ?? c);
    const field = (label: string, value: unknown) => (value ? `<div class="f"><span>${e(label)}</span>${e(value)}</div>` : '');
    const rows = view.lines
      .map(
        (line) =>
          `<tr><td>${e(line.description)}</td><td class="c">${line.quantity}</td><td class="n">${fmt(line.unitAmount)}</td><td class="n b">${fmt(line.amount)}</td></tr>`,
      )
      .join('');
    const legal = [
      seller.iceNumber ? `ICE ${seller.iceNumber}` : '',
      seller.rcNumber ? `RC ${seller.rcNumber}` : '',
      seller.ifNumber ? `IF ${seller.ifNumber}` : '',
      seller.patenteNumber ? `Patente ${seller.patenteNumber}` : '',
    ].filter(Boolean);
    const sub = (label: string, amount: number) => (amount > 0 ? `<tr><td>${label}</td><td class="n">${fmt(amount)}</td></tr>` : '');
    const tip = view.lines.filter((l) => l.code === 'tip' || l.code === 'donation').reduce((t, l) => t + l.amount, 0);
    const when = details.date
      ? `${formatDate(String(details.date))}, ${String(details.startTime ?? '')} - ${String(details.endTime ?? '')}`
      : '';
    const right =
      view.type === 'tasker_deposit'
        ? `<h4>Details</h4><div class="name">Tasker signup deposit</div>${field('Nature', 'Refundable security deposit')}`
        : `<h4>Service details</h4><div class="name">${e(details.service ?? 'Service')}</div>${field('Performed by', details.tasker)}${field('Date &amp; time', when)}${field(
            'Time worked',
            details.hoursWorked !== null && details.hoursWorked !== undefined ? `${Number(details.hoursWorked).toFixed(2)} h` : '',
          )}${field('Location', details.location)}`;
    const notes =
      view.type === 'payment_receipt'
        ? 'This is a receipt for the amount prepaid when the booking was confirmed. The final invoice is issued after the job for the time actually worked; any unused prepaid time is refunded to your original payment method.'
        : details.kind === 'late_cancellation'
        ? 'This booking was cancelled inside the late-cancellation window. The fee above was kept under the cancellation policy and the rest of your payment was refunded.'
        : view.type === 'tasker_deposit'
        ? 'This deposit is held as a refundable security deposit for your Latache Tasker account.'
        : `Payment received in full${view.paymentMethod === 'cash' ? ' in cash by the Tasker on completion' : ''}. This invoice covers the service and any platform fees for booking ${bookingRef(view.bookingId ?? '-')}.`;
    const discount = view.discountAmount > 0 ? `<tr><td>Discount</td><td class="n">- ${fmt(view.discountAmount)}</td></tr>` : '';
    const voided = view.status === 'void';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invoice ${e(view.number)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#F6EEE3;font:14px/1.5 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#4B2112}
.page{max-width:800px;margin:32px auto;background:#fff;border-top:6px solid #6A2A13;padding:44px 52px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.top{display:flex;justify-content:space-between;gap:32px}.brand{color:#60230C;font-size:30px;font-weight:700;margin:0;font-family:Georgia,"Times New Roman",serif}
.muted{color:#8C551F;font-size:12.5px}.title{text-align:right}.title h1{margin:0;font-size:32px;letter-spacing:.5px;font-family:Georgia,"Times New Roman",serif}
.meta{margin-top:10px;font-size:12.5px}.meta div{display:flex;justify-content:space-between;gap:24px}.meta b{font-weight:600}
.pill{display:inline-block;margin-top:10px;padding:3px 16px;border-radius:999px;background:#E8F6EB;color:#1F6B3A;font-weight:700;font-size:12px;letter-spacing:1.5px}
.pill.void{background:#FDECEA;color:#B3261E}hr{border:0;border-top:1px solid #EFD7AD;margin:28px 0}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:32px}h4{margin:0 0 6px;color:#6A2A13;font-size:11px;letter-spacing:1px;text-transform:uppercase}
.name{font-weight:600;font-size:15px;margin-bottom:4px}.f{font-size:13px;margin-top:4px}.f span{display:block;color:#8C551F;font-size:11px}
table.items{width:100%;border-collapse:collapse;margin-top:28px}.items th{background:#60230C;color:#F7DDA8;font-size:11px;letter-spacing:.8px;text-transform:uppercase;padding:10px 12px;text-align:left}
.items td{padding:12px;border-bottom:1px solid #EFD7AD}.items tr:nth-child(even) td{background:#FFF5E4}
.n{text-align:right!important;white-space:nowrap}.c{text-align:center!important}.b{font-weight:600}
.totals{margin:18px 0 0 auto;width:300px;border-collapse:collapse}.totals td{padding:5px 0;color:#8C551F}.totals td.n{color:#60230C}
.grand{margin:8px 0 0 auto;width:300px;background:#6A2A13;color:#fff;display:flex;justify-content:space-between;padding:12px 14px;font-weight:700;font-size:16px}
.notes{margin-top:32px;max-width:62%;color:#8C551F;font-size:12.5px}.foot{margin-top:40px;padding-top:12px;border-top:1px solid #EFD7AD;text-align:center;color:#8C551F;font-size:11.5px}
@media print{body{background:#fff}.page{box-shadow:none;margin:0;max-width:none}}
@media (max-width:640px){.page{padding:24px}.top,.cols{display:block}.title{text-align:left;margin-top:16px}.notes{max-width:none}}
</style></head><body><div class="page">
<div class="top"><div><p class="brand">${e(seller.name ?? 'Latache')}</p><div class="b">${e(seller.legalName ?? seller.name ?? '')}</div>
<div class="muted">${[seller.address, seller.email, seller.phone, seller.website].filter(Boolean).map(e).join('<br>')}</div></div>
<div class="title"><h1>INVOICE</h1><div class="muted">Facture</div><div class="meta">
<div><span class="muted">Invoice no.</span><b>${e(view.number)}</b></div><div><span class="muted">Issue date</span><b>${e(formatDate(view.issuedAt))}</b></div>
${view.bookingId ? `<div><span class="muted">Booking ref.</span><b>${bookingRef(e(view.bookingId))}</b></div>` : ''}<div><span class="muted">Payment</span><b>${e(PAYMENT_LABELS[view.paymentMethod ?? ''] ?? view.paymentMethod ?? '-')}</b></div></div>
<span class="pill${voided ? ' void' : ''}">${voided ? 'VOID' : 'PAID'}</span></div></div>
<hr><div class="cols"><div><h4>Billed to</h4><div class="name">${e(buyer.name ?? 'Customer')}</div>${field('Email', buyer.email)}${field('Phone', buyer.phone)}${field('Address', buyer.address)}</div><div>${right}</div></div>
<table class="items"><thead><tr><th>Description</th><th class="c">Qty</th><th class="n">Unit price</th><th class="n">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<table class="totals">${sub(view.type === 'tasker_deposit' ? 'Deposit' : 'Service subtotal', view.subtotal)}${sub('Platform fee', view.platformFee)}${sub('Tax', view.taxAmount)}${sub('Tip &amp; donation', tip)}${discount}</table>
<div class="grand"><span>Total paid</span><span>${fmt(view.total)}</span></div>
<table class="totals"><tr><td class="b" style="color:#60230C">Balance due</td><td class="n b">${fmt(0)}</td></tr></table>
<div class="notes"><h4>Notes</h4>${e(notes)} ${e(seller.footerNote ?? '')}</div>
<div class="foot">${[seller.legalName ?? seller.name, ...legal].filter(Boolean).map(e).join(' &nbsp;|&nbsp; ')}<br>Electronically generated invoice ${e(view.number)}. Valid without signature.</div>
</div></body></html>`;
  }

  private async page(where: Prisma.InvoiceWhereInput, page: number, limit: number, offset: number) {
    const [rows, totalItems] = await Promise.all([
      this.prisma.invoice.findMany({ where, orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }], skip: offset, take: limit }),
      this.prisma.invoice.count({ where }),
    ]);
    return { page, limit, totalItems, totalPages: Math.ceil(totalItems / limit), items: rows.map((row) => this.view(row)) };
  }

  private async create(
    data: {
      type: string;
      billedToId: number;
      bookingId?: number;
      taskerDepositId?: string;
      currency: string;
      subtotal: number;
      platformFee: number;
      taxAmount: number;
      discountAmount: number;
      total: number;
      paymentMethod: string | null;
      lines: InvoiceLine[];
      details?: Record<string, unknown>;
      buyer: Record<string, unknown>;
      issuedAt: Date;
      numberPrefix?: string;
    },
    unique: { type: string; bookingId?: number; taskerDepositId?: string },
    transaction?: Prisma.TransactionClient,
  ): Promise<InvoiceRow> {
    const client = transaction ?? this.prisma;
    const seller = await this.seller();
    const [sequence] = await client.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('invoice_number_seq') AS value`;
    const value = sequence?.value ?? BigInt(Date.now());
    const { numberPrefix = 'INV', ...invoiceData } = data;
    const number = `${numberPrefix}-${data.issuedAt.getUTCFullYear()}-${String(value).padStart(6, '0')}`;
    try {
      const created = await client.invoice.create({
        data: {
          ...invoiceData,
          number,
          subtotal: money(data.subtotal).toFixed(2),
          platformFee: money(data.platformFee).toFixed(2),
          taxAmount: money(data.taxAmount).toFixed(2),
          discountAmount: money(data.discountAmount).toFixed(2),
          total: money(data.total).toFixed(2),
          lines: data.lines as unknown as Prisma.InputJsonValue,
          details: data.details ? (data.details as Prisma.InputJsonValue) : Prisma.DbNull,
          buyer: data.buyer as Prisma.InputJsonValue,
          seller: seller as Prisma.InputJsonValue,
        },
      });
      if ((created.type === INVOICE_TYPE.Booking || created.type === INVOICE_TYPE.PaymentReceipt) && created.bookingId) {
        await this.cards.postInvoiceIssued(client, created.bookingId, { id: created.id, number: created.number, total: created.total, currency: created.currency }, created.type === INVOICE_TYPE.PaymentReceipt ? 'receipt' : 'invoice');
      }
      return created;
    } catch (error) {
      // Lost a race with the sweep or a concurrent read: return the winner.
      if (hasPrismaErrorCode(error, 'P2002') && !transaction) {
        const raced = await this.prisma.invoice.findFirst({ where: unique });
        if (raced) return raced;
      }
      throw error;
    }
  }

  /** Company identity printed on invoices and statements (general settings). */
  sellerIdentity(): Promise<Record<string, unknown>> {
    return this.seller();
  }

  private async seller(): Promise<Record<string, unknown>> {
    const settings = await this.settings.view('general');
    const general = (settings.general ?? {}) as Record<string, unknown>;
    const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
    return {
      name: text(general.platformName) ?? 'Latache',
      legalName: text(general.legalName) ?? DEFAULT_INVOICE_SELLER.legalName,
      address: text(general.legalAddress) ?? DEFAULT_INVOICE_SELLER.address,
      companyNumber: DEFAULT_INVOICE_SELLER.companyNumber,
      email: text(general.supportEmail) ?? DEFAULT_INVOICE_SELLER.email,
      phone: text(general.supportPhone),
      website: presentableWebsite(general.platformUrl, DEFAULT_INVOICE_SELLER.website),
      iceNumber: general.iceNumber ?? null,
      rcNumber: general.rcNumber ?? null,
      ifNumber: general.ifNumber ?? null,
      patenteNumber: general.patenteNumber ?? null,
      footerNote: general.invoiceFooterNote ?? null,
    };
  }

  private line(code: string, description: string, amount: number): InvoiceLine {
    return { code, description, quantity: 1, unitAmount: money(amount), amount: money(amount) };
  }

  private fullName(person: { firstName: string | null; lastName: string | null }): string {
    return `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim();
  }
}
