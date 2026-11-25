/**
 * One human-readable booking reference everywhere (emails, invoices, receivables,
 * admin screens, the apps): B-0175. The numeric id stays the database key.
 */
export function bookingRef(id: number | string | null | undefined): string {
  if (id === null || id === undefined || id === '') return '-';
  return `B-${String(id).padStart(4, '0')}`;
}
