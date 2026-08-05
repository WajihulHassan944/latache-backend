import type { User } from '../../generated/prisma/client';

const PRIVATE_USER_FIELDS = new Set([
  'password',
  'otp',
  'otpExpires',
  'passwordResetCode',
  'passwordResetCodeExpires',
  'identityDocument',
]);
const GET_USER_PRIVATE_FIELDS = new Set(['isVerified']);
const LOGIN_PRIVATE_FIELDS = new Set(['isVerified', 'isAdmin']);

export type PublicUser = Record<string, unknown>;

export const serializeUser = (
  user: User,
  options: { loginResponse?: boolean } = {},
): PublicUser => {
  const plain = { ...user } as Record<string, unknown>;
  for (const field of PRIVATE_USER_FIELDS) delete plain[field];
  const responsePrivateFields = options.loginResponse
    ? LOGIN_PRIVATE_FIELDS
    : GET_USER_PRIVATE_FIELDS;
  for (const field of responsePrivateFields) delete plain[field];
  return plain;
};
