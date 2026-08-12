import { createHash, randomBytes, randomInt } from 'node:crypto';
import { REFRESH_TOKEN_BYTES } from '../constants/security.constants';

export const generateNumericCode = (digits = 4): number => {
  const minimum = 10 ** (digits - 1);
  const maximum = 10 ** digits;
  return randomInt(minimum, maximum);
};

export const generateOpaqueToken = (): string => randomBytes(REFRESH_TOKEN_BYTES).toString('hex');

export const hashOpaqueToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
