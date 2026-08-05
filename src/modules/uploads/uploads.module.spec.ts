import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { AuthModule } from '../auth/auth.module';
import { AuthSessionsRepository } from '../auth/repositories/auth-sessions.repository';
import { UploadsModule } from './uploads.module';

describe('UploadsModule authentication dependency graph', () => {
  it('imports AuthModule', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, UploadsModule) as unknown[];
    expect(imports).toContain(AuthModule);
  });

  it('can resolve the session-aware identity guard through AuthModule exports', () => {
    const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, AuthModule) as unknown[];
    expect(exports).toContain(AuthSessionsRepository);
  });
});
