import { resolveSavedLocation } from './discovery-location.util';

describe('resolveSavedLocation', () => {
  it('returns null when neither a user nor a guest is given', () => {
    expect(resolveSavedLocation(undefined, undefined)).toBeNull();
  });

  it('returns null when the resolved source has no saved location', () => {
    expect(resolveSavedLocation({ latitude: null, longitude: null } as never)).toBeNull();
  });

  it('returns null when only latitude is saved (partial data is treated as unusable)', () => {
    expect(resolveSavedLocation({ latitude: 33.5731, longitude: null } as never)).toBeNull();
  });

  it('returns null when only longitude is saved', () => {
    expect(resolveSavedLocation({ latitude: null, longitude: -7.5898 } as never)).toBeNull();
  });

  it('resolves a fully saved Customer location', () => {
    expect(resolveSavedLocation({ latitude: 33.5731, longitude: -7.5898 } as never)).toEqual({
      lat: 33.5731,
      lng: -7.5898,
    });
  });

  it('falls back to the guest session location when there is no authenticated user', () => {
    expect(
      resolveSavedLocation(undefined, { latitude: 34.02, longitude: -6.83 } as never),
    ).toEqual({ lat: 34.02, lng: -6.83 });
  });

  it('prefers the authenticated user location over a guest session, when somehow both are present', () => {
    expect(
      resolveSavedLocation(
        { latitude: 33.5731, longitude: -7.5898 } as never,
        { latitude: 34.02, longitude: -6.83 } as never,
      ),
    ).toEqual({ lat: 33.5731, lng: -7.5898 });
  });

  it('coerces Prisma Decimal-like values to plain numbers', () => {
    const decimalLike = (value: number) => ({ toString: () => String(value), valueOf: () => value });
    expect(
      resolveSavedLocation({ latitude: decimalLike(33.5731), longitude: decimalLike(-7.5898) } as never),
    ).toEqual({ lat: 33.5731, lng: -7.5898 });
  });
});
