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

interface DisputeLifecycleCopy {
  subject: string;
  title: string;
  intro: string;
  caseLabel: string;
  actionLabel: string;
}

const disputeLifecycleCopy: Record<EmailLocale, DisputeLifecycleCopy> = {
  en: {
    subject: 'Update on your Latache dispute',
    title: 'Dispute update',
    intro: 'There is an update on a booking dispute linked to your Latache account.',
    caseLabel: 'Dispute',
    actionLabel: 'Update',
  },
  ar: {
    subject: 'تحديث بشأن نزاعك في Latache',
    title: 'تحديث النزاع',
    intro: 'يوجد تحديث على نزاع حجز مرتبط بحسابك في Latache.',
    caseLabel: 'النزاع',
    actionLabel: 'التحديث',
  },
  ary: {
    subject: 'تحديث على النزاع ديالك فـ Latache',
    title: 'تحديث النزاع',
    intro: 'كاين تحديث على نزاع ديال حجز مربوط بالحساب ديالك فـ Latache.',
    caseLabel: 'النزاع',
    actionLabel: 'التحديث',
  },
};

interface DisputeLifecycleEventCopy {
  label: string;
  body?: string;
}

const disputeLifecycleEventCopy: Partial<
  Record<string, Record<EmailLocale, DisputeLifecycleEventCopy>>
