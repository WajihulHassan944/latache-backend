import { ValidateBy, type ValidationOptions } from 'class-validator';

/**
 * Bank destination helpers shared by Tasker payout methods and customer wallet
 * withdrawals. Accepts either an IBAN (any country) or a Moroccan 24-digit RIB,
 * which is converted to its MA IBAN (ISO 13616 check digits) so everything
 * downstream stores one canonical, checksum-valid format.
 *
 * Note: a Moroccan RIB's own 2-digit key is not verified here; converting it
 * always yields a checksum-valid IBAN, so admins should still confirm the
 * account holder before paying.
 */
const compact = (value: string): string => value.replace(/[\s-]+/g, '').toUpperCase();

const mod97 = (numeric: string): number => {
  let remainder = 0;
  for (const digit of numeric) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder;
};

const toNumeric = (value: string): string =>
  value.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));

export function isValidIban(value: string): boolean {
  const iban = compact(value);
  if (!/^[A-Z]{2}\d{2}[0-9A-Z]{11,30}$/.test(iban)) return false;
  return mod97(toNumeric(iban.slice(4) + iban.slice(0, 4))) === 1;
}

export function moroccanRibToIban(rib: string): string {
  const digits = compact(rib);
  if (!/^\d{24}$/.test(digits)) throw new Error('A Moroccan RIB has exactly 24 digits');
  const check = 98 - mod97(toNumeric(`${digits}MA00`));
  return `MA${String(check).padStart(2, '0')}${digits}`;
}

/** RIB or IBAN in, canonical IBAN out (or the compacted input when it is neither, so validation can reject it). */
export function normalizeBankAccount(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const raw = compact(value);
  return /^\d{24}$/.test(raw) ? moroccanRibToIban(raw) : raw;
}

export function maskBankAccount(iban: string): string {
  return `${iban.slice(0, 4)} •••• ${iban.slice(-4)}`;
}

export function IsBankAccount(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isBankAccount',
      validator: {
        validate: (value: unknown) => typeof value === 'string' && isValidIban(value),
        defaultMessage: () => 'Enter a valid IBAN or 24-digit Moroccan RIB',
      },
    },
    options,
  );
}
