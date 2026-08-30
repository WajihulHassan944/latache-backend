import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { compare, hash } from 'bcryptjs';
import { AccountStatus } from '../../../common/enums/account-status.enum';
import { generateNumericCode } from '../../../common/utils/crypto.util';
import { serializeUser, type PublicUser } from '../../../common/utils/user.util';
import { PrismaService } from '../../../database/prisma.service';
import type { Prisma, User } from '../../../generated/prisma/client';
import { MailService } from '../../mail/mail.service';
import { success, type SuccessEnvelope } from '../auth-response';
import type {
  ChangePasswordDto,
  ForgotPasswordDto,
  ResendVerificationEmailDto,
  ResetPasswordDto,
  SetPasswordDto,
  VerifyEmailDto,
  VerifyResetOtpDto,
} from '../dto';
import { AuthRepository } from '../repositories/auth.repository';
import { AuthSessionsRepository } from '../repositories/auth-sessions.repository';
import { AuthCodeService } from './auth-code.service';

const GENERIC_RESET_MESSAGE =
  'If an eligible account exists, password reset instructions have been sent.';
const GENERIC_VERIFICATION_MESSAGE =
  'If an unverified account exists, a verification code has been sent.';
const MAX_OTP_ATTEMPTS = 5;

@Injectable()
export class AuthPasswordService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly sessions: AuthSessionsRepository,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly authCodes: AuthCodeService,
  ) {}

  async verifyEmail(
    userId: number,
    dto: VerifyEmailDto,
  ): Promise<SuccessEnvelope<{ user: PublicUser }>> {
    const result = await this.prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
      const user = await this.repository.findUserByIdForUpdate(userId, transaction);
      if (!user || user.deletedAt) return { kind: 'invalid' as const };
      if (user.isVerified) return { kind: 'verified' as const, user };
      if (user.otpAttempts >= MAX_OTP_ATTEMPTS) {
        return { kind: 'blocked' as const };
      }

      if (!this.isActiveVerificationCode(user, dto.otp)) {
        await transaction.user.update({
          where: { id: user.id },
          data: { otpAttempts: { increment: 1 } },
        });
        return { kind: 'invalid' as const };
      }

      const updated = await transaction.user.update({
        where: { id: user.id },
        data: {
          isVerified: true,
          otp: null,
          otpHash: null,
          otpExpires: null,
          otpAttempts: 0,
          accountStatus: AccountStatus.Active,
        },
      });
      return { kind: 'success' as const, user: updated };
    });

    if (result.kind === 'invalid') {
      throw new BadRequestException('Invalid or expired verification OTP');
    }
    if (result.kind === 'blocked') {
      throw new BadRequestException('Too many invalid attempts. Request a new verification OTP.');
    }
    if (result.kind === 'verified') {
      return success({ user: serializeUser(result.user) }, 'Email is already verified.');
    }
    return success({ user: serializeUser(result.user) }, 'Email verified successfully.');
  }

  async resendVerification(
    dto: ResendVerificationEmailDto,
    requestedLocale?: string,
  ): Promise<SuccessEnvelope<{ delivery: 'OTP_SENT_IF_ELIGIBLE' }>> {
    const user = await this.repository.findUserByEmail(dto.email);
    if (!user || user.isVerified || user.deletedAt) {
      return success({ delivery: 'OTP_SENT_IF_ELIGIBLE' }, GENERIC_VERIFICATION_MESSAGE);
    }

    const otp = generateNumericCode(6);
    await this.repository.updateUser(user.id, {
      otp: null,
      otpHash: this.authCodes.hash('email-verification', otp),
      otpExpires: this.verificationOtpExpiry(),
      otpAttempts: 0,
    });
    await this.mail.sendVerificationEmail({
      to: user.email,
      name: user.firstName || user.email,
      otp,
      device: dto.device,
      locale: user.preferredLanguage ?? requestedLocale ?? 'en',
    });
    return success({ delivery: 'OTP_SENT_IF_ELIGIBLE' }, GENERIC_VERIFICATION_MESSAGE);
  }

  async forgotPassword(
    dto: ForgotPasswordDto,
    requestedLocale?: string,
  ): Promise<SuccessEnvelope<null>> {
    const user = await this.repository.findUserByEmail(dto.email);
    if (!user || !user.isVerified || user.deletedAt) {
      return success(null, GENERIC_RESET_MESSAGE);
    }

    const resetCode = generateNumericCode(6);
    await this.repository.updateUser(user.id, {
      passwordResetCode: null,
      passwordResetCodeHash: this.authCodes.hash('password-reset', resetCode),
      passwordResetCodeExpires: this.passwordResetOtpExpiry(),
      passwordResetAttempts: 0,
    });

    await this.mail.sendPasswordResetOtp({
      to: user.email,
      name: user.firstName || user.email,
      otp: resetCode,
      locale: user.preferredLanguage ?? requestedLocale ?? 'en',
    });
    return success(null, GENERIC_RESET_MESSAGE);
  }

  async verifyResetOtp(
    dto: VerifyResetOtpDto,
  ): Promise<SuccessEnvelope<{ purpose: 'PASSWORD_RESET'; verified: true }>> {
    const outcome = await this.prisma.$transaction(
      async (transaction: Prisma.TransactionClient) => {
        const existing = await this.repository.findUserByEmail(dto.email, transaction);
        if (!existing) return { kind: 'invalid' as const };

        const user = await this.repository.findUserByIdForUpdate(existing.id, transaction);
        if (!user) return { kind: 'invalid' as const };
        if (user.passwordResetAttempts >= MAX_OTP_ATTEMPTS) {
          return { kind: 'blocked' as const };
        }
        if (!this.isActiveResetCode(user, dto.otp)) {
          await transaction.user.update({
            where: { id: user.id },
            data: { passwordResetAttempts: { increment: 1 } },
          });
          return { kind: 'invalid' as const };
        }
        return { kind: 'success' as const };
      },
    );

    if (outcome.kind === 'blocked') {
      throw new BadRequestException('Too many invalid attempts. Request a new password reset OTP.');
    }
    if (outcome.kind === 'invalid') {
      throw new BadRequestException('Invalid or expired password reset OTP');
    }

    return success({ purpose: 'PASSWORD_RESET', verified: true }, 'Password reset OTP verified.');
  }

  async resetPassword(dto: ResetPasswordDto): Promise<SuccessEnvelope<null>> {
    const outcome = await this.prisma.$transaction(
      async (transaction: Prisma.TransactionClient) => {
        const existing = await this.repository.findUserByEmail(dto.email, transaction);
        if (!existing) return { kind: 'invalid' as const };
        const user = await this.repository.findUserByIdForUpdate(existing.id, transaction);
        if (!user) return { kind: 'invalid' as const };
        if (user.passwordResetAttempts >= MAX_OTP_ATTEMPTS) {
          return { kind: 'blocked' as const };
        }
        if (!this.isActiveResetCode(user, dto.otp)) {
          await transaction.user.update({
            where: { id: user.id },
            data: { passwordResetAttempts: { increment: 1 } },
          });
          return { kind: 'invalid' as const };
        }
        if (user.password && (await compare(dto.newPassword, user.password))) {
          return { kind: 'same' as const };
        }

        await transaction.user.update({
          where: { id: user.id },
          data: {
            password: await hash(dto.newPassword, this.bcryptRounds()),
            passwordResetCode: null,
            passwordResetCodeHash: null,
            passwordResetCodeExpires: null,
            passwordResetAttempts: 0,
            mustChangePassword: false,
            loginFailedAttempts: 0,
            loginLockedUntil: null,
            lastFailedLoginAt: null,
          },
        });
        await this.sessions.revokeAll(user.id, transaction);
        return { kind: 'success' as const };
      },
    );

    if (outcome.kind === 'invalid') {
      throw new BadRequestException('Invalid or expired password reset OTP');
    }
    if (outcome.kind === 'blocked') {
      throw new BadRequestException('Too many invalid attempts. Request a new password reset OTP.');
    }
    if (outcome.kind === 'same') {
      throw new BadRequestException('New password must be different');
    }
    return success(null, 'Password reset successfully. Sign in with the new password.');
  }

  async setPassword(userId: number, dto: SetPasswordDto): Promise<SuccessEnvelope<null>> {
    await this.prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
      const user = await this.repository.findUserByIdForUpdate(userId, transaction);
      if (!user || user.deletedAt) throw new UnauthorizedException('Account not found');
      if (user.password) {
        throw new ConflictException({
          code: 'LOCAL_PASSWORD_ALREADY_ENABLED',
          message: 'A local password is already enabled. Use change-password instead.',
        });
      }

      await this.repository.updateUser(
        user.id,
        {
          password: await hash(dto.password, this.bcryptRounds()),
          mustChangePassword: false,
          loginFailedAttempts: 0,
          loginLockedUntil: null,
          lastFailedLoginAt: null,
        },
        transaction,
      );
    });
    return success(null, 'Local password enabled successfully.');
  }

  async changePassword(userId: number, dto: ChangePasswordDto): Promise<SuccessEnvelope<null>> {
    const user = await this.repository.findUserById(userId);
    if (!user?.password || !(await compare(dto.currentPassword, user.password))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (await compare(dto.newPassword, user.password)) {
      throw new BadRequestException('New password must be different');
    }

    await this.prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
      await this.repository.updateUser(
        user.id,
        {
          password: await hash(dto.newPassword, this.bcryptRounds()),
          mustChangePassword: false,
          loginFailedAttempts: 0,
          loginLockedUntil: null,
          lastFailedLoginAt: null,
        },
        transaction,
      );
      await this.sessions.revokeAll(user.id, transaction);
    });
    return success(null, 'Password changed successfully. Sign in again on your devices.');
  }

  private isActiveVerificationCode(user: User, code: string): boolean {
    if (!user.otpExpires || user.otpExpires.getTime() <= Date.now()) return false;
    return (
      this.authCodes.matches('email-verification', code, user.otpHash) || user.otp === Number(code)
    );
  }

  private isActiveResetCode(user: User, code: string): boolean {
    if (!user.passwordResetCodeExpires || user.passwordResetCodeExpires.getTime() <= Date.now()) {
      return false;
    }
    return (
      this.authCodes.matches('password-reset', code, user.passwordResetCodeHash) ||
      user.passwordResetCode === Number(code)
    );
  }

  private verificationOtpExpiry(): Date {
    const minutes = this.config.get<number>('auth.otpExpiresInMinutes', 5);
    return new Date(Date.now() + minutes * 60_000);
  }

  private passwordResetOtpExpiry(): Date {
    const minutes = this.config.get<number>('auth.passwordResetOtpExpiresInMinutes', 15);
    return new Date(Date.now() + minutes * 60_000);
  }

  private bcryptRounds(): number {
    return this.config.get<number>('auth.bcryptRounds', 12);
  }
}
