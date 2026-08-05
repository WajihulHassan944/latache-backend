import type { User } from '../../generated/prisma/client';

const PRIVATE_USER_FIELDS = new Set([
  'password',
  'otp',
  'otpExpires',
  'otpAttempts',
  'passwordResetCode',
  'passwordResetCodeExpires',
  'passwordResetAttempts',
  'identityDocument',
]);

export type PublicUser = Record<string, unknown>;

export const serializeUser = (user: User): PublicUser => {
  const plain = { ...user } as Record<string, unknown>;
  for (const field of PRIVATE_USER_FIELDS) delete plain[field];

  if (user.role === 'admin' || user.role === 'super_admin') {
    plain.adminId = `ADM-${String(user.id).padStart(3, '0')}`;
  }

  return plain;
};
