import { escapeHtml } from '../../common/utils/html.util';
import { latacheEmailLayout, normalizeEmailLocale, type EmailLocale } from './email-layout';

interface SecurityEmailCopy {
  documentTitle: string;
  title: string;
  greeting: (name: string) => string;
  intro: string;
  expiry: (minutes: number, device?: string) => string;
  preheader: (otp: number) => string;
}

const verificationCopy: Record<EmailLocale, SecurityEmailCopy> = {
  en: {
    documentTitle: 'Verify your Latache email',
    title: 'Verify your email',
    greeting: (name) => `Hello ${name || 'there'},`,
    intro: 'Use the verification code to complete your Latache account setup:',
    expiry: (minutes, device) =>
      `This code expires in ${minutes} minutes${device ? ` and was requested from ${device}` : ''}.`,
    preheader: (otp) => `Your Latache verification code is ${otp}.`,
  },
  ar: {
    documentTitle: 'تأكيد بريدك الإلكتروني في Latache',
    title: 'تأكيد بريدك الإلكتروني',
    greeting: (name) => `مرحباً ${name || 'بك'}،`,
    intro: 'استخدم رمز التحقق لإكمال إعداد حسابك في Latache:',
    expiry: (minutes, device) =>
      `تنتهي صلاحية هذا الرمز خلال ${minutes} دقائق${device ? `، وقد طُلب من ${device}` : ''}.`,
    preheader: (otp) => `رمز التحقق الخاص بك في Latache هو ${otp}.`,
  },
  ary: {
    documentTitle: 'أكّد الإيميل ديالك فـ Latache',
    title: 'أكّد الإيميل ديالك',
    greeting: (name) => `سلام ${name || 'عليك'}،`,
    intro: 'دخل كود التأكيد هادا باش تكمّل إعداد الحساب ديالك فـ Latache:',
    expiry: (minutes, device) =>
      `هاد الكود غادي تسالي الصلاحية ديالو من بعد ${minutes} دقايق${device ? `، وتطلب من ${device}` : ''}.`,
    preheader: (otp) => `كود التأكيد ديالك فـ Latache هو ${otp}.`,
  },
};

const otpBlock = (otp: number): string =>
  `<div dir="ltr" style="margin:22px 0 20px;padding:22px 16px 14px;border:1px solid #f1d49d;border-radius:20px;background:#fae9c9;background:linear-gradient(100deg,#fae8c5,#fff8e9,#f7dda8);color:#572006;font-size:42px;font-weight:700;letter-spacing:12px;text-align:center">${escapeHtml(String(otp))}<div style="margin-top:10px;color:#b46c22;font-size:13px;font-weight:400;letter-spacing:3px">━━━━ ◆ ━━━━</div></div>`;

const expiryBlock = (text: string, rtl: boolean): string =>
  `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 8px;border:1px solid #f0dfbd;border-radius:999px;background:#fbf0dd"><tr><td width="46" style="padding:12px 0 12px 15px;color:#9d5719;font-size:20px;text-align:center;direction:ltr">◷</td><td style="padding:12px 18px 12px 6px;color:#4f291c;font-size:14px;line-height:21px;text-align:${rtl ? 'right' : 'left'}">${escapeHtml(text)}</td></tr></table>`;

export const verificationEmailTemplate = (params: {
  name: string;
  otp: number;
  expiryMinutes: number;
  device?: string;
  locale?: string;
}): string => {
  const locale = normalizeEmailLocale(params.locale);
  const copy = verificationCopy[locale];
  const name = escapeHtml(params.name);
  const device = params.device;
  return latacheEmailLayout({
    documentTitle: copy.documentTitle,
    preheader: copy.preheader(params.otp),
    locale,
    content: `<h1 class="email-title" style="margin:0;color:#60230c;font-family:Georgia,'Times New Roman',serif;font-size:46px;line-height:54px;text-align:center">${copy.title}</h1>
      <p style="margin:20px 0 18px;color:#a66229;font-size:21px;line-height:29px;text-align:center">${copy.greeting(name)}</p>
      <p style="margin:0;color:#563226;font-size:16px;line-height:25px;text-align:center">${copy.intro}</p>
      ${otpBlock(params.otp)}
      ${expiryBlock(copy.expiry(params.expiryMinutes, device), locale !== 'en')}`,
  });
};

