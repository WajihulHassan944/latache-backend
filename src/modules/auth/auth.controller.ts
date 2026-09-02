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
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { RequestLocale } from '../localization/request-locale.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import type { User } from '../../generated/prisma/client';
import { AuthService } from './auth.service';
import {
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
  SetPasswordDto,
  SessionParamDto,
  SwitchRoleDto,
  SocialAuthDto,
  LinkSocialAuthDto,
  UpdateProfileDto,
  VerifyEmailDto,
  VerifyResetOtpDto,
} from './dto';
import { AdminAuthGuard } from './guards/admin-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { loginRequestExamples, loginResponseExamples } from './swagger/login.examples';
import { SOCIAL_AUTH_PROVIDER } from './social-auth.constants';

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
      'Creates a pending customer signup without enabling the Customer role or CustomerProfile, sends a six-digit verification OTP, and returns a limited verification session used only to complete email verification.',
  })
  @ApiCreatedResponse({
    description: 'Pending customer signup created/updated and verification email accepted by the configured email provider.',
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
            preferredLanguage: 'ar',
            zipCode: '10001',
            role: '',
            primaryRole: '',
            roles: [],
            pendingRole: 'customer',
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
  @ApiConflictResponse({ description: 'A verified account already exists, or the existing unverified signup cannot be safely replaced.' })
  @ApiServiceUnavailableResponse({ description: 'The verification email could not be delivered.' })
  @ApiHeader({
    name: 'Accept-Language',
    required: false,
    example: 'ary-MA, ar;q=0.8, en;q=0.5',
    description:
      'Supports en, ar, and ary (Moroccan Darija). A submitted/saved preferredLanguage takes priority; English is the fallback.',
  })
  registerCustomer(
    @Body() dto: RegisterCustomerDto,
    @Req() request: Request,
    @RequestLocale() locale: string,
  ) {
    return this.auth.registerCustomer(dto, this.metadata(dto.device, request), locale);
  }

  @Post('taskers/register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Register a tasker (step 1 of 2)',
    description:
      'Creates a pending tasker signup with the same lightweight fields as customer signup (name, email, phone, password, zip), without enabling the Tasker role or TaskerProfile. Sends a six-digit verification OTP and returns a limited verification session used only to complete email verification. Retrying with the same unverified email refreshes the pending signup instead of failing. After verifying with POST /auth/verify-email, submit services, experience, availability, identity documents, and service area via POST /taskers/onboarding to complete the application.',
  })
  @ApiCreatedResponse({
    description: 'Pending tasker signup created/updated and verification email accepted by the configured email provider.',
    schema: {
      example: {
        success: true,
        data: {
          user: {
            id: 13,
            firstName: 'Omar',
            lastName: 'Bennani',
            email: 'omar.tasker@example.com',
            phoneCountryCode: '+212',
            phoneNumber: '661234567',
            zipCode: '10001',
            role: '',
            primaryRole: '',
            roles: [],
            pendingRole: 'tasker',
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
        message:
          'Signup received. Verify your email with the six-digit OTP to activate the Tasker account, then submit your professional application via POST /taskers/onboarding.',
      },
    },
  })
  @ApiBadRequestResponse({ schema: { example: validationErrorExample } })
  @ApiConflictResponse({ description: 'A verified account already exists, or the existing unverified signup cannot be safely replaced.' })
  @ApiServiceUnavailableResponse({ description: 'The verification email could not be delivered.' })
  @ApiHeader({
    name: 'Accept-Language',
    required: false,
    example: 'ary-MA, ar;q=0.8, en;q=0.5',
    description:
      'Supports en, ar, and ary (Moroccan Darija). A submitted/saved preferredLanguage takes priority; English is the fallback.',
  })
  registerTasker(
    @Body() dto: RegisterTaskerDto,
    @Req() request: Request,
    @RequestLocale() locale: string,
  ) {
    return this.auth.registerTasker(dto, this.metadata(dto.device, request), locale);
  }

  @Post('roles/customer')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Enable Customer access on the current identity',
    description:
      'Adds a CustomerProfile and customer role to an existing verified Tasker identity without creating another User, email, password, or session identity.',
  })
  @ApiCreatedResponse({
    description: 'Customer role added. Returned tokens are scoped to the customer portal.',
  })
  @ApiConflictResponse({ description: 'Customer role already exists.' })
  @ApiForbiddenResponse({ description: 'Administrative identities cannot add marketplace roles.' })
  addCustomerRole(
    @CurrentUser() user: User,
    @Body() dto: AddCustomerRoleDto,
    @Req() request: Request,
  ) {
    return this.auth.addCustomerRole(user.id, dto, this.metadata(undefined, request));
  }

  @Post('roles/tasker')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Enable Tasker access on the current identity',
    description:
      'Adds Tasker capability to an existing verified Customer identity. Shared credentials remain on the same User; no professional details are required here. Submit services, experience, availability, identity documents, and service area via POST /taskers/onboarding to complete the application; the returned tokens are tasker-scoped.',
  })
  @ApiCreatedResponse({
    description: 'Tasker role added. Complete the application via POST /taskers/onboarding.',
  })
  @ApiForbiddenResponse({ description: 'Administrative identities cannot add marketplace roles.' })
  @ApiConflictResponse({ description: 'Tasker role already exists.' })
  addTaskerRole(
    @CurrentUser() user: User,
    @Body() dto: AddTaskerRoleDto,
    @Req() request: Request,
  ) {
    return this.auth.addTaskerRole(user.id, dto, this.metadata(undefined, request));
  }

  @Post('admins/register')
  @ApiBearerAuth('bearer')
  @UseGuards(AdminAuthGuard, PermissionsGuard)
  @Permissions('admins.create')
  @ApiOperation({
    summary: 'Create a platform administrator',
    description:
      'Requires admins.create. Super admin may assign any non-super-admin role; delegated admins may only create administrators whose effective permissions are a subset of their own, preventing privilege escalation. Temporary credentials are emailed.',
  })
  @ApiBody({
    type: CreateAdminDto,
    description:
      'Fetch valid role codes and permission sets from GET /api/rbac/roles and GET /api/rbac/permissions. Omit permissions to inherit the role; provide a subset for least-privilege access.',
    examples: {
      inheritedFinanceRole: {
        summary: 'Finance admin inheriting role permissions',
        value: {
          firstName: 'Priya',
          lastName: 'Nair',
          email: 'priya@latache.com',
          password: 'Temporary@12345',
          adminRole: 'finance_admin',
        },
      },
      restrictedFinanceRole: {
        summary: 'Finance admin with a permission subset',
        value: {
          firstName: 'Omar',
          lastName: 'Khan',
          email: 'omar@latache.com',
          password: 'Temporary@12345',
          adminRole: 'finance_admin',
          permissions: ['finance.read', 'reports.read'],
        },
      },
    },
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
  @ApiForbiddenResponse({ description: 'Missing admins.create or attempted privilege escalation.' })
  @ApiConflictResponse({ description: 'An account with the email already exists.' })
  @ApiServiceUnavailableResponse({ description: 'Temporary credentials could not be emailed.' })
  createAdmin(@CurrentUser() actor: User, @Body() dto: CreateAdminDto) {
    return this.auth.createAdmin(actor, dto);
  }

  @Post('social/google')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Sign up or login with Google',
    description:
      'Verifies the Google ID token server-side against Google rotating public keys, links the immutable Google subject to one Latache User, creates Customer access for a new identity, and issues the normal role-scoped Latache session. New users requesting Tasker access receive Customer tokens plus the existing POST /auth/roles/tasker onboarding next action.',
  })
  @ApiOkResponse({ description: 'Google identity verified and Latache session issued.' })
  @ApiUnauthorizedResponse({ description: 'Google ID token is invalid, expired, or for another client.' })
  @ApiConflictResponse({ description: 'Existing email requires authenticated account linking.' })
  @ApiServiceUnavailableResponse({ description: 'Google social auth client IDs are not configured.' })
  googleAuth(@Body() dto: SocialAuthDto, @Req() request: Request) {
    return this.auth.socialAuthenticate(
      SOCIAL_AUTH_PROVIDER.Google,
      dto,
      this.metadata(dto.device, request),
    );
  }

  @Post('social/apple')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Sign up or login with Apple',
    description:
      'Verifies the Sign in with Apple identity token server-side, links the immutable Apple subject to one Latache User, supports Apple private-relay email, and issues the normal role-scoped Latache session. Send firstName/lastName on the first Apple authorization when the client receives them.',
  })
  @ApiOkResponse({ description: 'Apple identity verified and Latache session issued.' })
  @ApiUnauthorizedResponse({ description: 'Apple identity token is invalid, expired, or for another client.' })
  @ApiServiceUnavailableResponse({ description: 'Apple social auth client IDs are not configured.' })
  appleAuth(@Body() dto: SocialAuthDto, @Req() request: Request) {
    return this.auth.socialAuthenticate(
      SOCIAL_AUTH_PROVIDER.Apple,
      dto,
      this.metadata(dto.device, request),
    );
  }

  @Post('social/google/link')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @ApiBearerAuth('bearer')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Link a Google account after step-up reauthentication of the current Latache identity' })
  linkGoogle(@CurrentUser() user: User, @Body() dto: LinkSocialAuthDto) {
    return this.auth.linkSocial(user.id, SOCIAL_AUTH_PROVIDER.Google, dto);
  }

  @Post('social/apple/link')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @ApiBearerAuth('bearer')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Link an Apple account after step-up reauthentication of the current Latache identity' })
  linkApple(@CurrentUser() user: User, @Body() dto: LinkSocialAuthDto) {
    return this.auth.linkSocial(user.id, SOCIAL_AUTH_PROVIDER.Apple, dto);
  }

  @Delete('social/google/link')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('bearer')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Unlink Google from the current Latache identity' })
  unlinkGoogle(@CurrentUser() user: User) {
    return this.auth.unlinkSocial(user.id, SOCIAL_AUTH_PROVIDER.Google);
  }

  @Delete('social/apple/link')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('bearer')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Unlink Apple from the current Latache identity' })
  unlinkApple(@CurrentUser() user: User) {
    return this.auth.unlinkSocial(user.id, SOCIAL_AUTH_PROVIDER.Apple);
  }

  @Get('social/methods')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List enabled sign-in methods for the current Latache identity' })
  socialMethods(@CurrentUser() user: User) {
    return this.auth.socialMethods(user.id);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Login a customer, tasker, admin, or super administrator',
    description:
      'Authenticates the single email/password identity, selects one enabled role for the session, enforces role-profile state, records the active role on the refresh session, and returns rotating tokens.',
  })
  @ApiBody({
    type: LoginDto,
    description:
      'Use role to select customer/tasker/admin/super_admin. expectedRole remains a backward-compatible alias. A dual Customer+Tasker identity must select a role.',
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
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description: 'Request rate limit exceeded.',
  })
  login(@Body() dto: LoginDto, @Req() request: Request) {
    return this.auth.login(dto, this.metadata(dto.device, request));
  }

  @Post('switch-role')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('bearer')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Switch the active Customer/Tasker portal role',
    description:
      'Validates that the role belongs to this identity, revokes the current role-scoped session, and returns a fresh access/refresh pair for the selected role.',
  })
  @ApiOkResponse({ description: 'Role switched and a new role-scoped token pair issued.' })
  @ApiForbiddenResponse({ description: 'Requested role is not enabled or its profile is inactive.' })
  switchRole(
    @CurrentUser() user: User,
    @Body() dto: SwitchRoleDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.auth.switchRole(
      user.id,
      request.auth.sessionId,
      dto.role,
      this.metadata(dto.device, request),
    );
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
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Verify an account email with a six-digit OTP',
    description:
      'Public endpoint. Validates the latest six-digit OTP for the given email, then verifies the account and activates the pending Customer or Tasker role. Returns a normal role-scoped access/refresh token pair on success.',
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
          tokens: {
            accessToken: 'jwt-access-token',
            refreshToken: 'opaque-refresh-token',
            tokenType: 'Bearer',
          },
        },
        message: 'Email verified successfully.',
      },
    },
  })
  @ApiBadRequestResponse({ description: 'OTP invalid, expired, or attempt limit reached.' })
  verifyEmail(@Body() dto: VerifyEmailDto, @Req() request: Request) {
    return this.auth.verifyEmail(dto, this.metadata(dto.device, request));
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
  @ApiServiceUnavailableResponse({ description: 'Email delivery failed for an eligible account.' })
  @ApiHeader({
    name: 'Accept-Language',
    required: false,
    example: 'ary-MA, ar;q=0.8, en;q=0.5',
    description:
      'Supports en, ar, and ary (Moroccan Darija). A saved preferredLanguage takes priority; English is the fallback.',
  })
  resendVerification(@Body() dto: ResendVerificationEmailDto, @RequestLocale() locale: string) {
    return this.auth.resendVerification(dto, locale);
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
  @ApiServiceUnavailableResponse({ description: 'Email delivery failed for an eligible account.' })
  @ApiHeader({
    name: 'Accept-Language',
    required: false,
    example: 'ary-MA, ar;q=0.8, en;q=0.5',
    description:
      'Supports en, ar, and ary (Moroccan Darija). A saved preferredLanguage takes priority; English is the fallback.',
  })
  forgotPassword(@Body() dto: ForgotPasswordDto, @RequestLocale() locale: string) {
    return this.auth.forgotPassword(dto, locale);
  }

  @Post('verify-reset-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Verify a password-reset OTP',
    description:
      'Validates the latest unexpired reset OTP before the client displays or submits the reset form.',
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
  @ApiBadRequestResponse({
    description: 'OTP invalid/expired, attempts exhausted, or password unchanged.',
  })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  @Post('set-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiBearerAuth('bearer')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Enable a local password on a social-only account',
    description:
      'Allows an authenticated Google/Apple-only identity to add a local Latache password after fresh reauthentication with an already-linked provider. Existing local-password accounts must use change-password.',
  })
  @ApiOkResponse({
    schema: {
      example: { success: true, data: null, message: 'Local password enabled successfully.' },
    },
  })
  @ApiConflictResponse({ description: 'A local password is already enabled.' })
  setPassword(@CurrentUser() user: User, @Body() dto: SetPasswordDto) {
    return this.auth.setPassword(user.id, dto);
  }

  @Patch('change-password')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
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
  me(@CurrentUser() user: User, @Req() request: AuthenticatedRequest) {
    return this.auth.me(user.id, request.auth.role);
  }

  @Patch('me')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Update the authenticated account profile',
    description:
      'Updates safe self-service fields including preferredLanguage (en/ar/ary, where ary is Moroccan Darija). The saved preference controls backend-generated dynamic content, notifications, and email before Accept-Language; role, permissions, email, and account status cannot be changed here.',
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
  updateMe(
    @CurrentUser() user: User,
    @Body() dto: UpdateProfileDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.auth.updateMe(user.id, dto, request.auth.role);
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
  @ApiParam({ name: 'id', required: true, type: Number, description: 'Session ID.', example: 12 })
  @ApiOperation({ summary: 'Revoke one active session owned by the account' })
  @ApiOkResponse({
    schema: {
      example: { success: true, data: null, message: 'Session revoked successfully.' },
    },
  })
  @ApiNotFoundResponse({
    description: 'The active session does not belong to the account or no longer exists.',
  })
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
