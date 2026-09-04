import type { GuestSession, User } from '../../generated/prisma/client';

export interface SavedLocation {
  lat: number;
  lng: number;
}

/**
 * Resolves the caller's saved location for GET /api/taskers's fallback step:
 * the authenticated Customer's own saved coordinates, or the resolved guest
 * session's, in that order (a request only ever carries one of the two -
 * GuestOrIdentityGuard sets exactly one). Both latitude and longitude must
 * be present - a row with only one saved (e.g. from a partial legacy write)
 * is treated as no usable saved location rather than guessed at.
 */
export function resolveSavedLocation(
  user?: User | null,
  guest?: GuestSession | null,
): SavedLocation | null {
  const source = user ?? guest;
  if (!source || source.latitude === null || source.longitude === null) return null;
  return { lat: Number(source.latitude), lng: Number(source.longitude) };
}
