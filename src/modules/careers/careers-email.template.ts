import { escapeHtml } from '../../common/utils/html.util';
import { type EmailLocale, isRtlEmailLocale, latacheEmailLayout, normalizeEmailLocale } from '../mail/email-layout';

type RenderedEmail = { subject: string; html: string; text: string };

const wrap = (params: {
  locale: EmailLocale;
  title: string;
  greeting: string;
  paragraphs: string[];
  facts?: Array<[string, string]>;
  closing: string;
}): { html: string; text: string } => {
  const align = isRtlEmailLocale(params.locale) ? 'right' : 'left';
  const facts = params.facts?.length
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:18px 0;border:1px solid #efd7ad;border-radius:16px;background:#fff5e4;font-size:14px;border-collapse:separate">${params.facts
        .map(
          ([label, value], index, all) =>
            `<tr><td style="padding:10px 14px;color:#8c551f;font-weight:bold;${index < all.length - 1 ? 'border-bottom:1px solid #efd7ad' : ''}">${escapeHtml(label)}</td><td dir="ltr" style="padding:10px 14px;color:#4b2112;text-align:${isRtlEmailLocale(params.locale) ? 'left' : 'right'};${index < all.length - 1 ? 'border-bottom:1px solid #efd7ad' : ''}">${escapeHtml(value)}</td></tr>`,
        )
        .join('')}</table>`
    : '<div style="height:6px;line-height:6px;font-size:0">&nbsp;</div>';
  const html = latacheEmailLayout({
    documentTitle: params.title,
    preheader: params.paragraphs[0] ?? params.title,
    locale: params.locale,
    content: `<h1 class="email-title" style="margin:0;color:#60230c;font-family:Georgia,'Times New Roman',serif;font-size:38px;line-height:46px;text-align:center">${escapeHtml(params.title)}</h1>
      <p style="margin:20px 0 12px;color:#a66229;font-size:21px;line-height:29px;text-align:center">${escapeHtml(params.greeting)}</p>
      ${params.paragraphs.map((p) => `<p style="margin:0 0 14px;color:#563226;font-size:16px;line-height:25px;text-align:${align}">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('')}
      ${facts}
      <p style="margin:0;color:#a66229;font-size:13px;line-height:20px;text-align:center">${escapeHtml(params.closing)}</p>`,
  });
  const text = [params.title, params.greeting, ...params.paragraphs, ...(params.facts ?? []).map(([l, v]) => `${l}: ${v}`), '', params.closing].join('\n');
  return { html, text };
};

const greeting = (locale: EmailLocale, name: string): string => {
  const first = name.trim().split(/\s+/)[0] || '';
  switch (locale) {
    case 'fr': return `Bonjour ${first},`.replace(' ,', ',');
    case 'es': return `Hola ${first},`.replace(' ,', ',');
    case 'ar': return `مرحباً ${first || 'بك'}،`;
    case 'ary': return `السلام ${first}،`.replace(' ،', '،');
    default: return `Hello ${first || 'there'},`;
  }
};

const CONFIRMATION: Record<EmailLocale, { subject: (role: string) => string; title: string; body: (role: string) => string; next: string; ref: string; role: string; general: string; closing: string }> = {
  en: {
    subject: (role) => `We received your application - ${role}`,
    title: 'Application received',
    body: (role) => `Thank you for applying to Latache${role ? ` for the ${role} role` : ''}. Our team will review your application and get back to you within 3-5 business days.`,
    next: 'What happens next: we review your profile, then a short call if there is a match, then a conversation with the team.',
    ref: 'Reference',
    role: 'Role',
    general: 'General application',
    closing: 'The Latache Talent Team',
  },
  fr: {
    subject: (role) => `Nous avons bien reçu votre candidature - ${role}`,
    title: 'Candidature reçue',
    body: (role) => `Merci d'avoir postulé chez Latache${role ? ` pour le poste ${role}` : ''}. Notre équipe étudie votre candidature et vous répondra sous 3 à 5 jours ouvrés.`,
    next: "La suite : nous examinons votre profil, puis un court appel en cas de correspondance, puis un échange avec l'équipe.",
    ref: 'Référence',
    role: 'Poste',
    general: 'Candidature spontanée',
    closing: "L'équipe Talents de Latache",
  },
  es: {
    subject: (role) => `Hemos recibido tu candidatura - ${role}`,
    title: 'Candidatura recibida',
    body: (role) => `Gracias por postularte a Latache${role ? ` para el puesto de ${role}` : ''}. Nuestro equipo revisará tu candidatura y te responderá en 3-5 días laborables.`,
    next: 'Qué sigue: revisamos tu perfil, luego una breve llamada si encaja y después una conversación con el equipo.',
    ref: 'Referencia',
    role: 'Puesto',
    general: 'Candidatura espontánea',
    closing: 'El equipo de Talento de Latache',
  },
  ar: {
    subject: (role) => `استلمنا طلبك - ${role}`,
    title: 'تم استلام طلبك',
    body: (role) => `شكراً لتقديمك إلى Latache${role ? ` لوظيفة ${role}` : ''}. سيراجع فريقنا طلبك ويعود إليك خلال 3-5 أيام عمل.`,
    next: 'الخطوات التالية: نراجع ملفك، ثم مكالمة قصيرة إذا كان هناك توافق، ثم حديث مع الفريق.',
    ref: 'المرجع',
    role: 'الوظيفة',
    general: 'طلب عام',
    closing: 'فريق المواهب في Latache',
  },
  ary: {
    subject: (role) => `توصلنا بطلبك - ${role}`,
    title: 'توصلنا بطلبك',
    body: (role) => `شكراً على التقديم ديالك ل Latache${role ? ` ل وظيفة ${role}` : ''}. الفريق ديالنا غادي يراجع الطلب ويرجع ليك ف 3 حتى 5 أيام ديال الخدمة.`,
    next: 'اللي من بعد: كنراجعو البروفايل ديالك، من بعد مكالمة قصيرة إلا كان توافق، ومن بعد هضرة مع الفريق.',
    ref: 'المرجع',
    role: 'الوظيفة',
    general: 'طلب عام',
    closing: 'فريق المواهب ديال Latache',
  },
};

