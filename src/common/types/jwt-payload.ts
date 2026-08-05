import type { UserRole } from '../enums/user-role.enum';

export interface AccessTokenPayload {
  sub: number;
  id: number;
  isVerified: boolean;
  isAdmin: boolean;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export interface PasswordResetTokenPayload {
  sub: number;
  id: number;
  email: string;
  resetCode: number;
  purpose: 'password-reset';
  iat?: number;
  exp?: number;
}
