import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { UserRole } from '../../common/enums/user-role.enum';
import type {
  AccessTokenPayload,
  PasswordResetTokenPayload,
} from '../../common/types/jwt-payload';
import {
  generateNumericCode,
  generateOpaqueToken,
  hashOpaqueToken,
} from '../../common/utils/crypto.util';
import { serializeUser, type PublicUser } from '../../common/utils/user.util';
import { hasPrismaErrorCode } from '../../database/prisma-error.util';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma, User } from '../../generated/prisma/client';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { EmailDto } from './dto/email.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SignUpDto } from './dto/sign-up.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}

type RefreshOutcome =
  | { kind: 'success'; accessToken: string; refreshToken: string }
  | { kind: 'invalid' }
  | { kind: 'revoked' }
  | { kind: 'expired' }
  | { kind: 'missing-user' }
  | { kind: 'unverified' };

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly mail: MailService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async getLoggedInUser(userId: number): Promise<{ user: PublicUser; message: string }> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException('You are not logged in');
    return { user: serializeUser(user), message: 'User found' };
  }

  async signUp(dto: SignUpDto): Promise<{ message: string }> {
    if (dto.role === UserRole.Admin) {
      throw new BadRequestException('Administrator accounts cannot be self-registered');
    }
    if (dto.authType.trim() !== '') {
      throw new UnprocessableEntityException(
        'Social signup is not available until provider tokens are verified server-side',
      );
    }

    const existing = await this.users.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already exists');

    const otp = generateNumericCode();
    try {
      await this.users.create({
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        zipCode: dto.zipCode,
        password: await hash(dto.password, this.getBcryptRounds()),
        role: dto.role,
        authType: dto.authType,
        phoneNumber: dto.phoneNumber ?? '',
        otp,
        otpExpires: this.getOtpExpiry(),
      });
    } catch (error) {
      if (hasPrismaErrorCode(error, 'P2002')) {
        throw new ConflictException('Email already exists');
      }
      throw error;
    }

    await this.mail.sendVerificationEmail({
      to: dto.email,
      name: dto.firstName || dto.email,
      otp,
      device: dto.device,
    });
    return { message: 'Signup successful. Please verify your email with the OTP.' };
  }

  async verifyOtp(dto: VerifyOtpDto): Promise<{ message: string }> {
    const user = await this.users.findByEmail(dto.email);
    if (!user) throw new NotFoundException('User not found');
    if (user.isVerified) throw new BadRequestException('User is already verified');
    if (!user.otp || user.otp !== dto.otp) throw new UnauthorizedException('Invalid OTP');
    if (!user.otpExpires || user.otpExpires.getTime() < Date.now()) {
      throw new UnauthorizedException('OTP has expired');
    }

    await this.users.updateById(user.id, {
      otp: null,
      otpExpires: null,
      isVerified: true,
    });
    return { message: 'OTP verified successfully. Your email is now verified.' };
  }

  async resendOtp(dto: ResendOtpDto): Promise<{ message: string }> {
    const user = await this.users.findByEmail(dto.email);
    if (!user) throw new NotFoundException('User not found');
    if (user.isVerified) throw new UnauthorizedException('Email already verified');

    const otp = generateNumericCode();
    await this.users.updateById(user.id, { otp, otpExpires: this.getOtpExpiry() });
    await this.mail.sendVerificationEmail({
      to: user.email,
      name: user.firstName || user.email,
      otp,
      device: dto.device,
    });
    return { message: 'Otp send successful. Please verify your email with the OTP.' };
  }

  async login(dto: LoginDto): Promise<{
    accessToken: string;
    refreshToken: string;
    message: string;
    user: PublicUser;
  }> {
    const user = await this.users.findByEmail(dto.email);
    if (!user) throw new NotFoundException('User not found');
    if (user.role === UserRole.Admin || user.isAdmin) {
      throw new UnauthorizedException('Not Authorized to use this email');
    }
    if (!user.password || !(await compare(dto.password, user.password))) {
      throw new UnauthorizedException('Password is incorrect');
    }

    if (!user.isVerified) {
      const otp = generateNumericCode();
      await this.users.updateById(user.id, { otp, otpExpires: this.getOtpExpiry() });
      await this.mail.sendVerificationEmail({
        to: user.email,
        name: user.firstName || user.email,
        otp,
        device: dto.device,
      });
      throw new UnauthorizedException(
        'Your Email is not Verified, Check your Email To verify.',
      );
    }

    const tokens = await this.issueTokens(user, dto.device);
    return {
      ...tokens,
      message: 'Login successfully',
      user: serializeUser(user, { loginResponse: true }),
    };
  }

  async verifyAccessToken(): Promise<{ message: string }> {
    return { message: 'Token is valid' };
  }

  async refresh(dto: RefreshTokenDto): Promise<{
    accessToken: string;
    refreshToken: string;
    message: string;
  }> {
    const tokenHash = hashOpaqueToken(dto.refreshToken);
    const outcome = await this.prisma.$transaction<RefreshOutcome>(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: number }>>`
        SELECT "id" FROM "RefreshTokens" WHERE "tokenHash" = ${tokenHash} FOR UPDATE
      `;
      if (locked.length === 0) return { kind: 'invalid' };

      const stored = await transaction.refreshToken.findUnique({ where: { tokenHash } });
      if (!stored) return { kind: 'invalid' };
      if (stored.revokedAt) {
        await this.revokeAllForUser(stored.userId, transaction);
        return { kind: 'revoked' };
      }
      if (stored.expiresAt.getTime() <= Date.now()) {
        await transaction.refreshToken.update({
          where: { id: stored.id },
          data: { revokedAt: new Date() },
        });
        return { kind: 'expired' };
      }

      const user = await this.users.findByIdForUpdate(stored.userId, transaction);
      if (!user) return { kind: 'missing-user' };
      if (!user.isVerified) {
        await this.revokeAllForUser(user.id, transaction);
        return { kind: 'unverified' };
      }

      const replacement = generateOpaqueToken();
      const replacementHash = hashOpaqueToken(replacement);
      await transaction.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: replacementHash,
          device: stored.device,
          expiresAt: this.getRefreshTokenExpiry(),
        },
      });
      await transaction.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date(), replacedByTokenHash: replacementHash },
      });

      return {
        kind: 'success',
        accessToken: await this.signAccessToken(user),
        refreshToken: replacement,
      };
    });

    if (outcome.kind === 'invalid') throw new UnauthorizedException('Refresh token is invalid');
    if (outcome.kind === 'revoked') {
      throw new UnauthorizedException('Refresh token has been revoked, please login again');
    }
    if (outcome.kind === 'expired') {
      throw new UnauthorizedException('Refresh token has expired, please login again');
    }
    if (outcome.kind === 'missing-user') throw new NotFoundException('User not found');
    if (outcome.kind === 'unverified') {
      throw new UnauthorizedException('Email is not verified');
    }

    return {
      accessToken: outcome.accessToken,
      refreshToken: outcome.refreshToken,
      message: 'Token refreshed successfully',
    };
  }

  async logout(userId: number, dto: RefreshTokenDto): Promise<{ message: string }> {
    await this.prisma.refreshToken.updateMany({
      where: {
        tokenHash: hashOpaqueToken(dto.refreshToken),
        userId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    return { message: 'Logged out successfully' };
  }

  async logoutAll(userId: number): Promise<{ message: string }> {
    await this.revokeAllForUser(userId);
    return { message: 'Logged out from all devices successfully' };
  }

  async forgotPassword(dto: EmailDto): Promise<{ message: string }> {
    const user = await this.users.findByEmail(dto.email);
    if (!user) throw new NotFoundException('User not found');

    if (!user.isVerified) {
      const otp = generateNumericCode();
      await this.users.updateById(user.id, { otp, otpExpires: this.getOtpExpiry() });
      await this.mail.sendVerificationEmail({
        to: user.email,
        name: user.firstName || user.email,
        otp,
      });
      throw new UnauthorizedException(
        'Your Email is not Verified, Check your Email To verify.',
      );
    }

    const resetCode = generateNumericCode(6);
    await this.users.updateById(user.id, {
      passwordResetCode: resetCode,
      passwordResetCodeExpires: this.getPasswordResetExpiry(),
    });

    const token = await this.signPasswordResetToken(user, resetCode);
    const frontendBaseUrl = this.config.getOrThrow<string>('app.frontendBaseUrl');
    const path = user.role === UserRole.Admin ? '/admin/reset-pass' : '/reset-password';
    const resetUrl = new URL(path, frontendBaseUrl);
    resetUrl.searchParams.set('email', user.email);
    resetUrl.searchParams.set('token', token);

    await this.mail.sendPasswordResetEmail({
      to: user.email,
      name: user.firstName || user.email,
      resetUrl: resetUrl.toString(),
    });

    return {
      message: `We have sent an email to reset your password! Please check your inbox at ${user.email}`,
    };
  }

  async verifyPasswordResetToken(token: string): Promise<{ message: string }> {
    const payload = await this.verifyResetToken(token);
    const user = await this.users.findById(payload.sub);
    const state = this.getResetRequestState(user, payload);
    if (state === 'invalid') throw new UnauthorizedException('Reset link has expired');
    if (state === 'expired') {
      if (user) {
        await this.users.updateById(user.id, {
          passwordResetCode: null,
          passwordResetCodeExpires: null,
        });
      }
      throw new UnauthorizedException('Reset link has expired');
    }
    return { message: 'Token is valid' };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    if (dto.password !== dto.conPassword) {
      throw new BadRequestException('Password confirmation does not match');
    }
    const payload = await this.verifyResetToken(dto.token);
    if (payload.email.toLowerCase() !== dto.email.toLowerCase()) {
      throw new UnauthorizedException('Reset token is invalid');
    }

    const outcome = await this.prisma.$transaction<
      { kind: 'success'; message: string } | { kind: 'expired' }
    >(async (transaction) => {
      const user = await this.users.findByIdForUpdate(payload.sub, transaction);
      const state = this.getResetRequestState(user, payload);
      if (state === 'invalid' || !user) {
        throw new UnauthorizedException('Reset link has expired');
      }
      if (state === 'expired') {
        await transaction.user.update({
          where: { id: user.id },
          data: { passwordResetCode: null, passwordResetCodeExpires: null },
        });
        return { kind: 'expired' };
      }
      if (user.password && (await compare(dto.password, user.password))) {
        throw new UnauthorizedException("Current password can't be updated as new password");
      }

      await transaction.user.update({
        where: { id: user.id },
        data: {
          password: await hash(dto.password, this.getBcryptRounds()),
          passwordResetCode: null,
          passwordResetCodeExpires: null,
        },
      });
      await this.revokeAllForUser(user.id, transaction);
      return { kind: 'success', message: 'Password changed successfully' };
    });

    if (outcome.kind === 'expired') {
      throw new UnauthorizedException('Reset link has expired');
    }
    return { message: outcome.message };
  }

  private async issueTokens(
    user: User,
    device?: string,
    transaction?: Prisma.TransactionClient,
  ): Promise<IssuedTokens> {
    const refreshToken = generateOpaqueToken();
    await (transaction ?? this.prisma).refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashOpaqueToken(refreshToken),
        device: device ?? null,
        expiresAt: this.getRefreshTokenExpiry(),
      },
    });
    return { accessToken: await this.signAccessToken(user), refreshToken };
  }

  private signAccessToken(user: User): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      id: user.id,
      isVerified: user.isVerified,
      isAdmin: user.isAdmin,
      role: user.role as UserRole,
    };
    return this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('auth.jwtSecret'),
      expiresIn: this.config.get<string>(
        'auth.accessTokenExpiresIn',
        '15m',
      ) as JwtSignOptions['expiresIn'],
    });
  }

  private signPasswordResetToken(user: User, resetCode: number): Promise<string> {
    const payload: PasswordResetTokenPayload = {
      sub: user.id,
      id: user.id,
      email: user.email,
      resetCode,
      purpose: 'password-reset',
    };
    return this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('auth.passwordResetSecret'),
      expiresIn: this.config.get<string>(
        'auth.passwordResetExpiresIn',
        '15m',
      ) as JwtSignOptions['expiresIn'],
    });
  }

  private async verifyResetToken(token: string): Promise<PasswordResetTokenPayload> {
    if (!token) throw new UnauthorizedException('Token is required');
    try {
      const payload = await this.jwt.verifyAsync<PasswordResetTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('auth.passwordResetSecret'),
      });
      if (
        payload.purpose !== 'password-reset' ||
        !Number.isSafeInteger(payload.sub) ||
        !Number.isSafeInteger(payload.resetCode) ||
        !payload.email
      ) {
        throw new UnauthorizedException('Reset token is invalid');
      }
      return payload;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Reset token is invalid or expired');
    }
  }

  private getResetRequestState(
    user: User | null,
    payload: PasswordResetTokenPayload,
  ): 'active' | 'expired' | 'invalid' {
    if (
      !user ||
      user.email.toLowerCase() !== payload.email.toLowerCase() ||
      user.passwordResetCode !== payload.resetCode ||
      !user.passwordResetCodeExpires
    ) {
      return 'invalid';
    }
    return user.passwordResetCodeExpires.getTime() <= Date.now()
      ? 'expired'
      : 'active';
  }

  private async revokeAllForUser(
    userId: number,
    transaction?: Prisma.TransactionClient,
  ): Promise<void> {
    await (transaction ?? this.prisma).refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private getRefreshTokenExpiry(): Date {
    const days = this.config.get<number>('auth.refreshTokenExpiresInDays', 30);
    return new Date(Date.now() + days * 86_400_000);
  }

  private getOtpExpiry(): Date {
    const minutes = this.config.get<number>('auth.otpExpiresInMinutes', 5);
    return new Date(Date.now() + minutes * 60_000);
  }

  private getPasswordResetExpiry(): Date {
    const raw = this.config.get<string>('auth.passwordResetExpiresIn', '15m');
    const match = /^(\d+)([smhd])$/.exec(raw);
    if (!match) return new Date(Date.now() + 15 * 60_000);
    const amount = Number(match[1]);
    const multipliers: Record<string, number> = {
      s: 1_000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return new Date(Date.now() + amount * (multipliers[match[2] ?? 'm'] ?? 60_000));
  }

  private getBcryptRounds(): number {
    return this.config.get<number>('auth.bcryptRounds', 12);
  }
}
