import { isValidIban, maskBankAccount, moroccanRibToIban, normalizeBankAccount } from './bank-account.util';

describe('bank-account util', () => {
  it('validates IBAN checksums (ISO 13616)', () => {
    expect(isValidIban('GB82 WEST 1234 5698 7654 32')).toBe(true);
    expect(isValidIban('GB82WEST12345698765433')).toBe(false);
    expect(isValidIban('FR1420041010050500013M02606')).toBe(true);
  });

  it('converts a 24-digit Moroccan RIB to a checksum-valid MA IBAN', () => {
    const rib = '011 780 0000123456789012 34'.replace(/\s/g, '');
    const iban = moroccanRibToIban(rib);
    expect(iban).toMatch(/^MA\d{2}011780000012345678901234$/);
    expect(isValidIban(iban)).toBe(true);
  });

  it('normalizes RIB or IBAN input and masks the result', () => {
    const normalized = normalizeBankAccount('0117 8000 0012 3456 7890 1234') as string;
    expect(normalized.startsWith('MA')).toBe(true);
    expect(normalizeBankAccount(' gb82 west 1234 5698 7654 32 ')).toBe('GB82WEST12345698765432');
    expect(maskBankAccount('GB82WEST12345698765432')).toBe('GB82 •••• 5432');
  });
});
