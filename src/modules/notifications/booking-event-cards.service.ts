import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { bookingRef } from '../../common/utils/booking-ref.util';
import { RealtimeOutboxService } from '../realtime/realtime-outbox.service';

export type EventCardTone = 'info' | 'success' | 'warning' | 'danger';

export type EventCardEvent =
  | 'payment'
  | 'cash_selected'
  | 'cash_received'
  | 'refund'
  | 'heading'
  | 'arrived'
  | 'started'
  | 'completed'
  | 'review'
  | 'dispute'
  | 'dispute_resolved'
  | 'invoice';

export interface EventCardAction {
  kind: 'invoice' | 'review' | 'booking';
  label: string;
  invoiceId?: string;
}

/** Structured payload stored on a `kind = "system"` TaskMessage. Rendered by the apps as a card. */
export interface EventCardPayload {
  v: 1;
  event: EventCardEvent;
  tone: EventCardTone;
  title: string;
  summary?: string;
  bookingId: number;
  bookingRef: string;
  rows: Array<{ label: string; value: string }>;
  action?: EventCardAction;
}

/**
 * Requested / accepted / payment-required / rescheduled / cancelled are already
 * synthesized by the apps from live booking data (see the frontend's
 * build-booking-lifecycle-messages), so they are deliberately NOT persisted here
 * - that would show every one of them twice.
 */
const TYPE_TO_EVENT: Record<string, { event: EventCardEvent; tone: EventCardTone }> = {
  booking_payment_captured: { event: 'payment', tone: 'success' },
  booking_payment_succeeded: { event: 'payment', tone: 'success' },
  booking_wallet_payment_succeeded: { event: 'payment', tone: 'success' },
  booking_cash_selected_tasker: { event: 'cash_selected', tone: 'info' },
  booking_cash_payment_confirmed: { event: 'cash_received', tone: 'success' },
  booking_payment_refunded: { event: 'refund', tone: 'info' },
  booking_unused_prepayment_refunded: { event: 'refund', tone: 'info' },
  tasker_en_route: { event: 'heading', tone: 'info' },
  tasker_arrived: { event: 'arrived', tone: 'info' },
  task_started: { event: 'started', tone: 'info' },
  task_completed: { event: 'completed', tone: 'success' },
  task_completed_by_customer: { event: 'completed', tone: 'success' },
  task_completion_verified: { event: 'completed', tone: 'success' },
  task_completion_auto_approved: { event: 'completed', tone: 'success' },
  review_received: { event: 'review', tone: 'success' },
  booking_dispute_opened: { event: 'dispute', tone: 'danger' },
  booking_dispute_resolved: { event: 'dispute_resolved', tone: 'success' },
};

/** These describe a one-off milestone: a booking gets at most one card of each. */
const ONCE_PER_BOOKING = new Set<EventCardEvent>([
  'payment',
  'cash_received',
  'heading',
  'arrived',
  'started',
  'completed',
  'invoice',
]);

/** Other events can legitimately repeat, so only collapse the duplicate fired for the second participant. */
const DUPLICATE_WINDOW_MS = 15_000;

const money = (currency: string | null | undefined, value: unknown): string => {
  const n = Number(value);
  return Number.isFinite(n) ? `${currency ?? ''} ${n.toFixed(2)}`.trim() : '-';
};

/**
 * Posts automatic "activity cards" into the customer/tasker conversation so
 * both people (and the admin conversation viewer) get a running log of what
 * happened to a booking: accepted, paid, invoice ready, completed and so on.
 *
 * Cards are system messages (kind = "system"): written already-read so they
 * never inflate unread counters, and they never create push notifications of
 * their own - the lifecycle notification that triggered them already did.
 */
@Injectable()
export class BookingEventCardsService {
  private readonly logger = new Logger(BookingEventCardsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeOutboxService,
  ) {}

  /** Called by NotificationsService for every booking notification; unmapped types are ignored. */
  async postForNotification(
    client: Prisma.TransactionClient,
    input: { type: string; templateKey?: string; entityType?: string | null; entityId?: string | null; title: string; body: string },
  ): Promise<void> {
    if (input.entityType !== 'booking' || !input.entityId || !/^\d+$/.test(input.entityId)) return;
    const spec = TYPE_TO_EVENT[input.templateKey ?? ''] ?? TYPE_TO_EVENT[input.type];
    if (!spec) return;
    await this.post(client, Number(input.entityId), spec.event, { tone: spec.tone, title: input.title, summary: input.body });
  }

