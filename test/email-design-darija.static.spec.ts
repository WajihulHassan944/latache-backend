import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('premium email design and Darija architecture', () => {
  const root = process.cwd();
  const read = (path: string): string => readFileSync(join(root, path), 'utf8');

  it('uses one TypeScript shell with the canonical hosted artwork', () => {
    const layout = read('src/modules/mail/email-layout.ts');
    const mail = read('src/modules/mail/mail.service.ts');
    expect(layout).toContain('data-latache-email-shell="v1"');
    expect(layout).toContain('https://latache-web.vercel.app/images/logo-full.svg');
    expect(layout).toContain('latache-email-header_hcqhvb.png');
    expect(layout).toContain('latache-security-shield_oioyd1.png');
    expect(layout).toContain('latache-email-footer_abofsj.png');
    expect(mail).not.toContain('attachments:');
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
