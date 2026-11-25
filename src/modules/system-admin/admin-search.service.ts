import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { bookingRef } from '../../common/utils/booking-ref.util';

export interface SearchHit {
  type: 'customer' | 'tasker' | 'booking' | 'invoice' | 'enquiry' | 'application' | 'job';
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

export interface SearchGate {
  can: (permission: string) => boolean;
}

const PER_TYPE = 5;
const person = (u: { firstName: string | null; lastName: string | null; email: string }) => `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email;

@Injectable()
export class AdminSearchService {
  constructor(private readonly prisma: PrismaService) {}

  /** One query box across the admin: only searches record types the admin is allowed to read. */
  async search(rawQuery: string, gate: SearchGate): Promise<{ query: string; hits: SearchHit[] }> {
    const q = rawQuery.trim().slice(0, 80);
    if (q.length < 2) return { query: q, hits: [] };
    const like = { contains: q, mode: 'insensitive' as const };
    const tasks: Array<Promise<SearchHit[]>> = [];

    if (gate.can('customers.read') || gate.can('taskers.read')) {
      tasks.push(
        this.prisma.user
          .findMany({
            where: { isAdmin: false, OR: [{ firstName: like }, { lastName: like }, { email: like }, { phoneNumber: like }] },
            select: { id: true, firstName: true, lastName: true, email: true, roles: true },
            take: PER_TYPE * 2,
            orderBy: { id: 'desc' },
          })
          .then((rows) =>
            rows.flatMap((u): SearchHit[] => {
              const isTasker = u.roles.includes('tasker');
              const kind: 'tasker' | 'customer' = isTasker ? 'tasker' : 'customer';
              if (!gate.can(kind === 'tasker' ? 'taskers.read' : 'customers.read')) return [];
              return [{ type: kind, id: String(u.id), title: person(u), subtitle: u.email, href: kind === 'tasker' ? '/admin/tasker-management' : '/admin/customer-management' }];
            }),
          ),
      );
    }
    if (gate.can('bookings.read') && /^\d{1,9}$/.test(q)) {
      tasks.push(
        this.prisma.booking
          .findMany({ where: { id: Number(q) }, select: { id: true, status: true }, take: 1 })
          .then((rows) => rows.map((b) => ({ type: 'booking' as const, id: String(b.id), title: `Booking ${bookingRef(b.id)}`, subtitle: b.status, href: '/admin/booking-management' }))),
      );
    }
    if (gate.can('finance.read')) {
      tasks.push(
        this.prisma.invoice
          .findMany({ where: { number: like }, select: { id: true, number: true, total: true, currency: true, status: true }, take: PER_TYPE, orderBy: { issuedAt: 'desc' } })
          .then((rows) => rows.map((i) => ({ type: 'invoice' as const, id: i.id, title: `Invoice ${i.number}`, subtitle: `${i.total.toString()} ${i.currency} · ${i.status}`, href: '/admin/payments-finance' }))),
      );
    }
    if (gate.can('contact.read')) {
      tasks.push(
        this.prisma.contactEnquiry
          .findMany({ where: { OR: [{ reference: like }, { fullName: like }, { email: like }] }, select: { id: true, reference: true, fullName: true, topic: true, status: true }, take: PER_TYPE, orderBy: { lastActivityAt: 'desc' } })
          .then((rows) => rows.map((e) => ({ type: 'enquiry' as const, id: e.id, title: `${e.fullName} · ${e.reference}`, subtitle: `${e.topic} · ${e.status}`, href: `/admin/contact?open=${e.id}` }))),
      );
    }
    if (gate.can('careers.read')) {
      tasks.push(
        this.prisma.jobApplication
          .findMany({ where: { OR: [{ reference: like }, { fullName: like }, { email: like }] }, select: { id: true, reference: true, fullName: true, stage: true }, take: PER_TYPE, orderBy: { createdAt: 'desc' } })
          .then((rows) => rows.map((a) => ({ type: 'application' as const, id: a.id, title: `${a.fullName} · ${a.reference}`, subtitle: `Application · ${a.stage}`, href: '/admin/careers' }))),
        this.prisma.jobPosting
          .findMany({ where: { title: like }, select: { id: true, title: true, status: true, department: true }, take: PER_TYPE })
          .then((rows) => rows.map((j) => ({ type: 'job' as const, id: j.id, title: j.title, subtitle: `Job · ${j.department} · ${j.status}`, href: '/admin/careers' }))),
      );
    }

    const settled = await Promise.allSettled(tasks);
    const hits = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    return { query: q, hits: hits.slice(0, 30) };
  }
}
