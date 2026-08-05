import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import type { User } from '../../generated/prisma/client';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  CreateAdminDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshTokenDto,
  RegisterCustomerDto,
  RegisterTaskerDto,
  ResendVerificationEmailDto,
  ResetPasswordDto,
  SessionParamDto,
  UpdateProfileDto,
  VerifyEmailDto,
  VerifyResetOtpDto,
} from './dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtIdentityGuard } from './guards/jwt-identity.guard';
import { loginRequestExamples, loginResponseExamples } from './swagger/login.examples';

const validationErrorExample = {
  statusCode: 400,
  message: 'Validation failed',
  errors: [{ field: 'email', messages: ['email must be an email'] }],
  timestamp: '2026-08-05T08:00:00.000Z',
  path: '/api/auth/customers/register',
};

@ApiTags('01 Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('customers/register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Register a customer',
    description:
      'Creates a customer from the Latache signup fields, opens a tracked session, sends a six-digit verification OTP, and returns the bearer/refresh token pair needed to complete verification.',
  })
  @ApiCreatedResponse({
    description: 'Customer created and verification email accepted by the SMTP provider.',
    schema: {
      example: {
        success: true,
        data: {
          user: {
            id: 12,
            firstName: 'Sarah',
            lastName: 'Ahmed',
            email: 'sarah@example.com',
            phoneCountryCode: '+212',
            phoneNumber: '612345678',
            zipCode: '10001',
            role: 'customer',
            accountStatus: 'pending_verification',
            isVerified: false,
          },
          tokens: {
            accessToken: 'jwt-access-token',
            refreshToken: 'opaque-refresh-token',
            tokenType: 'Bearer',
          },
          verificationRequired: true,
        },
        message: 'Customer account created. Verify the email with the six-digit OTP.',
      },
    },
  })
  @ApiBadRequestResponse({ schema: { example: validationErrorExample } })
  @ApiConflictResponse({ description: 'An account with the email already exists.' })
  @ApiServiceUnavailableResponse({ description: 'The verification email could not be delivered.' })
  registerCustomer(@Body() dto: RegisterCustomerDto, @Req() request: Request) {
    return this.auth.registerCustomer(dto, this.metadata(dto.device, request));
  }

  @Post('taskers/register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Register and submit a tasker application',
    description:
      'Atomically processes all seven Latache tasker signup steps: account details, exactly three expertise selections, experience story, hourly rate, availability, identity documents, and service area. The account remains pending approval after email verification.',
  })
  @ApiCreatedResponse({
    description: 'Tasker application submitted and verification email accepted by SMTP.',
    schema: {
      example: {
        success: true,
        data: {
          user: {
            id: 13,
            firstName: 'Omar',
            lastName: 'Bennani',
            email: 'omar.tasker@example.com',
            role: 'tasker',
            accountStatus: 'pending_verification',
            onboardingStatus: 'submitted',
            isVerified: false,
          },
          tokens: {
            accessToken: 'jwt-access-token',
            refreshToken: 'opaque-refresh-token',
            tokenType: 'Bearer',
          },
          verificationRequired: true,
        },
        message:
          'Tasker application submitted. Verify the email while the profile awaits approval.',
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid fields, overlapping availability, or duplicate services.' })
  @ApiNotFoundResponse({ description: 'One or more selected service IDs do not exist.' })
  @ApiConflictResponse({ description: 'An account with the email already exists.' })
  @ApiServiceUnavailableResponse({ description: 'The verification email could not be delivered.' })
  registerTasker(@Body() dto: RegisterTaskerDto, @Req() request: Request) {
    return this.auth.registerTasker(dto, this.metadata(dto.device, request));
  }

  @Post('admins/register')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SuperAdmin)
  @ApiOperation({
    summary: 'Create a platform administrator',
    description:
      'Super-admin-only endpoint. Creates a verified administrator, derives the permission set from the selected admin role, and emails the temporary credentials. Another super administrator cannot be created through the API.',
  })
  @ApiCreatedResponse({
    schema: {
      example: {
        success: true,
        data: {
          user: {
            id: 20,
            adminId: 'ADM-020',
            firstName: 'Priya',
            lastName: 'Nair',
            email: 'priya@latache.com',
            role: 'admin',
            adminRole: 'finance_admin',
            accountStatus: 'active',
            permissions: ['finance.read', 'finance.manage', 'reports.read'],
            mustChangePassword: true,
            isVerified: true,
          },
        },
        message: 'Administrator account created successfully.',
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Bearer token or active session is missing/invalid.' })
  @ApiForbiddenResponse({ description: 'Only the canonical super administrator may create admins.' })
  @ApiConflictResponse({ description: 'An account with the email already exists.' })
  @ApiServiceUnavailableResponse({ description: 'Temporary credentials could not be emailed.' })
  createAdmin(@CurrentUser() actor: User, @Body() dto: CreateAdminDto) {
    return this.auth.createAdmin(actor, dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Login a customer, tasker, admin, or super administrator',
    description:
      'Authenticates local credentials, enforces email/account state, optionally validates the intended portal role, records the device session, and returns rotating tokens.',
  })
  @ApiBody({
    type: LoginDto,
    description:
      'Use expectedRole to assert the intended portal. An admin portal login accepts both admin and super_admin accounts; explicit super_admin requires the super_admin value.',
    examples: loginRequestExamples,
  })
  @ApiOkResponse({
    description: 'Role-specific user projection and rotating access/refresh token pair.',
    content: {
      'application/json': {
        examples: loginResponseExamples,
      },
    },
  })
  @ApiForbiddenResponse({
    description: 'Email unverified, account suspended/deactivated, or portal role mismatch.',
  })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password.' })
  login(@Body() dto: LoginDto, @Req() request: Request) {
    return this.auth.login(dto, this.metadata(dto.device, request));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Rotate a refresh token',
    description:
      'Consumes one active opaque refresh token in a locked transaction, revokes it, and returns a new access/refresh pair. Reuse revokes every session for the account.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        success: true,
        data: {
          accessToken: 'new-jwt-access-token',
          refreshToken: 'new-opaque-refresh-token',
          tokenType: 'Bearer',
        },
        message: 'Token refreshed successfully.',
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Refresh token invalid, expired, revoked, or reused.' })
  refresh(@Body() dto: RefreshTokenDto, @Req() request: Request) {
    return this.auth.refresh(dto, this.metadata(undefined, request));
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('bearer')
  @UseGuards(JwtIdentityGuard)
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Verify the authenticated account email',
    description:
      'Uses the latest six-digit OTP for the account represented by the bearer token. Customer accounts become active; tasker accounts move to pending approval.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        success: true,
        data: {
          user: {
            id: 12,
            email: 'sarah@example.com',
            role: 'customer',
            accountStatus: 'active',
            isVerified: true,
          },
        },
        message: 'Email verified successfully.',
      },
    },
  })
  @ApiBadRequestResponse({ description: 'OTP invalid, expired, or attempt limit reached.' })
  @ApiUnauthorizedResponse({ description: 'Registration bearer token/session invalid or expired.' })
  verifyEmail(@CurrentUser() user: User, @Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(user.id, dto);
  }

  @Post('resend-verification-email')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Resend the email verification OTP',
    description:
      'Public anti-enumeration endpoint. Missing, verified, and eligible accounts receive the same response; eligible accounts are sent a newly generated OTP.',
  })
  @ApiCreatedResponse({
    schema: {
      example: {
        success: true,
        data: { delivery: 'OTP_SENT_IF_ELIGIBLE' },
        message: 'If an unverified account exists, a verification code has been sent.',
      },
    },
  })
  @ApiServiceUnavailableResponse({ description: 'SMTP delivery failed for an eligible account.' })
  resendVerification(@Body() dto: ResendVerificationEmailDto) {
    return this.auth.resendVerification(dto);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Request a password-reset OTP',
    description:
      'Public anti-enumeration endpoint. Sends a six-digit OTP to an eligible verified account and never discloses whether an email exists.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        success: true,
        data: null,
        message: 'If an eligible account exists, password reset instructions have been sent.',
      },
    },
  })
  @ApiServiceUnavailableResponse({ description: 'SMTP delivery failed for an eligible account.' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto);
  }

  @Post('verify-reset-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Verify a password-reset OTP',
    description: 'Validates the latest unexpired reset OTP before the client displays or submits the reset form.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        success: true,
        data: { purpose: 'PASSWORD_RESET', verified: true },
        message: 'Password reset OTP verified.',
      },
    },
  })
  @ApiBadRequestResponse({ description: 'OTP invalid, expired, or attempt limit reached.' })
  verifyResetOtp(@Body() dto: VerifyResetOtpDto) {
    return this.auth.verifyResetOtp(dto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Reset an account password with OTP',
    description:
      'Consumes the latest valid OTP, hashes the new password, clears reset state, and revokes every existing session.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        success: true,
        data: null,
        message: 'Password reset successfully. Sign in with the new password.',
      },
    },
  })
  @ApiBadRequestResponse({ description: 'OTP invalid/expired, attempts exhausted, or password unchanged.' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  @Patch('change-password')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Change the authenticated account password',
    description:
      'Checks the current password, stores a new hash, clears the temporary-password flag, and revokes all sessions including the current one.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        success: true,
        data: null,
        message: 'Password changed successfully. Sign in again on your devices.',
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Current password or bearer session is invalid.' })
  @ApiBadRequestResponse({ description: 'New password matches the current password.' })
  changePassword(@CurrentUser() user: User, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.id, dto);
  }

  @Get('me')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get the authenticated account profile' })
  @ApiOkResponse({
    schema: {
      example: {
        success: true,
        data: {
          user: {
            id: 12,
            firstName: 'Sarah',
            lastName: 'Ahmed',
            email: 'sarah@example.com',
            role: 'customer',
            accountStatus: 'active',
            isVerified: true,
          },
        },
        message: 'Authenticated profile retrieved.',
      },
    },
  })
  me(@CurrentUser() user: User) {
    return this.auth.me(user.id);
  }

  @Patch('me')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Update the authenticated account profile',
    description: 'Updates only safe self-service fields; role, permissions, email, and account status cannot be changed here.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        success: true,
        data: {
          user: {
            id: 12,
            firstName: 'Sarah',
            lastName: 'Ahmed',
            phoneCountryCode: '+212',
            phoneNumber: '612345678',
          },
        },
        message: 'Profile updated successfully.',
      },
    },
  })
  updateMe(@CurrentUser() user: User, @Body() dto: UpdateProfileDto) {
    return this.auth.updateMe(user.id, dto);
  }

  @Get('sessions')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List active account sessions' })
  @ApiOkResponse({
    schema: {
      example: {
        success: true,
        data: {
          sessions: [
            {
              id: 41,
              device: 'Chrome on Windows',
              ipAddress: '127.0.0.1',
              userAgent: 'Mozilla/5.0',
              lastUsedAt: '2026-08-05T08:00:00.000Z',
              createdAt: '2026-08-05T08:00:00.000Z',
              expiresAt: '2026-09-04T08:00:00.000Z',
            },
          ],
        },
        message: 'Active sessions retrieved.',
      },
    },
  })
  listSessions(@CurrentUser() user: User) {
    return this.auth.listSessions(user.id);
  }

  @Delete('sessions/:id')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Revoke one active session owned by the account' })
  @ApiOkResponse({
    schema: {
      example: { success: true, data: null, message: 'Session revoked successfully.' },
    },
  })
  @ApiNotFoundResponse({ description: 'The active session does not belong to the account or no longer exists.' })
  revokeSession(@CurrentUser() user: User, @Param() params: SessionParamDto) {
    return this.auth.revokeSession(user.id, params.id);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('bearer')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Logout the current bearer session' })
  @ApiOkResponse({
    schema: {
      example: { success: true, data: null, message: 'Logout successful.' },
    },
  })
  logout(@CurrentUser() user: User, @Req() request: AuthenticatedRequest) {
    return this.auth.logout(user.id, request.auth.sessionId);
  }

  @Post('sessions/logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('bearer')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Logout the account from every device' })
  @ApiOkResponse({
    schema: {
      example: {
        success: true,
        data: null,
        message: 'Logged out from all devices successfully.',
      },
    },
  })
  logoutAll(@CurrentUser() user: User) {
    return this.auth.logoutAll(user.id);
  }

  private metadata(device: string | undefined, request: Request) {
    const userAgent = request.headers['user-agent'];
    return {
      device,
      ipAddress: request.ip,
      userAgent: Array.isArray(userAgent) ? userAgent.join(', ') : userAgent,
    };
  }
}
