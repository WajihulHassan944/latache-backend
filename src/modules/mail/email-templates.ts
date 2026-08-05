import { escapeHtml } from '../../common/utils/html.util';

const shell = (title: string, content: string): string => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#f7f0e7;font-family:Arial,sans-serif;color:#3f2b24">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;background:#f7f0e7">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #ead9cb">
        <tr><td style="padding:24px 32px;background:#a94725;color:#fff;font-size:24px;font-weight:700">Latache</td></tr>
        <tr><td style="padding:32px">${content}</td></tr>
        <tr><td style="padding:20px 32px;background:#fbf7f2;color:#7d675e;font-size:12px">This is an automated security email from Latache. Never share your code or password.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

export const verificationEmailTemplate = (params: {
  name: string;
  otp: number;
  expiryMinutes: number;
  device?: string;
}): string =>
  shell(
    'Verify your Latache email',
    `<h1 style="margin:0 0 16px;font-size:24px">Verify your email</h1>
     <p style="line-height:1.6">Hello ${escapeHtml(params.name || 'there')},</p>
     <p style="line-height:1.6">Use this verification code to complete your Latache account setup:</p>
     <div style="margin:24px 0;padding:18px;text-align:center;border-radius:12px;background:#f7f0e7;font-size:32px;font-weight:700;letter-spacing:8px;color:#a94725">${escapeHtml(String(params.otp))}</div>
     <p style="line-height:1.6">The code expires in ${params.expiryMinutes} minutes${params.device ? ` and was requested from ${escapeHtml(params.device)}` : ''}.</p>`,
  );

export const passwordResetOtpTemplate = (params: {
  name: string;
  otp: number;
  expiryMinutes: number;
}): string =>
  shell(
    'Reset your Latache password',
    `<h1 style="margin:0 0 16px;font-size:24px">Reset your password</h1>
     <p style="line-height:1.6">Hello ${escapeHtml(params.name || 'there')},</p>
     <p style="line-height:1.6">Use this one-time code to reset your password:</p>
     <div style="margin:24px 0;padding:18px;text-align:center;border-radius:12px;background:#f7f0e7;font-size:32px;font-weight:700;letter-spacing:8px;color:#a94725">${escapeHtml(String(params.otp))}</div>
     <p style="line-height:1.6">The code expires in ${params.expiryMinutes} minutes. Ignore this email if you did not request a password reset.</p>`,
  );

export const adminWelcomeTemplate = (params: {
  name: string;
  email: string;
  temporaryPassword: string;
  adminRole: string;
}): string =>
  shell(
    'Your Latache administrator account',
    `<h1 style="margin:0 0 16px;font-size:24px">Administrator account created</h1>
     <p style="line-height:1.6">Hello ${escapeHtml(params.name || 'there')},</p>
     <p style="line-height:1.6">A Latache administrator account has been created for you.</p>
     <table role="presentation" cellspacing="0" cellpadding="6" style="margin:20px 0;background:#fbf7f2;border-radius:10px">
       <tr><td><strong>Email</strong></td><td>${escapeHtml(params.email)}</td></tr>
       <tr><td><strong>Temporary password</strong></td><td>${escapeHtml(params.temporaryPassword)}</td></tr>
       <tr><td><strong>Role</strong></td><td>${escapeHtml(params.adminRole)}</td></tr>
     </table>
     <p style="line-height:1.6">Sign in and change the temporary password immediately.</p>`,
  );