const passwordResetCopy: Record<EmailLocale, SecurityEmailCopy> = {
  en: {
    documentTitle: 'Reset your Latache password',
    title: 'Reset your password',
    greeting: (name) => `Hello ${name || 'there'},`,
    intro: 'Use this one-time code to securely reset your Latache password:',
    expiry: (minutes) =>
      `This code expires in ${minutes} minutes. Ignore this email if you did not request a password reset.`,
    preheader: (otp) => `Your Latache password reset code is ${otp}.`,
  },
  ar: {
    documentTitle: 'إعادة تعيين كلمة مرور Latache',
    title: 'إعادة تعيين كلمة المرور',
    greeting: (name) => `مرحباً ${name || 'بك'}،`,
    intro: 'استخدم هذا الرمز لمرة واحدة لإعادة تعيين كلمة مرور Latache بأمان:',
    expiry: (minutes) =>
      `تنتهي صلاحية هذا الرمز خلال ${minutes} دقائق. تجاهل الرسالة إذا لم تطلب إعادة تعيين كلمة المرور.`,
    preheader: (otp) => `رمز إعادة تعيين كلمة مرور Latache هو ${otp}.`,
  },
  ary: {
    documentTitle: 'بدّل الموط باس ديالك فـ Latache',
    title: 'بدّل الموط باس ديالك',
    greeting: (name) => `سلام ${name || 'عليك'}،`,
    intro: 'استعمل هاد الكود مرة وحدة باش تبدّل الموط باس ديالك بأمان:',
    expiry: (minutes) =>
      `هاد الكود غادي تسالي الصلاحية ديالو من بعد ${minutes} دقايق. إلا ماطلبتيش تبدّل الموط باس، تجاهل هاد الإيميل.`,
    preheader: (otp) => `كود تبديل الموط باس ديالك فـ Latache هو ${otp}.`,
  },
};

export const passwordResetOtpTemplate = (params: {
  name: string;
  otp: number;
  expiryMinutes: number;
  locale?: string;
}): string => {
  const locale = normalizeEmailLocale(params.locale);
  const copy = passwordResetCopy[locale];
  const name = escapeHtml(params.name);
  return latacheEmailLayout({
    documentTitle: copy.documentTitle,
    preheader: copy.preheader(params.otp),
    locale,
    content: `<h1 class="email-title" style="margin:0;color:#60230c;font-family:Georgia,'Times New Roman',serif;font-size:46px;line-height:54px;text-align:center">${copy.title}</h1>
      <p style="margin:20px 0 18px;color:#a66229;font-size:21px;line-height:29px;text-align:center">${copy.greeting(name)}</p>
      <p style="margin:0;color:#563226;font-size:16px;line-height:25px;text-align:center">${copy.intro}</p>
      ${otpBlock(params.otp)}
      ${expiryBlock(copy.expiry(params.expiryMinutes), locale !== 'en')}`,
  });
};

interface AdminWelcomeCopy {
  documentTitle: string;
  title: string;
  greeting: (name: string) => string;
  intro: string;
  email: string;
  password: string;
  role: string;
  instruction: string;
  preheader: string;
  securityTitle: string;
  securityBody: string;
}

const adminWelcomeCopy: Record<EmailLocale, AdminWelcomeCopy> = {
  en: {
    documentTitle: 'Your Latache administrator account',
    title: 'Administrator account created',
    greeting: (name) => `Hello ${name || 'there'},`,
    intro: 'A Latache administrator account has been created for you.',
    email: 'Email',
    password: 'Temporary password',
    role: 'Role',
    instruction: 'Sign in and change the temporary password immediately.',
    preheader: 'Your Latache administrator account is ready.',
    securityTitle: 'Protect your administrator account.',
    securityBody: 'Change the temporary password after first sign-in and never share it.',
  },
  ar: {
    documentTitle: 'حساب مسؤول Latache الخاص بك',
    title: 'تم إنشاء حساب المسؤول',
    greeting: (name) => `مرحباً ${name || 'بك'}،`,
    intro: 'تم إنشاء حساب مسؤول في Latache لك.',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور المؤقتة',
    role: 'الدور',
    instruction: 'سجّل الدخول وغيّر كلمة المرور المؤقتة فوراً.',
    preheader: 'حساب مسؤول Latache الخاص بك جاهز.',
    securityTitle: 'احمِ حساب المسؤول الخاص بك.',
    securityBody: 'غيّر كلمة المرور المؤقتة بعد أول تسجيل دخول ولا تشاركها.',
  },
  ary: {
    documentTitle: 'حساب الأدمن ديالك فـ Latache',
    title: 'تخلق حساب الأدمن ديالك',
    greeting: (name) => `سلام ${name || 'عليك'}،`,
    intro: 'تخلق ليك حساب أدمن فـ Latache.',
    email: 'الإيميل',
    password: 'الموط باس المؤقت',
    role: 'الدور',
    instruction: 'دخل للحساب وبدّل الموط باس المؤقت دغيا.',
    preheader: 'حساب الأدمن ديالك فـ Latache واجد.',
    securityTitle: 'حافظ على حساب الأدمن ديالك.',
    securityBody: 'بدّل الموط باس المؤقت من بعد أول دخول وماتشاركو مع حتى واحد.',
  },
};

