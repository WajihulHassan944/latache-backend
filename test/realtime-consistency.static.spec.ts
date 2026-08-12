import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

describe('API consistency and realtime contracts', () => {
  it('keeps persisted messages on REST and emits them from the transactional outbox', () => {
    const conversations = read('src/modules/conversations/conversations.service.ts');
    const notifications = read('src/modules/notifications/notifications.service.ts');
    expect(conversations).toContain('enqueueConversation(');
    expect(conversations).toContain("'conversation:message'");
    expect(notifications).toContain("'notification:created'");
  });

  it('does not expose deprecated participant complaint or legacy service routes', () => {
    const bookingController = read('src/modules/bookings/bookings.controller.ts');
    const serviceController = read('src/modules/services/services.controller.ts');
    expect(bookingController).not.toContain("@Get(':bookingId/complaints')");
    expect(bookingController).not.toContain("@Post(':bookingId/complaints')");
    expect(serviceController).not.toContain("@Get('get-services')");
    expect(serviceController).not.toContain("@Post('add-service')");
  });

  it('keeps private conversation rooms separate from admin-visible booking rooms', () => {
    const gateway = read('src/modules/realtime/realtime.gateway.ts');
    expect(gateway).toContain(
      'if (participant) await client.join(realtimeRoom.conversation(bookingId));',
    );
    expect(gateway).toContain("identity.permissions.includes('bookings.read')");
    expect(gateway).toContain('return false;');
  });

  it('moderates public reviews without deleting author content', () => {
    const controller = read('src/modules/admin-dashboard/controllers/admin-reviews.controller.ts');
    const service = read('src/modules/reviews/reviews.service.ts');
    expect(controller).toContain("@Patch(':reviewId/moderation')");
    expect(service).toContain("moderationStatus: 'visible'");
  });
});
