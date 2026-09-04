import type { Request } from 'express';
import type { GuestSession } from '../../generated/prisma/client';

export interface GuestAwareRequest extends Request {
  guest?: GuestSession;
}
