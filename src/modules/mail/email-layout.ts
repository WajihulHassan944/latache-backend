import { escapeHtml } from '../../common/utils/html.util';

export const LATACHE_EMAIL_LOGO_URL = 'https://latache-web.vercel.app/images/logo-full.svg';

export const LATACHE_EMAIL_ASSETS = {
  header: {
    url: 'https://res.cloudinary.com/daflot6fo/image/upload/v1786533881/latache-email-header_hcqhvb.png',
  },
  shield: {
    url: 'https://res.cloudinary.com/daflot6fo/image/upload/v1786533881/latache-security-shield_oioyd1.png',
  },
  footer: {
    url: 'https://res.cloudinary.com/daflot6fo/image/upload/v1786533881/latache-email-footer_abofsj.png',
  },
} as const;

export type EmailLocale = 'en' | 'ar' | 'ary';

export const normalizeEmailLocale = (locale?: string): EmailLocale => {
  const normalized = locale?.trim().toLowerCase().replace('_', '-');
  if (normalized === 'ar' || normalized?.startsWith('ar-')) return 'ar';
  if (normalized === 'ary' || normalized?.startsWith('ary-')) return 'ary';
  return 'en';
};

interface EmailLayoutCopy {
  securityTitle: string;
  securityBody: string;
  rights: string;
  footerTagline: string;
}

const LAYOUT_COPY: Record<EmailLocale, EmailLayoutCopy> = {
  en: {
    securityTitle: 'Your security is our priority.',
    securityBody: 'Never share this code or your password with anyone.',
    rights: 'All rights reserved.',
    footerTagline: 'Connecting you with trusted professionals.',
  },
  ar: {
    securityTitle: 'أمانك هو أولويتنا.',
    securityBody: 'لا تشارك هذا الرمز أو كلمة المرور مع أي شخص.',
    rights: 'جميع الحقوق محفوظة.',
    footerTagline: 'نصلك بمهنيين موثوقين.',
  },
  ary: {
    securityTitle: 'الحماية ديالك هي الأولوية ديالنا.',
    securityBody: 'ماتشاركش هاد الكود ولا الموط باس ديالك مع حتى واحد.',
    rights: 'الحقوق كلها محفوظة.',
    footerTagline: 'كنربطوك بمهنيين ثقة.',
  },
};

export interface LatacheEmailLayoutParams {
  documentTitle: string;
  preheader: string;
  locale?: string;
  content: string;
  securityTitle?: string;
  securityBody?: string;
}

export const latacheEmailLayout = (params: LatacheEmailLayoutParams): string => {
  const locale = normalizeEmailLocale(params.locale);
  const copy = LAYOUT_COPY[locale];
  const rtl = locale !== 'en';
  const year = new Date().getUTCFullYear();
  const direction = rtl ? 'rtl' : 'ltr';
  const textAlign = rtl ? 'right' : 'left';
  const securityTitle = params.securityTitle ?? copy.securityTitle;
  const securityBody = params.securityBody ?? copy.securityBody;

  return `<!doctype html>
<html lang="${locale}" dir="${direction}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light">
  <title>${escapeHtml(params.documentTitle)}</title>
  <style>
    @media only screen and (max-width: 680px) {
      .email-frame { width: 100% !important; border-radius: 0 !important; }
      .email-pad { padding-left: 24px !important; padding-right: 24px !important; }
      .email-title { font-size: 36px !important; line-height: 42px !important; }
      .header-logo { width: 170px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f4efe6;color:#54220f;font-family:Arial,'Helvetica Neue',sans-serif;direction:${direction};text-align:${textAlign}">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(params.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f4efe6">
    <tr>
      <td align="center" style="padding:20px 10px">
        <table data-latache-email-shell="v1" role="presentation" class="email-frame" width="720" cellspacing="0" cellpadding="0" border="0" style="width:720px;max-width:720px;background:#fffdf8;border-radius:20px;overflow:hidden;box-shadow:0 12px 34px rgba(74,35,16,.12)">
          <tr>
            <td background="${LATACHE_EMAIL_ASSETS.header.url}" valign="top" style="height:300px;background-color:#6a2a13;background-image:url('${LATACHE_EMAIL_ASSETS.header.url}');background-position:center;background-size:cover;border-radius:20px 20px 0 0">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td valign="top" align="center" style="padding:30px 28px;text-align:center;direction:ltr">
                    <center>
                      <img class="header-logo" src="${LATACHE_EMAIL_LOGO_URL}" width="210" align="center" alt="Latache" style="display:block;width:210px;max-width:48%;height:auto;margin:0 auto;border:0;text-align:center">
                    </center>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="email-pad" style="padding:0 56px 14px;background:#fffdf8;text-align:center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%">
                <tr>
                  <td align="center" style="text-align:center;direction:ltr">
                    <center>
                      <img src="${LATACHE_EMAIL_ASSETS.shield.url}" width="190" align="center" alt="" style="display:block;width:190px;max-width:52%;height:auto;margin:-34px auto 2px;border:0;text-align:center">
                    </center>
                  </td>
                </tr>
              </table>
              ${params.content}
            </td>
          </tr>
          <tr>
            <td class="email-pad" style="padding:14px 56px 28px;background:#fffdf8">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #b9dcc1;border-radius:20px;background:#e8f6eb">
                <tr>
                  <td width="62" valign="middle" style="padding:18px 0 18px 20px;color:#17642a;font-size:32px;text-align:center;direction:ltr">✓</td>
                  <td valign="middle" style="padding:16px 22px;color:#145a25;font-size:15px;line-height:22px;text-align:${textAlign}">
                    <strong style="font-size:16px">${escapeHtml(securityTitle)}</strong><br>${escapeHtml(securityBody)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td background="${LATACHE_EMAIL_ASSETS.footer.url}" valign="bottom" style="background-image:url('${LATACHE_EMAIL_ASSETS.footer.url}');background-position:center bottom;background-repeat:no-repeat;background-size:cover;text-align:center;padding-top:166px">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="padding:18px 24px 10px;text-align:center;direction:ltr">
                    <a href="https://latache-web.vercel.app" aria-label="Facebook" style="display:inline-block;width:34px;height:34px;margin:0 4px;border-radius:50%;background:#6a2a13;color:#fff;font-size:17px;font-weight:bold;line-height:34px;text-decoration:none">f</a>
                    <a href="https://latache-web.vercel.app" aria-label="X" style="display:inline-block;width:34px;height:34px;margin:0 4px;border-radius:50%;background:#6a2a13;color:#fff;font-size:14px;line-height:34px;text-decoration:none">X</a>
                    <a href="https://latache-web.vercel.app" aria-label="Instagram" style="display:inline-block;width:34px;height:34px;margin:0 4px;border-radius:50%;background:#6a2a13;color:#fff;font-size:15px;line-height:34px;text-decoration:none">◎</a>
                    <a href="https://latache-web.vercel.app" aria-label="LinkedIn" style="display:inline-block;width:34px;height:34px;margin:0 4px;border-radius:50%;background:#6a2a13;color:#fff;font-size:13px;font-weight:bold;line-height:34px;text-decoration:none">in</a>
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 28px 24px;border-top:1px solid rgba(106,42,19,.35);color:#6a2a13;font-size:12px;line-height:20px;text-align:center;text-shadow:0 1px 0 rgba(255,244,221,.45)">
                    &copy; ${year} Latache. ${copy.rights}<br><em>${copy.footerTagline}</em>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};
