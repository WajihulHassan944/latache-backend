import type { GuestSession, Prisma } from '../../generated/prisma/client';

export interface SavedLocation {
  lat: number;
  lng: number;
}

export interface LocationSource {
  latitude: Prisma.Decimal | number | null;
  longitude: Prisma.Decimal | number | null;
}

/**
 * Resolves the caller's saved location for GET /api/taskers's fallback step:
 * the authenticated Customer's default saved address, or the resolved guest
 * session's coordinates, in that order (a request only ever carries one of
 * the two - GuestOrIdentityGuard sets exactly one). Both latitude and
 * longitude must be present - a row with only one saved (e.g. from a partial
 * legacy write) is treated as no usable saved location rather than guessed at.
 */
export function resolveSavedLocation(
  defaultAddress?: LocationSource | null,
  guest?: GuestSession | null,
): SavedLocation | null {
  const source = defaultAddress ?? guest;
  if (!source || source.latitude === null || source.longitude === null) return null;
  return { lat: Number(source.latitude), lng: Number(source.longitude) };
}
