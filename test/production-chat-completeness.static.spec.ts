import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('production chat completeness static contract', () => {
  it('keeps private booking chat participant-only across REST and realtime', () => {
    const controller = read('src/modules/conversations/conversations.controller.ts');
    const gateway = read('src/modules/realtime/realtime.gateway.ts');
    expect(controller).toContain('@Roles(UserRole.Customer, UserRole.Tasker)');
    expect(gateway).toContain(
      'if (participant) await client.join(realtimeRoom.conversation(bookingId));',
    );
    expect(gateway).toContain('return false;');
  });

  it('provides retry-safe message and support-ticket writes', () => {
    const schema = read('prisma/schema.prisma');
    const conversations = read('src/modules/conversations/conversations.service.ts');
    const support = read('src/modules/support/support.service.ts');
    expect(schema).toContain('task_messages_sender_client_message_unique');
    expect(schema).toContain('support_tickets_user_client_request_unique');
    expect(schema).toContain('support_ticket_messages_sender_client_message_unique');
    expect(conversations).toContain('CLIENT_MESSAGE_ID_REUSED');
    expect(support).toContain('CLIENT_REQUEST_ID_REUSED');
    expect(support).toContain('CLIENT_MESSAGE_ID_REUSED');
    expect(support).toContain("hasPrismaErrorCode(error, 'P2002')");
    expect(support).toContain('FOR UPDATE');
    expect(conversations).toContain('"conversationLastMessageAt" <');
  });

  it('supports unread totals, cursor history, and bounded read receipts for both chat families', () => {
    const conversations = read('src/modules/conversations/conversations.controller.ts');
    const conversationDto = read('src/modules/conversations/conversations.dto.ts');
    const support = read('src/modules/support/support.controller.ts');
    const adminSupport = read('src/modules/support/admin-support.controller.ts');
    const supportService = read('src/modules/support/support.service.ts');
    expect(conversations).toContain("@Get('unread-count')");
    expect(conversationDto).toContain('throughMessageId');
    expect(support).toContain("@Get('unread-count')");
    expect(support).toContain("@Post(':id/read')");
    expect(adminSupport).toContain("@Post(':id/read')");
    expect(supportService).toContain('nextCursor');
    expect(supportService).toContain('markSupportMessagesRead');
  });

  it('keeps support internal notes isolated from participant events and receipts', () => {
    const support = read('src/modules/support/support.service.ts');
    const gateway = read('src/modules/realtime/realtime.gateway.ts');
    expect(support).toContain("internalNote ? 'internal' : 'public'");
    expect(support).toContain('isInternalNote: false');
    expect(gateway).toContain("scope === 'internal'");
    expect(gateway).toContain("client.data.permissions.includes('support.manage')");
  });

  it('verifies provider attachment metadata and protects referenced chat assets', () => {
    const uploads = read('src/modules/uploads/uploads.service.ts');
    expect(uploads).toContain('verifyConversationAttachments');
    expect(uploads).toContain('verifySupportAttachments');
    expect(uploads).toContain('context.owner_namespace');
    expect(uploads).toContain('context.upload_folder');
    expect(uploads).toContain('assertChatAssetNotReferenced');
    expect(uploads).toContain('CHAT_ASSET_IN_USE');
  });

  it('commits notification records and their realtime outbox events atomically', () => {
    const notifications = read('src/modules/notifications/notifications.service.ts');
    expect(notifications).toContain('this.prisma.$transaction');
    expect(notifications).toContain('this.create(userId, input, atomicTransaction)');
    expect(notifications).toContain("'notification:created'");
  });

  it('has no message edit or delete route that could rewrite persisted evidence', () => {
    const conversations = read('src/modules/conversations/conversations.controller.ts');
    const support = read('src/modules/support/support.controller.ts');
    const adminSupport = read('src/modules/support/admin-support.controller.ts');
    for (const controller of [conversations, support, adminSupport]) {
      expect(controller).not.toMatch(/@(Patch|Delete)\([^)]*messages/);
    }
  });

  it('ships an additive migration with no destructive data statements', () => {
    const migration = read(
      'prisma/migrations/20260818130000_complete_production_chat_system/migration.sql',
    );
    expect(migration).toContain('ADD COLUMN "conversationLastMessageAt"');
    expect(migration).toContain('ADD COLUMN "clientMessageId"');
    expect(migration).toContain('ADD COLUMN "clientRequestId"');
    expect(migration).not.toMatch(/\b(DROP|TRUNCATE|DELETE\s+FROM)\b/i);
  });
});
