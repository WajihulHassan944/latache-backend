import type { Request } from 'express';
import type { User } from '../../generated/prisma/client';
import type { AccessTokenPayload } from './jwt-payload';
import type { LocalizedRequest } from '../../modules/localization/localization.types';

export interface AuthenticatedRequest extends Request, LocalizedRequest {
  user: User;
  auth: AccessTokenPayload;
}
