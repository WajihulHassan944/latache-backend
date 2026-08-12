import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('chat attachments and WebRTC calls static contract', () => {
  it('exposes canonical attachment capabilities and call history routes', () => {
    const controller = read('src/modules/conversations/conversations.controller.ts');
    expect(controller).toContain("@Get('capabilities')");
    expect(controller).toContain("@Get(':bookingId/calls')");
    expect(controller).toContain("@Get(':bookingId/calls/:callId')");
  });

  it('publishes the complete call signaling contract', () => {
    const constants = read('src/modules/realtime/realtime.constants.ts');
    for (const event of [
      'call:initiate',
      'call:accept',
      'call:reject',
      'call:cancel',
      'call:end',
      'call:offer',
      'call:answer',
      'call:ice_candidate',
      'call:media_state',
      'call:incoming',
      'call:state',
    ]) {
      expect(constants).toContain(`'${event}'`);
    }
  });

  it('persists call history without seeding fake calls', () => {
    const schema = read('prisma/schema.prisma');
    const migration = read('prisma/migrations/20260812100000_add_conversation_calls/migration.sql');
    expect(schema).toContain('model ConversationCall {');
    expect(migration).toContain('CREATE TABLE "ConversationCalls"');
    expect(migration).toContain('conversation_calls_one_active_per_booking');
    expect(migration).not.toContain('INSERT INTO "ConversationCalls"');
  });
});
