import { bookingRef } from '../../common/utils/booking-ref.util';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';

export interface InvoiceDocument {
  number: string;
  type: string;
  status: string;
  currency: string;
  issuedAt: string;
  bookingId: string | null;
  paymentMethod: string | null;
  subtotal: number;
  platformFee: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  lines: Array<{ code: string; description: string; quantity: number; unitAmount: number; amount: number }>;
  details: Record<string, unknown> | null;
  seller: Record<string, unknown>;
  buyer: Record<string, unknown>;
}

/** Latache brand palette - the same tokens as the transactional emails (mail/email-layout.ts). */
export const LATACHE_THEME = {
  ink: '#4B2112',
  heading: '#60230C',
  brown: '#6A2A13',
  copper: '#A66229',
  gold: '#F7DDA8',
  muted: '#8C551F',
  rule: '#EFD7AD',
  cream: '#FFF5E4',
  creamDeep: '#FBF0DD',
  /** Matches the cream at the bottom of the header artwork so the wave blends seamlessly. */
  page: '#F6EEE3',
  paidBg: '#E8F6EB',
  paidInk: '#1F6B3A',
} as const;

const T = LATACHE_THEME;
const PAGE = { width: 595.28, height: 841.89, margin: 44 };
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;
const HEADER_HEIGHT = 150;
const FOOTER_HEIGHT = 78;

export const PAYMENT_LABELS: Record<string, string> = {
  stripe: 'Card (online)',
  wallet: 'Latache wallet',
  cash: 'Cash (paid to Tasker)',
  cmi: 'Card (CMI)',
  manual: 'Bank transfer',
};

/** Brand artwork bundled with the build (nest-cli assets), loaded once. Missing files degrade to flat colors. */
const ASSET_DIR = join(__dirname, 'assets');
const loadAsset = (name: string): Buffer | null => {
  const path = join(ASSET_DIR, name);
  return existsSync(path) ? readFileSync(path) : null;
};
const ASSETS = {
  header: loadAsset('header.jpg'),
  footer: loadAsset('footer.jpg'),
  logo: loadAsset('logo.png'),
  /** Noto Naskh Arabic (SIL OFL 1.1, see NotoNaskhArabic-OFL.txt). */
  arabic: loadAsset('NotoNaskhArabic.ttf'),
};

const ARABIC_CHAR = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const LATIN_STRONG = /[A-Za-zÀ-ɏ]/;
const DIGIT = /[0-9]/;
type BidiRun = { text: string; kind: 'A' | 'L' | 'D' | 'N' };

/**
 * Minimal bidi for single-line labels (names, addresses, services): split into
 * Arabic / Latin-digit / neutral runs, merge neutrals between same-direction
 * runs, and return them in visual (left-to-right drawing) order. Arabic runs are
 * shaped right-to-left by fontkit; digits and Latin stay left-to-right.
 */
export function bidiVisualRuns(text: string): BidiRun[] {
  const raw: BidiRun[] = [];
  for (const ch of text) {
    const kind: BidiRun['kind'] = ARABIC_CHAR.test(ch) ? 'A' : LATIN_STRONG.test(ch) ? 'L' : DIGIT.test(ch) ? 'D' : 'N';
    const last = raw[raw.length - 1];
    if (last && last.kind === kind) last.text += ch;
    else raw.push({ text: ch, kind });
  }
  const merged: BidiRun[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const run = raw[i] as BidiRun;
    const prev = merged[merged.length - 1];
    const next = raw[i + 1];
    if (run.kind === 'N' && prev && next && prev.kind === next.kind && prev.kind !== 'N') {
      prev.text += run.text + next.text;
      i += 1;
    } else if (prev && prev.kind === run.kind) {
      prev.text += run.text;
    } else {
      merged.push({ ...run });
    }
  }
  // Digits are weak: the paragraph direction comes from the first letter (Unicode bidi P2).
  const firstStrong = merged.find((run) => run.kind === 'A' || run.kind === 'L');
  return firstStrong?.kind === 'A' ? merged.reverse() : merged;
}

/**
 * Lets the existing doc.text(...) calls print Arabic: any string containing
 * Arabic is drawn as one line in Noto Naskh Arabic with bidi ordering,
 * honouring width/align and shrinking to fit. Other text is untouched.
 */
