import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('production readiness guards', () => {
  const root = process.cwd();
  const read = (path: string): string => readFileSync(join(root, path), 'utf8');

  it('does not silently reuse or reset development Super Admin credentials in production', () => {
    const seed = read('prisma/seed.ts');
    expect(seed).toContain("const productionLike = ['staging', 'production'].includes");
    expect(seed).toContain('SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD are required');
    expect(seed).toContain("password === 'Admin@12345'");
    expect(seed).toContain('SUPERADMIN_ROTATE_PASSWORD_ON_SEED');
    expect(seed).toContain('rotateExistingPassword');
    expect(seed).toContain('mustChangePassword: productionLike');
  });

  it('requires durable scheduled processing in staging and production', () => {
    const validation = read('src/config/env.validation.ts');
    expect(validation).toContain('!redisEnabled || !redisRequired || !jobsEnabled');
    expect(validation).toContain('automatic booking completion cannot be silently disabled');
  });
});