> = {
  booking_dispute_opened: {
    en: { label: 'Dispute opened', body: 'A dispute was submitted for this booking and is now under review.' },
    ar: { label: 'تم فتح النزاع', body: 'تم تقديم نزاع بشأن هذا الحجز وهو الآن قيد المراجعة.' },
    ary: { label: 'تحلّ النزاع', body: 'تقدّم نزاع على هاد الحجز ودابا راه كيتراجع.' },
  },
  dispute_investigation_started: {
    en: { label: 'Investigation started', body: 'Latache has started reviewing the booking dispute.' },
    ar: { label: 'بدأ التحقيق', body: 'بدأ فريق Latache مراجعة نزاع الحجز.' },
    ary: { label: 'بدات المراجعة', body: 'فريق Latache بدا كيراجع نزاع الحجز.' },
  },
  dispute_assignment_updated: {
    en: { label: 'Assignment updated', body: 'The administrator assigned to the dispute was updated.' },
    ar: { label: 'تم تحديث المسؤول', body: 'تم تحديث المسؤول المكلّف بمتابعة النزاع.' },
    ary: { label: 'تبدّل الأدمن المكلّف', body: 'تحدّث الأدمن اللي مكلّف بمتابعة النزاع.' },
  },
  dispute_priority_updated: {
    en: { label: 'Priority updated', body: 'The review priority for the dispute was updated.' },
    ar: { label: 'تم تحديث الأولوية', body: 'تم تحديث أولوية مراجعة النزاع.' },
    ary: { label: 'تبدّلات الأولوية', body: 'تحدّثات أولوية مراجعة النزاع.' },
  },
  dispute_escalated: {
    en: { label: 'Dispute escalated', body: 'The dispute was escalated for additional review.' },
    ar: { label: 'تم تصعيد النزاع', body: 'تم تصعيد النزاع لمراجعة إضافية.' },
    ary: { label: 'تصعّد النزاع', body: 'تصعّد النزاع باش يتراجع بشكل إضافي.' },
  },
  dispute_reopened: {
    en: { label: 'Dispute reopened', body: 'The dispute was reopened and its financial hold was reapplied.' },
    ar: { label: 'أعيد فتح النزاع', body: 'أعيد فتح النزاع وتمت إعادة تطبيق الحجز المالي المرتبط به.' },
    ary: { label: 'تعاود تحلّ النزاع', body: 'تعاود تحلّ النزاع وتعاود تطبّق الحجز المالي ديالو.' },
  },
  dispute_withdrawn: {
    en: { label: 'Dispute withdrawn', body: 'The participant who filed the dispute withdrew it.' },
    ar: { label: 'تم سحب النزاع', body: 'قام المشارك الذي فتح النزاع بسحبه.' },
    ary: { label: 'تسحب النزاع', body: 'المشارك اللي حلّ النزاع سحبو.' },
  },
  dispute_comment_added: {
    en: { label: 'New dispute comment', body: 'A participant added a comment to the dispute thread.' },
    ar: { label: 'تعليق جديد على النزاع', body: 'أضاف أحد المشاركين تعليقاً إلى محادثة النزاع.' },
    ary: { label: 'تعليق جديد فالنزاع', body: 'واحد المشارك زاد تعليق فخيط النزاع.' },
  },
  dispute_settlement_proposed: {
    en: { label: 'Settlement proposed', body: 'Latache proposed a settlement. Review it before the response deadline.' },
    ar: { label: 'تم اقتراح تسوية', body: 'اقترحت Latache تسوية. راجعها قبل انتهاء مهلة الرد.' },
    ary: { label: 'تقترحات تسوية', body: 'Latache اقترحات تسوية. راجعها قبل ما تسالي مهلة الجواب.' },
  },
  dispute_settlement_response: {
    en: { label: 'Settlement response', body: 'A participant responded to the proposed dispute settlement.' },
    ar: { label: 'رد على التسوية', body: 'رد أحد المشاركين على التسوية المقترحة للنزاع.' },
    ary: { label: 'جواب على التسوية', body: 'واحد المشارك جاوب على التسوية المقترحة ديال النزاع.' },
  },
  dispute_appealed: {
    en: { label: 'Dispute appealed', body: 'A participant appealed the closed dispute and the case is under review again.' },
    ar: { label: 'تم استئناف النزاع', body: 'استأنف أحد المشاركين النزاع المغلق وأصبحت القضية قيد المراجعة من جديد.' },
    ary: { label: 'تدار استئناف للنزاع', body: 'واحد المشارك استأنف النزاع المسدود والقضية رجعات للمراجعة.' },
  },
  dispute_evidence_reminder: {
    en: { label: 'Evidence reminder', body: 'The deadline for requested dispute evidence is approaching.' },
    ar: { label: 'تذكير بالأدلة', body: 'اقترب الموعد النهائي لتقديم الأدلة المطلوبة في النزاع.' },
    ary: { label: 'تذكير بالدليل', body: 'قرب الموعد النهائي باش يتقدّم الدليل المطلوب فالنزاع.' },
  },
  dispute_evidence_overdue: {
    en: { label: 'Evidence overdue', body: 'The requested evidence deadline has passed.' },
    ar: { label: 'تأخر تقديم الأدلة', body: 'انتهت مهلة تقديم الأدلة المطلوبة.' },
    ary: { label: 'تأخر الدليل', body: 'سالَات مهلة تقديم الدليل المطلوب.' },
  },
  dispute_evidence_expired: {
    en: { label: 'Evidence request expired', body: 'An evidence request expired and the dispute was escalated for review.' },
    ar: { label: 'انتهت مهلة طلب الأدلة', body: 'انتهت مهلة طلب الأدلة وتم تصعيد النزاع للمراجعة.' },
    ary: { label: 'سالَات مهلة طلب الدليل', body: 'سالَات مهلة طلب الدليل وتصعّد النزاع للمراجعة.' },
  },
  dispute_evidence_received: {
    en: { label: 'Evidence received', body: 'Verified evidence was added to the dispute record.' },
    ar: { label: 'تم استلام الأدلة', body: 'تمت إضافة أدلة متحقق منها إلى سجل النزاع.' },
    ary: { label: 'توصلنا بالدليل', body: 'تزاد دليل متحقق منو لسجل النزاع.' },
  },
  dispute_evidence_reviewed: {
    en: { label: 'Evidence reviewed', body: 'Latache reviewed the evidence currently attached to the dispute.' },
    ar: { label: 'تمت مراجعة الأدلة', body: 'راجعت Latache الأدلة المرفقة حالياً بالنزاع.' },
    ary: { label: 'تراجع الدليل', body: 'Latache راجعات الدليل المرفق دابا بالنزاع.' },
  },
  dispute_sla_breached: {
    en: { label: 'Review SLA exceeded', body: 'The dispute exceeded its review SLA and was escalated for priority handling.' },
    ar: { label: 'تم تجاوز مهلة المراجعة', body: 'تجاوز النزاع مهلة المراجعة وتم تصعيده للمعالجة ذات الأولوية.' },
    ary: { label: 'تفاتت مهلة المراجعة', body: 'النزاع فات مهلة المراجعة وتصعّد باش يتعالج بالأولوية.' },
  },
  dispute_cash_refund_pending: {
    en: { label: 'Cash refund pending confirmation', body: 'A cash refund requires an auditable manual transfer. It will not be marked complete until an authorized administrator confirms the transfer reference.' },
    ar: { label: 'استرداد نقدي بانتظار التأكيد', body: 'يتطلب الاسترداد النقدي تحويلاً يدوياً قابلاً للتدقيق، ولن يُعتبر مكتملاً حتى يؤكد مسؤول مخوّل مرجع التحويل.' },
    ary: { label: 'الترجيع ديال الكاش كيتسنى التأكيد', body: 'الترجيع ديال الكاش خاصو تحويل يدوي قابل للتدقيق، وما غاديش يتحسب سالا حتى يأكد أدمن مخوّل مرجع التحويل.' },
  },
  dispute_cash_refund_confirmed: {
    en: { label: 'Cash refund confirmed', body: 'The recorded manual cash refund transfer was confirmed by an authorized administrator.' },
    ar: { label: 'تم تأكيد الاسترداد النقدي', body: 'أكد مسؤول مخوّل التحويل اليدوي المسجل للاسترداد النقدي.' },
    ary: { label: 'تأكد الترجيع ديال الكاش', body: 'أدمن مخوّل أكد التحويل اليدوي المسجل ديال الترجيع.' },
  },
};

