import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UsersModule } from '../users/users.module';
import { AuthModule } from './auth.module';
import { AdminAuthGuard } from './guards/admin-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtIdentityGuard } from './guards/jwt-identity.guard';
import { AuthSessionsRepository } from './repositories/auth-sessions.repository';
import { AuthRegistrationService } from './services/auth-registration.service';
import { AuthTokenService } from './services/auth-token.service';

describe('AuthModule dependency graph', () => {
  it('re-exports users and every reusable auth guard', () => {
    const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, AuthModule) as unknown[];
    expect(exports).toEqual(
      expect.arrayContaining([
        UsersModule,
        JwtIdentityGuard,
        JwtAuthGuard,
        AdminAuthGuard,
        RolesGuard,
        PermissionsGuard,
        AuthSessionsRepository,
      ]),
    );
  });

  it('registers split auth-domain services', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AuthModule) as unknown[];
    expect(providers).toEqual(
      expect.arrayContaining([AuthRegistrationService, AuthTokenService]),
    );
  });
});
