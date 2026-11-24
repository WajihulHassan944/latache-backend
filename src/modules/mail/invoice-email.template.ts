import { escapeHtml } from '../../common/utils/html.util';
import { type EmailLocale, isRtlEmailLocale, latacheEmailLayout, normalizeEmailLocale } from './email-layout';

type InvoiceEmailCopy = {
  subject: (number: string) => string;
  title: string;
  greeting: (name: string) => string;
  intro: string;
  depositIntro: string;
  cancellationIntro: string;
  invoiceLabel: string;
  bookingLabel: string;
  totalLabel: string;
  footer: string;
};

const COPY: Record<EmailLocale, InvoiceEmailCopy> = {
  en: {
    subject: (number) => `Your Latache invoice ${number}`,
    title: 'Your invoice',
    greeting: (name) => `Hello ${name || 'there'},`,
    intro: 'Thank you for your booking. Your invoice is attached to this email as a PDF.',
    depositIntro: 'We received your Tasker signup deposit. Your receipt is attached to this email as a PDF.',
    cancellationIntro: 'Your booking was cancelled inside the late-cancellation window. The invoice for the fee is attached as a PDF; the rest of your payment was refunded.',
    invoiceLabel: 'Invoice',
    bookingLabel: 'Booking',
    totalLabel: 'Total paid',
    footer: 'You can also download all your invoices anytime from the Latache app.',
  },
  fr: {
    subject: (number) => `Votre facture Latache ${number}`,
    title: 'Votre facture',
    greeting: (name) => `Bonjour ${name || ''},`.replace(' ,', ','),
    intro: 'Merci pour votre réservation. Votre facture est jointe à cet e-mail au format PDF.',
    depositIntro: 'Nous avons bien reçu votre dépôt d’inscription Tasker. Votre reçu est joint au format PDF.',
    cancellationIntro: 'Votre réservation a été annulée pendant la période d’annulation tardive. La facture des frais est jointe en PDF ; le reste de votre paiement a été remboursé.',
    invoiceLabel: 'Facture',
    bookingLabel: 'Réservation',
    totalLabel: 'Total payé',
    footer: 'Vous pouvez aussi télécharger toutes vos factures à tout moment depuis l’application Latache.',
  },
  es: {
    subject: (number) => `Tu factura de Latache ${number}`,
    title: 'Tu factura',
    greeting: (name) => `Hola ${name || ''},`.replace(' ,', ','),
    intro: 'Gracias por tu reserva. Tu factura va adjunta a este correo en PDF.',
    depositIntro: 'Hemos recibido tu depósito de registro como Tasker. Tu recibo va adjunto en PDF.',
    cancellationIntro: 'Tu reserva se canceló dentro del plazo de cancelación tardía. La factura de la tarifa va adjunta en PDF; el resto de tu pago fue reembolsado.',
    invoiceLabel: 'Factura',
    bookingLabel: 'Reserva',
    totalLabel: 'Total pagado',
    footer: 'También puedes descargar todas tus facturas en cualquier momento desde la app de Latache.',
  },
  ar: {
    subject: (number) => `فاتورتك من Latache رقم ${number}`,
    title: 'فاتورتك',
    greeting: (name) => `مرحباً ${name || 'بك'}،`,
    intro: 'شكراً لحجزك. فاتورتك مرفقة بهذه الرسالة بصيغة PDF.',
    depositIntro: 'استلمنا وديعة التسجيل الخاصة بك كمقدم خدمة. الإيصال مرفق بصيغة PDF.',
    cancellationIntro: 'تم إلغاء حجزك خلال فترة الإلغاء المتأخر. فاتورة الرسوم مرفقة بصيغة PDF وتم استرداد باقي المبلغ.',
    invoiceLabel: 'الفاتورة',
    bookingLabel: 'الحجز',
    totalLabel: 'المبلغ المدفوع',
    footer: 'يمكنك أيضاً تنزيل جميع فواتيرك في أي وقت من تطبيق Latache.',
  },
  ary: {
    subject: (number) => `الفاتورة ديالك من Latache رقم ${number}`,
    title: 'الفاتورة ديالك',
    greeting: (name) => `السلام ${name || ''}،`.replace(' ،', '،'),
    intro: 'شكراً على الحجز ديالك. الفاتورة مرفقة مع هاد الإيميل بصيغة PDF.',
    depositIntro: 'توصلنا بالضمانة ديال التسجيل ديالك. الوصل مرفق بصيغة PDF.',
    cancellationIntro: 'الحجز ديالك تلغى فالوقت ديال الإلغاء المتأخر. فاتورة الرسوم مرفقة والباقي ترجع ليك.',
    invoiceLabel: 'الفاتورة',
    bookingLabel: 'الحجز',
    totalLabel: 'المجموع المدفوع',
    footer: 'تقدر تحمّل جميع الفواتير ديالك من التطبيق ديال Latache فأي وقت.',
  },
};

