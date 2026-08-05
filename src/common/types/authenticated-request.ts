import type { Request } from 'express';
import type { User } from '../../generated/prisma/client';
import type { AccessTokenPayload } from './jwt-payload';

export interface AuthenticatedRequest extends Request {
  user: User;
  auth: AccessTokenPayload;
}