export const adminWelcomeTemplate = (params: {
  name: string;
  email: string;
  temporaryPassword: string;
  adminRole: string;
  locale?: string;
}): string => {
  const locale = normalizeEmailLocale(params.locale);
  const copy = adminWelcomeCopy[locale];
  const credentialRow = (label: string, value: string): string =>
    `<tr><td style="padding:9px 12px;color:#8c551f;font-weight:bold">${label}</td><td dir="ltr" style="padding:9px 12px;color:#4b2112;text-align:left;word-break:break-word">${escapeHtml(value)}</td></tr>`;
  return latacheEmailLayout({
    documentTitle: copy.documentTitle,
    preheader: copy.preheader,
    locale,
    securityTitle: copy.securityTitle,
    securityBody: copy.securityBody,
    content: `<h1 class="email-title" style="margin:0;color:#60230c;font-family:Georgia,'Times New Roman',serif;font-size:42px;line-height:50px;text-align:center">${copy.title}</h1>
      <p style="margin:20px 0 12px;color:#a66229;font-size:21px;line-height:29px;text-align:center">${copy.greeting(escapeHtml(params.name))}</p>
      <p style="margin:0 0 18px;color:#563226;font-size:16px;line-height:25px;text-align:center">${copy.intro}</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:18px 0;border:1px solid #efd7ad;border-radius:16px;background:#fff5e4;font-size:14px">
        ${credentialRow(copy.email, params.email)}
        ${credentialRow(copy.password, params.temporaryPassword)}
        ${credentialRow(copy.role, params.adminRole)}
      </table>
      <p style="margin:0 0 8px;color:#563226;font-size:15px;line-height:24px;text-align:center">${copy.instruction}</p>`,
  });
};

export const emailSubject = (
  type: 'verification' | 'password-reset' | 'admin-welcome',
  locale?: string,
): string => {
  const resolved = normalizeEmailLocale(locale);
  if (type === 'verification') return verificationCopy[resolved].documentTitle;
  if (type === 'password-reset') return passwordResetCopy[resolved].documentTitle;
  return adminWelcomeCopy[resolved].documentTitle;
};

export const emailPlainText = (
  type: 'verification' | 'password-reset' | 'admin-welcome',
  params: {
    locale?: string;
    otp?: number;
    expiryMinutes?: number;
    email?: string;
    temporaryPassword?: string;
  },
): string => {
  const locale = normalizeEmailLocale(params.locale);
  if (type === 'verification') {
    if (locale === 'ar')
      return `رمز التحقق الخاص بك في Latache هو ${params.otp}. تنتهي صلاحيته خلال ${params.expiryMinutes} دقائق.`;
    if (locale === 'ary')
      return `كود التأكيد ديالك فـ Latache هو ${params.otp}. غادي تسالي الصلاحية ديالو من بعد ${params.expiryMinutes} دقايق.`;
    return `Your Latache verification code is ${params.otp}. It expires in ${params.expiryMinutes} minutes.`;
  }
  if (type === 'password-reset') {
    if (locale === 'ar')
      return `رمز إعادة تعيين كلمة مرور Latache هو ${params.otp}. تنتهي صلاحيته خلال ${params.expiryMinutes} دقائق.`;
    if (locale === 'ary')
      return `كود تبديل الموط باس ديالك فـ Latache هو ${params.otp}. غادي تسالي الصلاحية ديالو من بعد ${params.expiryMinutes} دقايق.`;
    return `Your Latache password reset code is ${params.otp}. It expires in ${params.expiryMinutes} minutes.`;
  }
  if (locale === 'ar')
    return `حساب مسؤول Latache جاهز. البريد الإلكتروني: ${params.email}. كلمة المرور المؤقتة: ${params.temporaryPassword}. غيّرها بعد تسجيل الدخول.`;
  if (locale === 'ary')
    return `حساب الأدمن ديالك فـ Latache واجد. الإيميل: ${params.email}. الموط باس المؤقت: ${params.temporaryPassword}. بدّلو من بعد ماتدخل.`;
  return `Your Latache administrator account is ready. Email: ${params.email}. Temporary password: ${params.temporaryPassword}. Change it after login.`;
};
