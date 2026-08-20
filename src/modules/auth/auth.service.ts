import { Injectable } from '@nestjs/common';
import type { User } from '../../generated/prisma/client';
import type { UserRole } from '../../common/enums/user-role.enum';
import type {
  AddCustomerRoleDto,
  AddTaskerRoleDto,
  ChangePasswordDto,
  CreateAdminDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshTokenDto,
  RegisterCustomerDto,
  RegisterTaskerDto,
  ResendVerificationEmailDto,
  ResetPasswordDto,
  UpdateProfileDto,
  VerifyEmailDto,
  VerifyResetOtpDto,
} from './dto';
import { AuthLoginService } from './services/auth-login.service';
import { AuthPasswordService } from './services/auth-password.service';
import { AuthProfileService } from './services/auth-profile.service';
import { AuthRegistrationService } from './services/auth-registration.service';
import { AuthSessionService } from './services/auth-session.service';
import type { SessionMetadata } from './services/auth-token.service';

/** Thin facade keeping the controller independent from auth sub-service boundaries. */
@Injectable()
export class AuthService {
  constructor(
    private readonly registration: AuthRegistrationService,
    private readonly loginService: AuthLoginService,
    private readonly passwords: AuthPasswordService,
    private readonly profiles: AuthProfileService,
    private readonly sessions: AuthSessionService,
  ) {}

  registerCustomer(dto: RegisterCustomerDto, metadata: SessionMetadata, locale?: string) {
    return this.registration.registerCustomer(dto, metadata, locale);
  }

  registerTasker(dto: RegisterTaskerDto, metadata: SessionMetadata, locale?: string) {
    return this.registration.registerTasker(dto, metadata, locale);
  }

  addCustomerRole(userId: number, dto: AddCustomerRoleDto, metadata: SessionMetadata) {
    return this.registration.addCustomerRole(userId, dto, metadata);
  }

  addTaskerRole(userId: number, dto: AddTaskerRoleDto, metadata: SessionMetadata) {
    return this.registration.addTaskerRole(userId, dto, metadata);
  }

  createAdmin(actor: User, dto: CreateAdminDto) {
    return this.registration.createAdmin(actor, dto);
  }

  login(dto: LoginDto, metadata: SessionMetadata) {
    return this.loginService.login(dto, metadata);
  }

  refresh(dto: RefreshTokenDto, metadata: SessionMetadata) {
    return this.loginService.refresh(dto, metadata);
  }

  switchRole(
    userId: number,
    currentSessionId: number,
    role: UserRole,
    metadata: SessionMetadata,
  ) {
    return this.loginService.switchRole(userId, currentSessionId, role, metadata);
  }

  verifyEmail(userId: number, dto: VerifyEmailDto) {
    return this.passwords.verifyEmail(userId, dto);
  }

  resendVerification(dto: ResendVerificationEmailDto, locale?: string) {
    return this.passwords.resendVerification(dto, locale);
  }

  forgotPassword(dto: ForgotPasswordDto, locale?: string) {
    return this.passwords.forgotPassword(dto, locale);
  }

  verifyResetOtp(dto: VerifyResetOtpDto) {
    return this.passwords.verifyResetOtp(dto);
  }

  resetPassword(dto: ResetPasswordDto) {
    return this.passwords.resetPassword(dto);
  }

  changePassword(userId: number, dto: ChangePasswordDto) {
    return this.passwords.changePassword(userId, dto);
  }

  me(userId: number, activeRole?: UserRole) {
    return this.profiles.me(userId, activeRole);
  }

  updateMe(userId: number, dto: UpdateProfileDto, activeRole?: UserRole) {
    return this.profiles.update(userId, dto, activeRole);
  }

  listSessions(userId: number) {
    return this.sessions.list(userId);
  }

  logout(userId: number, sessionId: number) {
    return this.sessions.logout(userId, sessionId);
  }

  logoutAll(userId: number) {
    return this.sessions.logoutAll(userId);
  }

  revokeSession(userId: number, sessionId: number) {
    return this.sessions.revoke(userId, sessionId);
  }
}
