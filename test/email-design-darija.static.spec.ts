import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('premium email design and Darija architecture', () => {
  const root = process.cwd();
  const read = (path: string): string => readFileSync(join(root, path), 'utf8');

  it('uses one TypeScript shell and packages every generated CID asset', () => {
    const layout = read('src/modules/mail/email-layout.ts');
    const mail = read('src/modules/mail/mail.service.ts');
    expect(layout).toContain('data-latache-email-shell="v1"');
    expect(layout).toContain('https://latache-web.vercel.app/images/logo-full.svg');
    expect(mail).toContain('latacheEmailAttachments()');
    for (const asset of [
      'latache-email-header.png',
      'latache-security-shield.png',
      'latache-email-footer.png',
    ]) {
      expect(existsSync(join(root, 'src/modules/mail/assets', asset))).toBe(true);
      expect(existsSync(join(root, 'dist/modules/mail/assets', asset))).toBe(true);
    }
  });

  it('enables ary centrally without introducing a new API resource', () => {
    expect(read('.env.example')).toContain('SUPPORTED_LOCALES=en,ar,ary');
    expect(read('src/config/configuration.ts')).toContain("['en', 'ar', 'ary']");
    expect(read('src/modules/auth/dto/update-profile.dto.ts')).toContain(
      "enum: ['en', 'ar', 'ary']",
    );
    expect(read('src/modules/notifications/notification-template.service.ts')).toContain(
      "locale === 'ary'",
    );
  });
});
