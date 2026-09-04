import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { GuestOrIdentityGuard } from './guest-or-identity.guard';
import type { GuestService } from '../guest.service';
import type { JwtIdentityGuard } from '../../auth/guards/jwt-identity.guard';

function contextWithAuthHeader(authorization?: string): ExecutionContext {
  const request: Record<string, unknown> = { headers: authorization ? { authorization } : {} };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('GuestOrIdentityGuard', () => {
  it('rejects a request with no Authorization header', async () => {
    const guests = { validateAndTouch: jest.fn() } as unknown as GuestService;
    const identity = { canActivate: jest.fn() } as unknown as JwtIdentityGuard;
    const guard = new GuestOrIdentityGuard(guests, identity);

    await expect(guard.canActivate(contextWithAuthHeader())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(guests.validateAndTouch).not.toHaveBeenCalled();
    expect(identity.canActivate).not.toHaveBeenCalled();
  });

  it('validates an opaque guest-token-shaped bearer value as a guest session', async () => {
    const guestToken = 'a'.repeat(128);
    const session = { id: 1, guestId: 'guest_x' };
    const guests = { validateAndTouch: jest.fn().mockResolvedValue(session) } as unknown as GuestService;
    const identity = { canActivate: jest.fn() } as unknown as JwtIdentityGuard;
    const guard = new GuestOrIdentityGuard(guests, identity);

    const context = contextWithAuthHeader(`Bearer ${guestToken}`);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(guests.validateAndTouch).toHaveBeenCalledWith(guestToken);
    expect(identity.canActivate).not.toHaveBeenCalled();
    expect((context.switchToHttp().getRequest() as { guest?: unknown }).guest).toBe(session);
  });

  it('delegates a JWT-shaped bearer value to the existing identity guard, never treating it as a guest token', async () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjF9.dGVzdC1zaWduYXR1cmU';
    const guests = { validateAndTouch: jest.fn() } as unknown as GuestService;
    const identity = { canActivate: jest.fn().mockResolvedValue(true) } as unknown as JwtIdentityGuard;
    const guard = new GuestOrIdentityGuard(guests, identity);

    const context = contextWithAuthHeader(`Bearer ${jwt}`);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(identity.canActivate).toHaveBeenCalledWith(context);
    expect(guests.validateAndTouch).not.toHaveBeenCalled();
  });

  it('propagates rejection from the identity guard for an invalid JWT-shaped token', async () => {
    const guests = { validateAndTouch: jest.fn() } as unknown as GuestService;
    const identity = {
      canActivate: jest.fn().mockRejectedValue(new UnauthorizedException('Token is invalid or expired')),
    } as unknown as JwtIdentityGuard;
    const guard = new GuestOrIdentityGuard(guests, identity);

    const context = contextWithAuthHeader('Bearer eyJhbGciOiJIUzI1NiJ9.bad.token');
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('propagates rejection from GuestService for an invalid/expired/revoked guest token', async () => {
    const guests = {
      validateAndTouch: jest
        .fn()
        .mockRejectedValue(new UnauthorizedException({ code: 'GUEST_TOKEN_EXPIRED' })),
    } as unknown as GuestService;
    const identity = { canActivate: jest.fn() } as unknown as JwtIdentityGuard;
    const guard = new GuestOrIdentityGuard(guests, identity);

    const context = contextWithAuthHeader(`Bearer ${'b'.repeat(128)}`);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(identity.canActivate).not.toHaveBeenCalled();
  });
});
