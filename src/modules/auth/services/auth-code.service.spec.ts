import { ConfigService } from '@nestjs/config';
import { AuthCodeService } from './auth-code.service';

describe('AuthCodeService', () => {
  const config = {
    getOrThrow: jest.fn().mockReturnValue('independent-otp-secret-with-at-least-32-characters'),
  } as unknown as ConfigService;
  const service = new AuthCodeService(config);

  it('stores a deterministic hash and never the original code', () => {
    const hashed = service.hash('email-verification', '123456');
    expect(hashed).toMatch(/^[a-f0-9]{64}$/);
    expect(hashed).not.toContain('123456');
    expect(service.matches('email-verification', '123456', hashed)).toBe(true);
  });

  it('separates purposes and compares invalid input safely', () => {
    const hashed = service.hash('password-reset', '654321');
    expect(service.matches('email-verification', '654321', hashed)).toBe(false);
    expect(service.matches('password-reset', '000000', hashed)).toBe(false);
    expect(service.matches('password-reset', '654321', 'invalid')).toBe(false);
  });
});
