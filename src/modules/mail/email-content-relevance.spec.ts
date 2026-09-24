import {
  adminWelcomeTemplate,
  bookingLifecycleEmailTemplate,
  disputeLifecycleEmailTemplate,
  emailPlainText,
  passwordResetOtpTemplate,
  verificationEmailTemplate,
} from './email-templates';
import { LATACHE_EMAIL_ASSETS } from './email-layout';

const SECURITY_EN = ['Your security is our priority.', 'Never share this code or your password with anyone.'];
const SECURITY_AR = 'لا تشارك هذا الرمز أو كلمة المرور مع أي شخص.';
const SECURITY_ARY = 'ماتشاركش هاد الكود ولا الموط باس ديالك مع حتى واحد.';

const booking = (overrides: Partial<Parameters<typeof bookingLifecycleEmailTemplate>[0]> = {}) =>
  bookingLifecycleEmailTemplate({
    name: 'Sara',
    entityType: 'booking',
    entityId: '482',
    title: 'Payment required',
    body: 'Your tasker accepted the booking. Complete payment within 60 minutes.',
    ...overrides,
  });

describe('email content relevance', () => {
  describe('security notice only where a secret is involved', () => {
    it.each(['en', 'ar', 'ary'])('verification OTP email keeps the notice and shield (%s)', (locale) => {
      const html = verificationEmailTemplate({ name: 'Sara', otp: 123456, expiryMinutes: 5, locale });
      expect(html).toContain(LATACHE_EMAIL_ASSETS.shield.url);
      if (locale === 'en') SECURITY_EN.forEach((line) => expect(html).toContain(line));
      if (locale === 'ar') expect(html).toContain(SECURITY_AR);
      if (locale === 'ary') expect(html).toContain(SECURITY_ARY);
    });

    it('password reset OTP email keeps the notice and shield', () => {
      const html = passwordResetOtpTemplate({ name: 'Sara', otp: 334018, expiryMinutes: 15 });
      SECURITY_EN.forEach((line) => expect(html).toContain(line));
      expect(html).toContain(LATACHE_EMAIL_ASSETS.shield.url);
    });

    it('admin welcome keeps its own credential-specific notice, not the OTP wording', () => {
      const html = adminWelcomeTemplate({ name: 'Ops', email: 'ops@x.com', temporaryPassword: 'T3mp!', adminRole: 'admin' });
      expect(html).toContain('Protect your administrator account.');
      expect(html).not.toContain('Never share this code');
    });

    it.each(['en', 'ar', 'ary'])('booking email has no security notice or shield (%s)', (locale) => {
      const { html } = booking({ locale });
      SECURITY_EN.forEach((line) => expect(html).not.toContain(line));
      expect(html).not.toContain(SECURITY_AR);
      expect(html).not.toContain(SECURITY_ARY);
      expect(html).not.toContain(LATACHE_EMAIL_ASSETS.shield.url);
    });

    it('dispute email has no security notice or shield', () => {
      const { html } = disputeLifecycleEmailTemplate({ name: 'Sara', disputeId: 'cmuabc123xyz789', eventType: 'dispute_escalated', detail: 'x' });
      SECURITY_EN.forEach((line) => expect(html).not.toContain(line));
      expect(html).not.toContain(LATACHE_EMAIL_ASSETS.shield.url);
    });

    it('OTP plain-text versions also tell the user never to share the code', () => {
      expect(emailPlainText('verification', { otp: 1, expiryMinutes: 5 })).toContain('Never share this code');
      expect(emailPlainText('password-reset', { otp: 1, expiryMinutes: 5 })).toContain('Never share this code');
    });
  });

  describe('notification emails only show references that are true', () => {
    it('a booking email shows the booking number', () => {
      const { html, text } = booking();
      expect(html).toContain('#482');
      expect(text).toContain('Booking: #482');
    });

    it.each([
      ['custom_time_request', 'cmueweith001701pf925z4zo3'],
      ['tasker_subscription', 'cmsub0000000000000000000'],
      ['tasker_platform_settlement', 'cmset0000000000000000000'],
      ['tasker_earning', 'cmearn000000000000000000'],
    ])('a %s email is NOT labelled as a booking and hides the internal id', (entityType, entityId) => {
      const { html, text } = booking({ entityType, entityId, title: 'Update', body: 'Something happened.' });
      expect(html).not.toContain(entityId);
      expect(html).not.toContain('>Booking<');
      expect(text).not.toContain('Booking:');
      expect(html).toContain('Something happened.');
    });

    it('still renders when the notification has no entity', () => {
      const { html } = booking({ entityType: null, entityId: null });
      expect(html).toContain('Payment required');
    });
  });

  describe('dispute emails', () => {
    it('show the short DSP reference, not the internal id, and tell the user what to do', () => {
      const { html, text } = disputeLifecycleEmailTemplate({ name: 'Sara', disputeId: 'cmuabc123xyz789', eventType: 'dispute_escalated', detail: 'x' });
      expect(html).toContain('DSP-XYZ789');
      expect(html).not.toContain('cmuabc123xyz789');
      expect(text).toContain('DSP-XYZ789');
      expect(html).toContain('Open the Latache app to view the dispute');
    });

    it('renders an unknown event type as a readable label', () => {
      const { html } = disputeLifecycleEmailTemplate({ name: 'Sara', disputeId: 'cmuabc123xyz789', eventType: 'dispute_evidence_requested', detail: 'Please upload photos.' });
      expect(html).toContain('Dispute evidence requested');
      expect(html).not.toContain('dispute evidence requested');
    });
  });
});
