import { bidiVisualRuns, formatMoney, renderInvoicePdf } from './invoice-pdf.renderer';

describe('invoice PDF text', () => {
  it('keeps Latin-only text as one left-to-right run', () => {
    expect(bidiVisualRuns('Sarah Bennani')).toEqual([{ text: 'Sarah Bennani', kind: 'L' }]);
  });

  it('orders an Arabic-first address right-to-left with digits kept intact', () => {
    const runs = bidiVisualRuns('24 شارع الزرقطوني، الشقة 6');
    // Paragraph is RTL (first letter is Arabic), so the logical first run "24" is drawn last (rightmost).
    expect(runs.at(-1)).toEqual({ text: '24', kind: 'D' });
    expect(runs[0]).toEqual({ text: '6', kind: 'D' });
    expect(runs.map((run) => run.text).join('|')).toContain('شارع الزرقطوني، الشقة');
  });

  it('keeps Latin-first mixed names in logical order', () => {
    expect(bidiVisualRuns('Youssef العمراني').map((run) => run.kind)).toEqual(['L', 'N', 'A']);
  });

  it('never prints negative zero', () => {
    expect(formatMoney(-0, 'USD')).toBe('USD 0.00');
    expect(formatMoney(-20, 'MAD')).toBe('- MAD 20.00');
  });

  it('renders a one-page PDF with Arabic content', async () => {
    const pdf = await renderInvoicePdf({
      number: 'INV-2026-000001', type: 'booking', status: 'issued', currency: 'MAD', issuedAt: '2026-11-24T10:00:00.000Z',
      bookingId: '1', paymentMethod: 'cmi', subtotal: 100, platformFee: 10, taxAmount: 0, discountAmount: 0, total: 110,
      lines: [{ code: 'service', description: 'تنظيف المنزل', quantity: 1, unitAmount: 100, amount: 100 }],
      details: { service: 'تنظيف', tasker: 'Youssef العمراني', location: '24 شارع الزرقطوني، الدار البيضاء' },
      seller: { name: 'Latache' },
      buyer: { name: 'سارة بنعلي', email: 'sarah@example.com' },
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBe(1);
  });
});