export function enableArabicText(doc: PDFKit.PDFDocument): void {
  if (!ASSETS.arabic) return;
  doc.registerFont('LatacheArabic', ASSETS.arabic);
  const original = doc.text.bind(doc) as (...args: unknown[]) => PDFKit.PDFDocument;
  const internal = doc as unknown as { _font: unknown; _fontSize: number; x: number; y: number };
  (doc as unknown as { text: (...args: unknown[]) => PDFKit.PDFDocument }).text = (...args: unknown[]) => {
    const [value, x, y, maybeOptions] = args;
    if (typeof value !== 'string' || !ARABIC_CHAR.test(value) || typeof x !== 'number' || typeof y !== 'number') {
      return original(...args);
    }
    const options = (maybeOptions ?? {}) as { width?: number; align?: string };
    const savedFont = internal._font;
    const savedSize = internal._fontSize;
    const width = options.width ?? PAGE.width - PAGE.margin - x;
    const runs = bidiVisualRuns(value.replace(/\s+/g, ' ').trim()).map((run) => ({
      ...run,
      // pdfkit wraps per word; NBSP keeps each Arabic phrase one shaped run.
      text: run.kind === 'A' ? run.text.replace(/ /g, ' ') : run.text,
    }));
    let size = savedSize;
    doc.font('LatacheArabic', size);
    const measure = () => runs.reduce((sum, run) => sum + doc.widthOfString(run.text), 0);
    let total = measure();
    while (total > width && size > 6) {
      size -= 0.5;
      doc.fontSize(size);
      total = measure();
    }
    let cx = options.align === 'right' ? x + width - total : options.align === 'center' ? x + (width - total) / 2 : x;
    // Naskh sits a little lower than Helvetica at the same size; nudge up to share the baseline.
    const top = y - size * 0.18;
    for (const run of runs) {
      original(run.text, cx, top, { lineBreak: false });
      cx += doc.widthOfString(run.text);
    }
    internal.x = x;
    internal.y = y + savedSize * 1.25;
    internal._font = savedFont;
    doc.fontSize(savedSize);
    return doc;
  };
}