export const invoiceEmailTemplate = (params: {
  name: string;
  number: string;
  kind: 'booking' | 'tasker_deposit' | 'late_cancellation';
  bookingId: string | null;
  total: string;
  locale?: string;
}): { subject: string; html: string; text: string } => {
  const locale = normalizeEmailLocale(params.locale);
  const copy = COPY[locale];
  const align = isRtlEmailLocale(locale) ? 'right' : 'left';
  const intro = params.kind === 'tasker_deposit' ? copy.depositIntro : params.kind === 'late_cancellation' ? copy.cancellationIntro : copy.intro;
  const row = (label: string, value: string) =>
    `<tr><td style="padding:10px 14px;color:#8c551f;font-weight:bold;border-bottom:1px solid #efd7ad">${escapeHtml(label)}</td><td dir="ltr" style="padding:10px 14px;color:#4b2112;text-align:${isRtlEmailLocale(locale) ? 'left' : 'right'};border-bottom:1px solid #efd7ad">${escapeHtml(value)}</td></tr>`;
  const html = latacheEmailLayout({
    documentTitle: copy.subject(params.number),
    preheader: intro,
    locale,
    content: `<h1 class="email-title" style="margin:0;color:#60230c;font-family:Georgia,'Times New Roman',serif;font-size:40px;line-height:48px;text-align:center">${escapeHtml(copy.title)}</h1>
      <p style="margin:20px 0 12px;color:#a66229;font-size:21px;line-height:29px;text-align:center">${escapeHtml(copy.greeting(params.name))}</p>
      <p style="margin:0 0 16px;color:#563226;font-size:16px;line-height:25px;text-align:${align}">${escapeHtml(intro)}</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:18px 0;border:1px solid #efd7ad;border-radius:16px;background:#fff5e4;font-size:14px;border-collapse:separate;overflow:hidden">
        ${row(copy.invoiceLabel, params.number)}
        ${params.bookingId ? row(copy.bookingLabel, `#${params.bookingId}`) : ''}
        <tr><td style="padding:12px 14px;color:#60230c;font-weight:bold">${escapeHtml(copy.totalLabel)}</td><td dir="ltr" style="padding:12px 14px;color:#60230c;font-weight:bold;font-size:18px;text-align:${isRtlEmailLocale(locale) ? 'left' : 'right'}">${escapeHtml(params.total)}</td></tr>
      </table>
      <p style="margin:0;color:#a66229;font-size:13px;line-height:20px;text-align:center">${escapeHtml(copy.footer)}</p>`,
  });
  return {
    subject: copy.subject(params.number),
    html,
    text: [copy.title, copy.greeting(params.name), intro, `${copy.invoiceLabel}: ${params.number}`, params.bookingId ? `${copy.bookingLabel}: #${params.bookingId}` : null, `${copy.totalLabel}: ${params.total}`, '', copy.footer]
      .filter((line) => line !== null)
      .join('\n'),
  };
};