  /** Invoice card with a download action, posted the moment an invoice is created. */
  async postInvoiceIssued(
    client: Prisma.TransactionClient | PrismaService,
    bookingId: number,
    invoice: { id: string; number: string; total: unknown; currency: string },
  ): Promise<void> {
    await this.post(client as Prisma.TransactionClient, bookingId, 'invoice', {
      tone: 'success',
      title: 'Invoice ready',
      summary: `Invoice ${invoice.number} was issued for this booking.`,
      extraRows: [
        { label: 'Invoice', value: invoice.number },
        { label: 'Total', value: money(invoice.currency, invoice.total) },
      ],
      action: { kind: 'invoice', label: 'Download PDF', invoiceId: invoice.id },
    });
  }

  private async post(
    client: Prisma.TransactionClient,
    bookingId: number,
    event: EventCardEvent,
    opts: {
      tone: EventCardTone;
      title: string;
      summary?: string;
      extraRows?: Array<{ label: string; value: string }>;
      action?: EventCardAction;
    },
  ): Promise<void> {
    try {
      const since = new Date(Date.now() - DUPLICATE_WINDOW_MS);
      const duplicate = await client.taskMessage.findFirst({
        where: {
          bookingId,
          kind: 'system',
          event: { path: ['event'], equals: event },
          ...(ONCE_PER_BOOKING.has(event) ? {} : { createdAt: { gte: since } }),
        },
        select: { id: true },
      });
      if (duplicate) return;

      const booking = await client.booking.findUnique({
        where: { id: bookingId },
        select: {
          conversationId: true,
          customerId: true,
          bookingDate: true,
          startTime: true,
          endTime: true,
          paymentCurrency: true,
          serviceAmount: true,
          platformFeeAmount: true,
          totalChargedAmount: true,
          paymentSource: true,
          service: { select: { name: true } },
        },
      });
      if (!booking) return;

      const rows: Array<{ label: string; value: string }> = [
        { label: 'Service', value: booking.service?.name ?? '-' },
        {
          label: 'When',
          value: `${booking.bookingDate.toISOString().slice(0, 10)} ${booking.startTime}${booking.endTime ? ` - ${booking.endTime}` : ''}`,
        },
      ];
      if (event === 'payment' || event === 'cash_selected' || event === 'cash_received' || event === 'refund') {
        if (booking.paymentSource) rows.push({ label: 'Method', value: String(booking.paymentSource).replace(/_/g, ' ') });
        rows.push({ label: 'Service amount', value: money(booking.paymentCurrency, booking.serviceAmount) });
        rows.push({ label: 'Platform fee', value: money(booking.paymentCurrency, booking.platformFeeAmount) });
        if (booking.totalChargedAmount !== null) rows.push({ label: 'Total', value: money(booking.paymentCurrency, booking.totalChargedAmount) });
      }
      rows.push(...(opts.extraRows ?? []));

      const action: EventCardAction | undefined =
        opts.action ?? (event === 'completed' ? { kind: 'review', label: 'Rate your tasker' } : undefined);

      const payload: EventCardPayload = {
        v: 1,
        event,
        tone: opts.tone,
        title: opts.title,
        ...(opts.summary ? { summary: opts.summary } : {}),
        bookingId,
        bookingRef: bookingRef(bookingId),
        rows,
        ...(action ? { action } : {}),
      };

      const now = new Date();
      const message = await client.taskMessage.create({
        data: {
          conversationId: booking.conversationId,
          bookingId,
          senderId: booking.customerId,
          body: `${opts.title} (${payload.bookingRef})`,
          kind: 'system',
          event: payload as unknown as Prisma.InputJsonValue,
          readAt: now,
        },
      });
      await client.$executeRaw`
        UPDATE "Conversations"
        SET "lastMessageAt" = CASE
          WHEN "lastMessageAt" IS NULL OR "lastMessageAt" < ${message.createdAt}
          THEN ${message.createdAt}
          ELSE "lastMessageAt"
        END
        WHERE "id" = ${booking.conversationId}
      `;
      await this.realtime.enqueueConversation(
        booking.conversationId,
        'conversation:message',
        {
          id: message.id,
          clientMessageId: null,
          conversationId: booking.conversationId,
          bookingId: String(bookingId),
          senderId: String(booking.customerId),
          body: message.body ?? '',
          attachments: [],
          kind: 'system',
          event: payload as unknown as Prisma.InputJsonValue,
          readAt: now.toISOString(),
          createdAt: message.createdAt.toISOString(),
        } as Prisma.InputJsonValue,
        client,
      );
    } catch (error) {
      // Never let the activity log break the booking action that triggered it.
      this.logger.warn(`Event card "${event}" for booking ${bookingId} skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
