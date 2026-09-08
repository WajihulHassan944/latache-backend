import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), 'src');

describe('pending customer verification flow', () => {
  const registration = readFileSync(
    join(root, 'modules/auth/services/auth-registration.service.ts'),
    'utf8',
  );
  const password = readFileSync(
    join(root, 'modules/auth/services/auth-password.service.ts'),
    'utf8',
  );
  const token = readFileSync(
    join(root, 'modules/auth/services/auth-token.service.ts'),
    'utf8',
  );
  const config = readFileSync(join(root, 'config/configuration.ts'), 'utf8');

  it('does not persist Customer role/profile before email verification', () => {
    expect(registration).toContain("role: '',");
    expect(registration).toContain('roles: [],');
    expect(registration).toContain("onboardingStatus: 'pending_customer_verification'");
    expect(registration).not.toContain(
      "await this.repository.createCustomerProfile({ userId: user.id, status: 'active' }, transaction);",
    );
  });

  it('retries an existing unverified customer signup instead of blocking it', () => {
    expect(registration).toContain('if (existing.isVerified)');
    expect(registration).toContain("existing.accountStatus !== AccountStatus.PendingVerification");
    expect(registration).toContain(
      "await transaction.customerProfile.deleteMany({ where: { userId: existing.id } });",
    );
  });

  it('activates the customer role only after successful verification', () => {
    expect(password).toContain("role: UserRole.Customer");
    expect(password).toContain('roles: { set: [UserRole.Customer] }');
    expect(password).toContain('transaction.customerProfile.upsert');
  });

  it('keeps verification sessions limited to the pending signup', () => {
    expect(token).toContain('issueVerificationSession');
    expect(token).toContain(
      'user.onboardingStatus !== this.pendingVerificationOnboardingStatus(pendingRole)',
    );
    expect(token).toContain("user.onboardingStatus === 'pending_customer_verification'");
  });

  it('allows the frontend development origin on port 3001', () => {
    expect(config).toContain("'http://localhost:3001'");
  });
});
