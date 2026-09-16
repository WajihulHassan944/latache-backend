import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Tasker-proposed reschedule, requiring customer approval', () => {
  const root = process.cwd();
  const read = (path: string): string => readFileSync(join(root, path), 'utf8');

  it('exposes create/get/respond endpoints gated to the correct roles', () => {
    const controller = read('src/modules/bookings/bookings.controller.ts');
    expect(controller).toContain("@Post(':bookingId/reschedule-proposals')");
    expect(controller).toContain("@Get(':bookingId/reschedule-proposals/:proposalId')");
    expect(controller).toContain("@Post(':bookingId/reschedule-proposals/:proposalId/respond')");

    const createIndex = controller.indexOf("@Post(':bookingId/reschedule-proposals')");
    const respondIndex = controller.indexOf("@Post(':bookingId/reschedule-proposals/:proposalId/respond')");
    // Only a Tasker may create a proposal; only the Customer may respond to it.
    expect(controller.slice(createIndex, createIndex + 200)).toContain('@Roles(UserRole.Tasker)');
    expect(controller.slice(respondIndex, respondIndex + 300)).toContain('@Roles(UserRole.Customer)');
  });

  it('only lets a Tasker propose for their own pending/confirmed booking, and blocks a second outstanding proposal', () => {
    const bookings = read('src/modules/bookings/bookings.service.ts');
    expect(bookings).toContain('async createRescheduleProposal(');
    expect(bookings).toContain('transaction.booking.findFirst({ where: { id: bookingId, taskerId } })');
    expect(bookings).toContain("if (!['pending', 'confirmed'].includes(booking.status))");
    expect(bookings).toContain("where: { bookingId, status: 'pending' }");
    expect(bookings).toContain('A pending reschedule proposal already exists for this booking');
  });

  it('validates the proposed slot is a real open slot without claiming it at creation time', () => {
    const bookings = read('src/modules/bookings/bookings.service.ts');
    const start = bookings.indexOf('async createRescheduleProposal(');
    const end = bookings.indexOf('async getRescheduleProposal(');
    const body = bookings.slice(start, end);
    expect(body).toContain('this.repository.findOpenSlotsForDate(taskerId, dto.date, transaction)');
    expect(body).toContain('this.isPastSlotStart(dto.date, slot.startTime)');
    // Creating a proposal must never claim the slot — only acceptance does.
    expect(body).not.toContain('this.repository.claimSlot');
    expect(body).toContain("status: 'pending'");
  });

  it('notifies the customer on creation via the existing notifications system', () => {
    const bookings = read('src/modules/bookings/bookings.service.ts');
    const start = bookings.indexOf('async createRescheduleProposal(');
    const end = bookings.indexOf('async getRescheduleProposal(');
    const body = bookings.slice(start, end);
    expect(body).toContain('this.notifications.create(');
    expect(body).toContain('booking.customerId');
    expect(body).toContain("type: 'reschedule_proposal_created'");
  });

  it('lets either booking participant fetch a single proposal', () => {
    const bookings = read('src/modules/bookings/bookings.service.ts');
    expect(bookings).toContain('async getRescheduleProposal(user: User, bookingId: number, proposalId: string)');
    expect(bookings).toContain('OR: [{ customerId: user.id }, { taskerId: user.id }]');
  });

  it('on accept, reuses the same slot-claim/date-time-update logic as the direct reschedule endpoint', () => {
    const bookings = read('src/modules/bookings/bookings.service.ts');
    expect(bookings).toContain('async respondRescheduleProposal(');
    const start = bookings.indexOf('async respondRescheduleProposal(');
    const end = bookings.indexOf('private serializeRescheduleProposal(');
    const body = bookings.slice(start, end);
    expect(body).toContain('this.repository.findOpenSlotsForDate(');
    expect(body).toContain('this.repository.claimSlot(slot.id, transaction)');
    expect(body).toContain('isBooked: false');
    expect(body).toContain("status: 'pending'");
    expect(body).toContain('confirmedAt: null');
    // Re-validates existence of the slot before touching the booking, since it may no longer be open.
    expect(body).toContain('Proposed date/time is no longer available');
    expect(body).toContain('Proposed slot has already been booked');
  });

  it('on reject, marks the proposal rejected and leaves the booking untouched', () => {
    const bookings = read('src/modules/bookings/bookings.service.ts');
    const start = bookings.indexOf('async respondRescheduleProposal(');
    const end = bookings.indexOf('private serializeRescheduleProposal(');
    const body = bookings.slice(start, end);
    const rejectIndex = body.indexOf('if (!dto.accept)');
    const acceptSlotIndex = body.indexOf('this.repository.findOpenSlotsForDate(');
    expect(rejectIndex).toBeGreaterThan(-1);
    expect(acceptSlotIndex).toBeGreaterThan(rejectIndex);
    expect(body.slice(rejectIndex, acceptSlotIndex)).toContain("status: 'rejected'");
    expect(body.slice(rejectIndex, acceptSlotIndex)).not.toContain('transaction.booking.update');
  });

  it('notifies the Tasker on both accept and reject', () => {
    const bookings = read('src/modules/bookings/bookings.service.ts');
    const start = bookings.indexOf('async respondRescheduleProposal(');
    const end = bookings.indexOf('private serializeRescheduleProposal(');
    const body = bookings.slice(start, end);
    expect(body).toContain("type: 'reschedule_proposal_rejected'");
    expect(body).toContain("type: 'reschedule_proposal_accepted'");
    expect(body).toContain('booking.taskerId');
  });

  it('rejects responding twice to the same proposal', () => {
    const bookings = read('src/modules/bookings/bookings.service.ts');
    expect(bookings).toContain('This reschedule proposal has already been responded to');
    expect(bookings).toContain("existing.status !== 'pending'");
  });

  it('persists proposals in their own Prisma model tied to a Booking and a proposing User', () => {
    const schema = read('prisma/schema.prisma');
    expect(schema).toContain('model RescheduleProposal {');
    expect(schema).toContain('bookingId      Int');
    expect(schema).toContain('proposedById   Int');
    expect(schema).toContain('status         String    @default("pending")');
  });
});
