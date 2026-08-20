import type { UserRole } from '../enums/user-role.enum';

export interface AccessTokenPayload {
  sub: number;
  id: number;
  role: UserRole;
  roles: UserRole[];
  permissions?: string[];
  sessionId: number;
  isVerified: boolean;
  isAdmin: boolean;
  iat?: number;
  exp?: number;
}
