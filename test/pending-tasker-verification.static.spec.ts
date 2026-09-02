import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), 'src');

describe('pending tasker verification flow', () => {
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
  const guard = readFileSync(join(root, 'modules/auth/guards/jwt-identity.guard.ts'), 'utf8');

  it('does not persist Tasker role/profile before email verification', () => {
    expect(registration).toContain("onboardingStatus: 'pending_tasker_verification'");
    expect(registration).toContain("role: '',");
    expect(registration).toContain('roles: [],');
  });

  it('retries an existing unverified tasker signup instead of blocking it', () => {
    expect(registration).toContain(
      "existing.role !== '' && existing.role !== UserRole.Tasker",
    );
    expect(registration).toContain(
      'await transaction.taskerProfile.deleteMany({ where: { userId: existing.id } });',
    );
  });

  it('activates the tasker role and profile only after successful verification', () => {
    expect(password).toContain('pendingTaskerVerification');
    expect(password).toContain('role: UserRole.Tasker');
    expect(password).toContain('roles: { set: [UserRole.Tasker] }');
    expect(password).toContain('transaction.taskerProfile.upsert');
  });

  it('lets an already-stuck unverified tasker self-heal via resend-verification', () => {
    expect(password).toContain('isTaskerPendingCandidate');
    expect(password).toContain('transaction.taskerProfile.deleteMany');
  });

  it('keeps verification sessions limited to the pending signup for either role', () => {
    expect(token).toContain('pendingVerificationOnboardingStatus');
    expect(token).toContain("pending_tasker_verification");
  });

  it('lets an unverified pending tasker call verify-email without a TaskerProfile', () => {
    expect(guard).toContain('pending_tasker_verification');
    expect(guard).toContain('payload.role === UserRole.Tasker');
  });
});
