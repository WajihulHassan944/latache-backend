import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('authentication code storage hardening', () => {
  const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');

  it('writes hashes for every newly issued authentication code', () => {
    const registration = read('src/modules/auth/services/auth-registration.service.ts');
    const password = read('src/modules/auth/services/auth-password.service.ts');
    expect(registration).toContain("this.authCodes.hash('email-verification', otp)");
    expect(password).toContain("this.authCodes.hash('email-verification', otp)");
    expect(password).toContain("this.authCodes.hash('password-reset', resetCode)");
    expect(registration).toContain('otp: null');
    expect(password).toContain('passwordResetCode: null');
  });

  it('does not serialize keyed hashes and requires an independent production secret', () => {
    const serializer = read('src/common/utils/user.util.ts');
    const validation = read('src/config/env.validation.ts');
    expect(serializer).toContain("'otpHash'");
    expect(serializer).toContain("'passwordResetCodeHash'");
    expect(validation).toContain("['JWT_SECRET', 'JWT_SECRET_ADMIN', 'OTP_HASH_SECRET']");
    expect(read('.env.example')).toContain('OTP_HASH_SECRET=');
  });
});