const localizedDisputeLifecycleEvent = (
  eventType: string,
  locale: EmailLocale,
  originalDetail: string,
): DisputeLifecycleEventCopy => {
  const configured = disputeLifecycleEventCopy[eventType]?.[locale];
  if (configured) return configured;
  return {
    label: eventType.replaceAll('_', ' '),
    // Admin/user-authored evidence requests and resolution summaries remain in their original language.
    body: originalDetail,
  };
};

export const disputeLifecycleEmailTemplate = (params: {
  name: string;
  disputeId: string;
  eventType: string;
  detail: string;
  locale?: string;
}): { subject: string; html: string; text: string } => {
  const locale = normalizeEmailLocale(params.locale);
  const copy = disputeLifecycleCopy[locale];
  const name = escapeHtml(params.name);
  const event = localizedDisputeLifecycleEvent(params.eventType, locale, params.detail);
  const detail = escapeHtml(event.body ?? params.detail);
  const disputeId = escapeHtml(params.disputeId);
  const eventType = escapeHtml(event.label);
  const greeting =
    locale === 'ar'
      ? `مرحباً ${name || 'بك'}،`
      : locale === 'ary'
        ? `سلام ${name || 'عليك'}،`
        : `Hello ${name || 'there'},`;
  const html = latacheEmailLayout({
    documentTitle: copy.subject,
    preheader: copy.intro,
    locale,
    content: `<h1 class="email-title" style="margin:0;color:#60230c;font-family:Georgia,'Times New Roman',serif;font-size:42px;line-height:50px;text-align:center">${copy.title}</h1>
      <p style="margin:20px 0 12px;color:#a66229;font-size:21px;line-height:29px;text-align:center">${greeting}</p>
      <p style="margin:0 0 18px;color:#563226;font-size:16px;line-height:25px;text-align:center">${copy.intro}</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:18px 0;border:1px solid #efd7ad;border-radius:16px;background:#fff5e4;font-size:14px">
        <tr><td style="padding:10px 12px;color:#8c551f;font-weight:bold">${copy.caseLabel}</td><td dir="ltr" style="padding:10px 12px;color:#4b2112;text-align:left">${disputeId}</td></tr>
        <tr><td style="padding:10px 12px;color:#8c551f;font-weight:bold">${copy.actionLabel}</td><td style="padding:10px 12px;color:#4b2112">${eventType}</td></tr>
      </table>
      <p style="margin:0;color:#563226;font-size:15px;line-height:24px;text-align:${locale === 'en' ? 'left' : 'right'}">${detail}</p>`,
  });
  return {
    subject: copy.subject,
    html,
    text: `${copy.subject}\n${copy.caseLabel}: ${params.disputeId}\n${copy.actionLabel}: ${event.label}\n${event.body ?? params.detail}`,
  };
};
