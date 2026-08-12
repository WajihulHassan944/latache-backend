import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

describe('multilingual architecture regression contract', () => {
  const schema = read('prisma/schema.prisma');
  const migration = read(
    'prisma/migrations/20260812190000_add_multilingual_architecture/migration.sql',
  );

  it('uses additive locale rows and preserves canonical resources', () => {
    for (const marker of [
      'model ServiceTranslation {',
      'model ServiceOptionTranslation {',
      'model EliteTierTranslation {',
      'model EliteBenefitTranslation {',
      'model EliteBadgeTranslation {',
      'preferredLanguage',
      'templateKey',
      'templateParams',
    ]) {
      expect(schema).toContain(marker);
    }
    expect(schema).not.toContain('nameEnglish');
    expect(schema).not.toContain('nameArabic');
    expect(migration).toContain('Existing customer-facing content is canonical English');
    expect(migration).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i);
  });

  it('localizes the canonical Service routes without introducing a second catalogue', () => {
    const controller = read('src/modules/services/services.controller.ts');
    const service = read('src/modules/services/services.service.ts');
    expect(controller).toContain("@Controller('services')");
    expect(controller).toContain('@RequestLocale() locale: string');
    expect(service).toContain('serviceTranslation.upsert');
    expect(service).toContain('serviceOptionTranslation.upsert');
    expect(service).toContain('translationFallback');
  });

  it('persists notification templates and leaves user-authored content unmodified', () => {
    const notifications = read('src/modules/notifications/notifications.service.ts');
    const support = read('src/modules/support/support.service.ts');
    expect(notifications).toContain('templateKey');
    expect(notifications).toContain("'notification:created'");
    expect(support).not.toContain('machineTranslate');
  });
});
