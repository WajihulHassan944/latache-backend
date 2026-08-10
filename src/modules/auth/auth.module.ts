import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { MailModule } from '../mail/mail.module';
import { UsersModule } from '../users/users.module';
import { RbacCoreModule } from '../rbac/rbac-core.module';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AdminAuthGuard } from './guards/admin-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtIdentityGuard } from './guards/jwt-identity.guard';
import { AuthRepository } from './repositories/auth.repository';
import { AuthSessionsRepository } from './repositories/auth-sessions.repository';
import { AuthLoginService } from './services/auth-login.service';
import { AuthPasswordService } from './services/auth-password.service';
import { AuthProfileService } from './services/auth-profile.service';
import { AuthRegistrationService } from './services/auth-registration.service';
import { AuthSessionService } from './services/auth-session.service';
import { AuthTokenService } from './services/auth-token.service';

@Module({
  imports: [JwtModule.register({}), UsersModule, MailModule, RbacCoreModule, AdminAuditModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRegistrationService,
    AuthLoginService,
    AuthPasswordService,
    AuthProfileService,
    AuthSessionService,
    AuthTokenService,
    AuthRepository,
    AuthSessionsRepository,
    JwtIdentityGuard,
    JwtAuthGuard,
    AdminAuthGuard,
    RolesGuard,
    PermissionsGuard,
  ],
  exports: [
    AuthService,
    JwtIdentityGuard,
    JwtAuthGuard,
    AdminAuthGuard,
    RolesGuard,
    PermissionsGuard,
    AuthSessionsRepository,
    JwtModule,
    UsersModule,
  ],
})
export class AuthModule {}
