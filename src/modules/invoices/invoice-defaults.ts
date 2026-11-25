/**
 * Issuer identity printed on invoices when the admin has not filled the
 * "Invoicing identity" settings yet. Public Companies House data for the
 * operating company (LATACHE LIMITED); anything set in admin settings wins.
 */
export const DEFAULT_INVOICE_SELLER = {
  legalName: 'LATACHE LIMITED',
  address: '31 Oak Leaf Drive, Moseley, Birmingham, England, B13 9FE',
  companyNumber: 'Company no. 16756660 (England & Wales)',
  email: 'info@latâche.com',
  website: 'latâche.com',
} as const;

/** The API host or a raw punycode host is not something a customer should see on an invoice. */
export function presentableWebsite(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return fallback;
  if (/^https?:\/\/api\./i.test(text) || /xn--/i.test(text)) return fallback;
  return text.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}