/** Standard PDF fonts are WinAnsi-only: keep Latin-1 (accents fine), replace anything else. */
const pdfText = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    // Arabic is kept: enableArabicText() draws it with the bundled Noto Naskh Arabic font.
    .replace(/[^\x20-\x7E\xA0-\xFF\n؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g, '?');

export function formatMoney(amount: number, currency: string): string {
  if (Object.is(amount, -0) || Math.abs(amount) < 0.005) amount = 0; // never print "-0.00"
  if (amount < 0) return `- ${formatMoney(-amount, currency)}`;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'code' })
      .format(amount)
      .replace(/ /g, ' ');
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function renderInvoicePdf(invoice: InvoiceDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: PAGE.margin,
      info: {
        Title: `Invoice ${invoice.number}`,
        Author: pdfText(invoice.seller.legalName ?? invoice.seller.name ?? 'Latache'),
        Subject: invoice.bookingId ? `Booking ${bookingRef(invoice.bookingId)}` : 'Invoice',
      },
    });
    enableArabicText(doc);
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const m = PAGE.margin;
    const seller = invoice.seller;
    const buyer = invoice.buyer;
    const details = invoice.details ?? {};
    const money = (value: number) => formatMoney(value, invoice.currency);
    const voided = invoice.status === 'void';

    drawBrandHeader(doc, { title: 'Invoice', subtitle: 'FACTURE', rightTop: invoice.number, rightBottom: `Issued ${formatDate(invoice.issuedAt)}` });

    // ---- Seller (logo + identity) | invoice meta card ----
    let y = HEADER_HEIGHT + 8;
    if (ASSETS.logo) {
      doc.image(ASSETS.logo, m - 4, y, { width: 150 });
    } else {
      doc.fillColor(T.heading).font('Times-Bold').fontSize(24).text(pdfText(seller.name ?? 'Latache'), m, y);
    }
    doc.fillColor(T.heading).font('Helvetica-Bold').fontSize(9).text(pdfText(seller.legalName ?? seller.name ?? 'Latache'), m, y + 48, { width: 240 });
    doc.font('Helvetica').fillColor(T.muted).fontSize(8.5);
    for (const value of [seller.address, seller.email, seller.phone, seller.website]) {
      if (value) doc.text(pdfText(value), m, doc.y + 1, { width: 240 });
    }
    const sellerBottom = doc.y;

    const cardW = 230;
    const cardX = m + CONTENT_WIDTH - cardW;
    const meta: Array<[string, string]> = [
      ['Invoice no.', invoice.number],
      ['Issue date', formatDate(invoice.issuedAt)],
      ...(invoice.bookingId ? ([['Booking ref.', bookingRef(invoice.bookingId)]] as Array<[string, string]>) : []),
      ['Payment', PAYMENT_LABELS[invoice.paymentMethod ?? ''] ?? (invoice.paymentMethod ?? '-')],
    ];
    const cardH = 20 + meta.length * 16 + 30;
    doc.roundedRect(cardX, y + 4, cardW, cardH, 10).lineWidth(1).fillAndStroke(T.cream, T.rule);
    let my = y + 16;
    for (const [label, value] of meta) {
      doc.fillColor(T.muted).font('Helvetica').fontSize(8.5).text(label, cardX + 14, my, { width: 90 });
      doc.fillColor(T.heading).font('Helvetica-Bold').fontSize(9).text(pdfText(value), cardX + 100, my, { width: cardW - 114, align: 'right' });
      my += 16;
    }
    const pillW = 74;
    doc.roundedRect(cardX + cardW - 14 - pillW, my + 2, pillW, 20, 10).fill(voided ? '#FDECEA' : T.paidBg);
    doc
      .fillColor(voided ? '#B3261E' : T.paidInk)
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .text(voided ? 'VOID' : 'PAID', cardX + cardW - 14 - pillW, my + 8, { width: pillW, align: 'center', characterSpacing: 2 });
    y = Math.max(sellerBottom, y + 4 + cardH) + 16;

    // ---- Billed to / Service details cards ----
    const colW = (CONTENT_WIDTH - 14) / 2;
    const block = (x: number, top: number, title: string, rows: Array<[string, unknown] | string>, draw: boolean) => {
      let by = top + 12;
      if (draw) doc.fillColor(T.copper).font('Helvetica-Bold').fontSize(7.5).text(title, x + 14, by, { characterSpacing: 1.2 });
      by += 14;
      for (const row of rows) {
        if (typeof row === 'string') {
          doc.font('Times-Bold').fontSize(13);
          if (draw) doc.fillColor(T.heading).text(pdfText(row), x + 14, by, { width: colW - 28 });
          by += doc.heightOfString(pdfText(row), { width: colW - 28 }) + 4;
        } else {
          if (!row[1]) continue;
          doc.font('Helvetica').fontSize(7.5);
          if (draw) doc.fillColor(T.muted).text(row[0], x + 14, by, { width: colW - 28 });
          by += 10;
          doc.font('Helvetica').fontSize(9);
          if (draw) doc.fillColor(T.ink).text(pdfText(row[1]), x + 14, by, { width: colW - 28 });
          by += doc.heightOfString(pdfText(row[1]), { width: colW - 28 }) + 5;
        }
      }
      return by + 6;
    };
    const buyerRows: Array<[string, unknown] | string> = [
      String(buyer.name || 'Customer'),
      ['Email', buyer.email],
      ['Phone', buyer.phone],
      ['Address', buyer.address],
    ];
    const serviceRows: Array<[string, unknown] | string> =
      invoice.type === 'tasker_deposit'
        ? ['Tasker signup deposit', ['Nature', 'Refundable security deposit'], ['Received', formatDate(invoice.issuedAt)]]
        : [
            String(details.service ?? 'Service'),
            ['Performed by', details.tasker],
            ['Service date', details.serviceDate ? formatDate(String(details.serviceDate)) : details.date ? formatDate(String(details.date)) : null],
            [
              'Booked slot',
              details.date && details.startTime ? `${formatDate(String(details.date))}, ${String(details.startTime)} - ${String(details.endTime)}` : null,
            ],
            ['Billed time', details.billedHours ? `${Number(details.billedHours).toFixed(2)} h (minimum billable time applies)` : null],
            ['Time on site', details.hoursWorked !== undefined && details.hoursWorked !== null ? `${Number(details.hoursWorked).toFixed(2)} h` : null],
            ['Location', details.location],
          ];
    const serviceTitle = invoice.type === 'tasker_deposit' ? 'DETAILS' : 'SERVICE DETAILS';
    const rightX = m + colW + 14;
    const boxH = Math.max(block(m, y, 'BILLED TO', buyerRows, false), block(rightX, y, serviceTitle, serviceRows, false)) - y;
    doc.roundedRect(m, y, colW, boxH, 10).lineWidth(1).fillAndStroke('#FFFFFF', T.rule);
    doc.roundedRect(rightX, y, colW, boxH, 10).lineWidth(1).fillAndStroke('#FFFFFF', T.rule);
    block(m, y, 'BILLED TO', buyerRows, true);
    block(rightX, y, serviceTitle, serviceRows, true);
    y += boxH + 16;

    // ---- Line items ----
    const cols = {
      desc: { x: m + 14, w: 226 },
      qty: { x: m + 244, w: 36 },
      unit: { x: m + 284, w: 100 },
      amount: { x: m + CONTENT_WIDTH - 14 - 100, w: 100 },
    };
    doc.roundedRect(m, y, CONTENT_WIDTH, 24, 6).fill(T.heading);
    doc.fillColor(T.gold).font('Helvetica-Bold').fontSize(8);
    doc.text('DESCRIPTION', cols.desc.x, y + 8, { width: cols.desc.w, characterSpacing: 1 });
    doc.text('QTY', cols.qty.x, y + 8, { width: cols.qty.w, align: 'center', characterSpacing: 1 });
    doc.text('UNIT PRICE', cols.unit.x, y + 8, { width: cols.unit.w, align: 'right', characterSpacing: 1 });
    doc.text('AMOUNT', cols.amount.x, y + 8, { width: cols.amount.w, align: 'right', characterSpacing: 1 });
    y += 24;
    invoice.lines.forEach((line, index) => {
      const descHeight = doc.font('Helvetica').fontSize(9).heightOfString(pdfText(line.description), { width: cols.desc.w });
      const rowH = Math.max(24, descHeight + 12);
      if (index % 2 === 1) doc.rect(m, y, CONTENT_WIDTH, rowH).fill(T.cream);
      doc.fillColor(T.ink).font('Helvetica').fontSize(9).text(pdfText(line.description), cols.desc.x, y + 7, { width: cols.desc.w });
      doc.text(String(line.quantity), cols.qty.x, y + 7, { width: cols.qty.w, align: 'center' });
      doc.text(money(line.unitAmount), cols.unit.x, y + 7, { width: cols.unit.w, align: 'right' });
      doc.fillColor(T.heading).font('Helvetica-Bold').text(money(line.amount), cols.amount.x, y + 7, { width: cols.amount.w, align: 'right' });
      y += rowH;
      doc.moveTo(m, y).lineTo(m + CONTENT_WIDTH, y).lineWidth(0.5).strokeColor(T.rule).stroke();
    });

    // ---- Totals (right) + notes (left), side by side ----
    y += 12;
    const sectionTop = y;
    const totalsW = 240;
    const totalsX = m + CONTENT_WIDTH - totalsW;
    const totalRow = (label: string, value: string, strong = false) => {
      doc.fillColor(strong ? T.heading : T.muted).font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).text(label, totalsX + 14, y, { width: 120 });
      doc.fillColor(T.heading).font(strong ? 'Helvetica-Bold' : 'Helvetica').text(value, totalsX + 120, y, { width: totalsW - 134, align: 'right' });
      y += 15;
    };
    const taxLine = invoice.lines.filter((line) => line.code === 'tax').reduce((sum, line) => sum + line.amount, 0);
    totalRow('Subtotal', money(invoice.total - taxLine));
    totalRow('Tax / TVA', money(taxLine));
    y += 3;
    doc.roundedRect(totalsX, y, totalsW, 32, 8).fill(T.brown);
    doc.fillColor(T.gold).font('Helvetica-Bold').fontSize(8).text('TOTAL PAID', totalsX + 14, y + 12, { characterSpacing: 1.5 });
    doc.fillColor('#FFFFFF').font('Times-Bold').fontSize(16).text(money(invoice.total), totalsX + 90, y + 8, { width: totalsW - 104, align: 'right' });
    y += 40;
    totalRow('Balance due', money(0), true);

    const notesW = CONTENT_WIDTH - totalsW - 24;
    const notes =
      details.kind === 'late_cancellation'
        ? 'This booking was cancelled inside the late-cancellation window. The fee above was kept under the cancellation policy and the rest of your payment was refunded.'
        : invoice.type === 'tasker_deposit'
        ? 'This deposit is held as a refundable security deposit for your Latache Tasker account and is returned according to the Tasker terms.'
        : `Payment received in full${invoice.paymentMethod === 'cash' ? ' in cash by the Tasker on completion' : ''}. The service was performed by an independent professional (${String(details.tasker ?? 'the Tasker')}); the platform service fee is invoiced by ${String(seller.legalName ?? 'Latache')}. Booking ${bookingRef(invoice.bookingId)}.`;
    doc.fillColor(T.copper).font('Helvetica-Bold').fontSize(7.5).text('NOTES', m, sectionTop, { characterSpacing: 1.2 });
    doc
      .fillColor(T.muted)
      .font('Helvetica')
      .fontSize(8.5)
      .text(pdfText(seller.footerNote ? `${notes} ${String(seller.footerNote)}` : notes), m, doc.y + 4, { width: notesW });
    doc.fillColor(T.heading).font('Times-Italic').fontSize(10.5).text('Thank you for choosing Latache.', m, doc.y + 8, { width: notesW });

    drawBrandFooter(doc, seller, `Electronically generated invoice ${invoice.number}. Valid without signature.`);
    doc.end();
  });
}

