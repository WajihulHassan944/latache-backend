import { createHash } from 'node:crypto';
import { cmiHash, cmiHashMatches } from './cmi-hash';

describe('cmiHash (ver3)', () => {
  it('sorts names case-insensitively, skips HASH/encoding, escapes | and \\ and appends the store key', () => {
    const fields = { oid: 'A|1', amount: '10.00', BillToName: 'x\\y', encoding: 'UTF-8', HASH: 'ignored' };
    // amount < BillToName < oid (case-insensitive), then the escaped store key.
    const plain = ['10.00', 'x\\\\y', 'A\\|1', 'key\\|1'].join('|');
    expect(cmiHash(fields, 'key|1')).toBe(createHash('sha512').update(plain).digest('base64'));
  });

  it('verifies a callback signed with the same store key and rejects tampering', () => {
    const fields: Record<string, string> = { oid: 'CMI-1', amount: '50.00', ProcReturnCode: '00', Response: 'Approved' };
    fields.HASH = cmiHash(fields, 'secret');
    expect(cmiHashMatches(fields, 'secret')).toBe(true);
    expect(cmiHashMatches({ ...fields, amount: '5000.00' }, 'secret')).toBe(false);
    expect(cmiHashMatches(fields, 'other')).toBe(false);
    expect(cmiHashMatches({ oid: 'x' }, 'secret')).toBe(false);
  });
});