export const applicationConfirmationEmail = (params: { name: string; reference: string; roleTitle: string | null; locale?: string }): RenderedEmail => {
  const locale = normalizeEmailLocale(params.locale);
  const c = CONFIRMATION[locale];
  const roleLabel = params.roleTitle ?? c.general;
  const { html, text } = wrap({
    locale,
    title: c.title,
    greeting: greeting(locale, params.name),
    paragraphs: [c.body(params.roleTitle ?? ''), c.next],
    facts: [[c.role, roleLabel], [c.ref, params.reference]],
    closing: c.closing,
  });
  return { subject: c.subject(roleLabel), html, text };
};

export const CANDIDATE_EMAIL_TEMPLATES = ['screening_invite', 'interview_invite', 'offer', 'rejection'] as const;
export type CandidateEmailTemplate = (typeof CANDIDATE_EMAIL_TEMPLATES)[number];

type TemplateCopy = { subject: (role: string) => string; title: string; paragraphs: (role: string) => string[] };
const CANDIDATE: Record<'en' | 'fr', Record<CandidateEmailTemplate, TemplateCopy>> = {
  en: {
    screening_invite: {
      subject: (r) => `Let's talk - ${r}`,
      title: "Let's talk",
      paragraphs: (r) => [`Thank you for your interest in the ${r} role at Latache. Your profile caught our attention and we would like to schedule a short introductory call.`, 'Please reply to this email with a few time slots that suit you this week.'],
    },
    interview_invite: {
      subject: (r) => `Interview invitation - ${r}`,
      title: 'Interview invitation',
      paragraphs: (r) => [`We enjoyed getting to know you and would like to invite you to an interview for the ${r} role.`, 'Please reply with your availability and we will confirm the details.'],
    },
    offer: {
      subject: (r) => `Your offer from Latache - ${r}`,
      title: 'We would love you to join us',
      paragraphs: (r) => [`We are delighted to offer you the ${r} role at Latache.`, 'We will send the details separately. Please reply to this email so we can walk you through the next steps.'],
    },
    rejection: {
      subject: (r) => `Your application - ${r}`,
      title: 'Thank you for applying',
      paragraphs: (r) => [`Thank you for the time you invested in applying for the ${r} role. After careful consideration we have decided to move forward with other candidates.`, 'We will keep your profile on file and encourage you to apply again for future openings.'],
    },
  },
  fr: {
    screening_invite: {
      subject: (r) => `Échangeons - ${r}`,
      title: 'Échangeons',
      paragraphs: (r) => [`Merci de votre intérêt pour le poste ${r} chez Latache. Votre profil a retenu notre attention et nous aimerions planifier un court appel de présentation.`, 'Merci de répondre à cet e-mail avec quelques créneaux qui vous conviennent cette semaine.'],
    },
    interview_invite: {
      subject: (r) => `Invitation à un entretien - ${r}`,
      title: 'Invitation à un entretien',
      paragraphs: (r) => [`Nous avons apprécié faire votre connaissance et souhaitons vous inviter à un entretien pour le poste ${r}.`, 'Merci de répondre avec vos disponibilités et nous confirmerons les détails.'],
    },
    offer: {
      subject: (r) => `Votre offre Latache - ${r}`,
      title: 'Nous aimerions que vous nous rejoigniez',
      paragraphs: (r) => [`Nous sommes ravis de vous proposer le poste ${r} chez Latache.`, "Nous vous enverrons les détails séparément. Merci de répondre à cet e-mail pour que nous puissions vous présenter la suite."],
    },
    rejection: {
      subject: (r) => `Votre candidature - ${r}`,
      title: 'Merci pour votre candidature',
      paragraphs: (r) => [`Merci du temps consacré à votre candidature au poste ${r}. Après examen attentif, nous avons décidé de poursuivre avec d'autres candidats.`, "Nous conservons votre profil et vous encourageons à postuler à nouveau lors de futures ouvertures."],
    },
  },
};

export const candidateEmail = (params: {
  template: CandidateEmailTemplate;
  name: string;
  roleTitle: string | null;
  note?: string;
  locale?: string;
}): RenderedEmail => {
  const locale = normalizeEmailLocale(params.locale);
  const lang: 'en' | 'fr' = locale === 'fr' ? 'fr' : 'en';
  const copy = CANDIDATE[lang][params.template];
  const role = params.roleTitle ?? (lang === 'fr' ? 'candidature spontanée' : 'general application');
  const paragraphs = [...copy.paragraphs(role), ...(params.note?.trim() ? [params.note.trim()] : [])];
  const { html, text } = wrap({
    locale: lang,
    title: copy.title,
    greeting: greeting(lang, params.name),
    paragraphs,
    closing: lang === 'fr' ? "L'équipe Talents de Latache" : 'The Latache Talent Team',
  });
  return { subject: copy.subject(role), html, text };
};