/** Shared Latache document chrome (invoices, statements): full-bleed desert header with title. */
export function drawBrandHeader(
  doc: PDFKit.PDFDocument,
  input: { title: string; subtitle: string; rightTop: string; rightBottom: string },
): void {
  const m = PAGE.margin;
  doc.rect(0, 0, PAGE.width, PAGE.height).fill(T.page);
  doc.save();
  doc.rect(0, 0, PAGE.width, HEADER_HEIGHT).clip();
  if (ASSETS.header) {
    // Full-bleed, cropped to the skyline/dunes; the image's cream wave blends into the page.
    const imageHeight = (PAGE.width * 405) / 971;
    doc.image(ASSETS.header, 0, HEADER_HEIGHT - imageHeight, { width: PAGE.width });
  } else {
    doc.rect(0, 0, PAGE.width, HEADER_HEIGHT).fill(T.heading);
  }
  doc.restore();
  doc.fillColor('#FFFFFF').font('Times-Bold').fontSize(30).text(pdfText(input.title), m, 24, { width: 300 });
  doc.fillColor(T.gold).font('Helvetica').fontSize(8.5).text(pdfText(input.subtitle), m, doc.y - 2, { characterSpacing: 2.5 });
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(10).text(pdfText(input.rightTop), m, 30, { width: CONTENT_WIDTH, align: 'right' });
  doc.fillColor('#FFFFFF').font('Helvetica').fontSize(8.5).text(pdfText(input.rightBottom), m, doc.y + 2, { width: CONTENT_WIDTH, align: 'right' });
}

