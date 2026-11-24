import { escapeHtml } from '../../common/utils/html.util';
import { type EmailLocale, isRtlEmailLocale, latacheEmailLayout, normalizeEmailLocale } from '../mail/email-layout';

type RenderedEmail = { subject: string; html: string; text: string };

const COPY: Record<'en' | 'fr' | 'es' | 'ar', { subject: (ref: string) => string; title: string; greeting: (n: string) => string; body: string; ref: string; closing: string; replySubject: (ref: string) => string; replyTitle: string; replyFoot: string }> = {
  en: {
    subject: (ref) => `We got your message (${ref})`,
    title: 'We got your message',
    greeting: (n) => `Hello ${n},`,
    body: 'Thank you for contacting Latache. Our team will read your message and reply by email, usually within one working day.',
    ref: 'Your reference',
    closing: 'Please keep this reference if you write to us again.',
    replySubject: (ref) => `Re: your message to Latache (${ref})`,
    replyTitle: 'A reply from Latache',
    replyFoot: 'You can reply directly to this email and it will reach our team.',
  },
  fr: {
    subject: (ref) => `Nous avons bien reçu votre message (${ref})`,
    title: 'Message bien reçu',
    greeting: (n) => `Bonjour ${n},`,
    body: "Merci d'avoir contacté Latache. Notre équipe lira votre message et vous répondra par e-mail, généralement sous un jour ouvré.",
    ref: 'Votre référence',
    closing: 'Conservez cette référence si vous nous réécrivez.',
    replySubject: (ref) => `Re : votre message à Latache (${ref})`,
    replyTitle: 'Une réponse de Latache',
    replyFoot: "Vous pouvez répondre directement à cet e-mail, il parviendra à notre équipe.",
  },
  es: {
    subject: (ref) => `Recibimos tu mensaje (${ref})`,
    title: 'Recibimos tu mensaje',
    greeting: (n) => `Hola ${n},`,
    body: 'Gracias por contactar con Latache. Nuestro equipo leerá tu mensaje y te responderá por correo, normalmente en un día laborable.',
    ref: 'Tu referencia',
    closing: 'Guarda esta referencia si nos vuelves a escribir.',
    replySubject: (ref) => `Re: tu mensaje a Latache (${ref})`,
    replyTitle: 'Una respuesta de Latache',
    replyFoot: 'Puedes responder directamente a este correo y llegará a nuestro equipo.',
  },
  ar: {
    subject: (ref) => `وصلتنا رسالتك (${ref})`,
    title: 'وصلتنا رسالتك',
    greeting: (n) => `مرحبًا ${n}،`,
    body: 'شكرًا لتواصلك مع لاتاش. سيقرأ فريقنا رسالتك ويردّ عليك عبر البريد الإلكتروني، عادةً خلال يوم عمل واحد.',
    ref: 'رقمك المرجعي',
    closing: 'احتفظ بهذا الرقم إذا راسلتنا مجددًا.',
    replySubject: (ref) => `رد: رسالتك إلى لاتاش (${ref})`,
    replyTitle: 'ردّ من لاتاش',
    replyFoot: 'يمكنك الرد مباشرةً على هذا البريد وسيصل إلى فريقنا.',
  },
};

const pick = (locale: string) => {
  const l = normalizeEmailLocale(locale) as EmailLocale;
  return { l, copy: COPY[(l === 'ar' || l === 'fr' || l === 'es' ? l : l === ('ary' as EmailLocale) ? 'ar' : 'en') as 'en' | 'fr' | 'es' | 'ar'] };
};

const shell = (l: EmailLocale, title: string, inner: string, preheader: string) =>
  latacheEmailLayout({
    documentTitle: title,
    preheader,
    locale: l,
    content: `<h1 class="email-title" style="margin:0;color:#60230c;font-family:Georgia,'Times New Roman',serif;font-size:36px;line-height:44px;text-align:center">${escapeHtml(title)}</h1>${inner}`,
  });

export function enquiryReceivedEmail(params: { locale: string; name: string; reference: string }): RenderedEmail {
  const { l, copy } = pick(params.locale);
  const align = isRtlEmailLocale(l) ? 'right' : 'left';
  const first = params.name.trim().split(/\s+/)[0] || '';
  const html = shell(
    l,
    copy.title,
    `<p style="margin:20px 0 12px;color:#a66229;font-size:20px;line-height:28px;text-align:center">${escapeHtml(copy.greeting(first))}</p>
     <p style="margin:0 0 16px;color:#563226;font-size:16px;line-height:25px;text-align:${align}">${escapeHtml(copy.body)}</p>
     <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:18px 0;border:1px solid #efd7ad;border-radius:16px;background:#fff5e4;font-size:15px;border-collapse:separate"><tr><td style="padding:12px 16px;color:#8c551f;font-weight:bold">${escapeHtml(copy.ref)}</td><td dir="ltr" style="padding:12px 16px;color:#4b2112;text-align:right;font-weight:bold">${escapeHtml(params.reference)}</td></tr></table>
     <p style="margin:0;color:#a66229;font-size:13px;line-height:20px;text-align:center">${escapeHtml(copy.closing)}</p>`,
    copy.body,
  );
  return {
    subject: copy.subject(params.reference),
    html,
    text: [copy.title, copy.greeting(first), copy.body, `${copy.ref}: ${params.reference}`, '', copy.closing].join('\n'),
  };
}

export function enquiryReplyEmail(params: { locale: string; name: string; reference: string; body: string }): RenderedEmail {
  const { l, copy } = pick(params.locale);
  const align = isRtlEmailLocale(l) ? 'right' : 'left';
  const first = params.name.trim().split(/\s+/)[0] || '';
  const html = shell(
    l,
    copy.replyTitle,
    `<p style="margin:20px 0 12px;color:#a66229;font-size:20px;line-height:28px;text-align:center">${escapeHtml(copy.greeting(first))}</p>
     <p style="margin:0 0 16px;color:#563226;font-size:16px;line-height:26px;text-align:${align}">${escapeHtml(params.body).replace(/\n/g, '<br>')}</p>
     <p style="margin:18px 0 0;color:#a66229;font-size:13px;line-height:20px;text-align:center">${escapeHtml(copy.replyFoot)} · ${escapeHtml(params.reference)}</p>`,
    params.body.slice(0, 120),
  );
  return {
    subject: copy.replySubject(params.reference),
    html,
    text: [copy.greeting(first), '', params.body, '', `${copy.replyFoot} (${params.reference})`].join('\n'),
  };
}