/** Dunes band + company legal line + tagline, drawn inside the bottom margin of the current page. */
export function drawBrandFooter(doc: PDFKit.PDFDocument, seller: Record<string, unknown>, finePrint: string): void {
  const m = PAGE.margin;
  const previousBottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0; // the footer lives inside the bottom margin; avoid auto page breaks
  const footTop = PAGE.height - FOOTER_HEIGHT;
  doc.save();
  doc.rect(0, footTop, PAGE.width, FOOTER_HEIGHT).clip();
  if (ASSETS.footer) {
    const imageHeight = (PAGE.width * 384) / 1024;
    doc.image(ASSETS.footer, 0, footTop - imageHeight * 0.38, { width: PAGE.width });
  } else {
    doc.rect(0, footTop, PAGE.width, FOOTER_HEIGHT).fill(T.creamDeep);
  }
  doc.restore();
  const legal = [
    seller.companyNumber ? String(seller.companyNumber) : null,
    seller.iceNumber ? `ICE ${String(seller.iceNumber)}` : null,
    seller.rcNumber ? `RC ${String(seller.rcNumber)}` : null,
    seller.ifNumber ? `IF ${String(seller.ifNumber)}` : null,
    seller.patenteNumber ? `Patente ${String(seller.patenteNumber)}` : null,
  ].filter(Boolean);
  const line = { width: CONTENT_WIDTH, align: 'center' as const, lineBreak: false };
  doc.fillColor(T.brown).font('Helvetica-Bold').fontSize(7.5).text(pdfText([seller.legalName ?? seller.name ?? 'Latache', ...legal].join('   |   ')), m, footTop + 24, line);
  doc.fillColor(T.heading).font('Times-Italic').fontSize(9).text('Connecting you with trusted professionals.', m, footTop + 38, line);
  doc.fillColor(T.brown).font('Helvetica').fontSize(7).text(pdfText(finePrint), m, footTop + 54, line);
  doc.page.margins.bottom = previousBottom;
}

export const BRAND_PAGE = { ...PAGE, contentWidth: CONTENT_WIDTH, headerHeight: HEADER_HEIGHT, footerHeight: FOOTER_HEIGHT };
export { pdfText, ASSETS as BRAND_ASSETS };
