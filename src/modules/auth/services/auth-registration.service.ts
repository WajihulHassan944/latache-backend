import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { compare, hash } from 'bcryptjs';
import { AccountStatus } from '../../../common/enums/account-status.enum';
import { AdminRole } from '../../../common/enums/admin-role.enum';
import { UserRole } from '../../../common/enums/user-role.enum';
import { generateNumericCode } from '../../../common/utils/crypto.util';
import {
  hasAnyUserRole,
  hasUserRole,
  normalizeRoleMembership,
  userRoles,
} from '../../../common/utils/user-role.util';
import { serializeUser, type PublicUser } from '../../../common/utils/user.util';
import { hasPrismaErrorCode } from '../../../database/prisma-error.util';
import type { Prisma, User } from '../../../generated/prisma/client';
import { AdminAuditService } from '../../admin-audit/admin-audit.service';
import { MailService } from '../../mail/mail.service';
import { RbacAccessService } from '../../rbac/services/rbac-access.service';
import { success, type SuccessEnvelope } from '../auth-response';
import type {
  AddCustomerRoleDto,
  AddTaskerRoleDto,
  CreateAdminDto,
  RegisterCustomerDto,
  RegisterTaskerDto,
} from '../dto';
import { AuthRepository } from '../repositories/auth.repository';
import { LocaleService } from '../../localization/locale.service';
import { AuthCodeService } from './auth-code.service';
import { AuthLockoutService } from './auth-lockout.service';
import { AuthTokenService, type AuthTokens, type SessionMetadata } from './auth-token.service';

export interface RegistrationData {
  user: PublicUser;
  tokens: AuthTokens;
  verificationRequired: boolean;
  roleAdded?: UserRole;
}

@Injectable()
export class AuthRegistrationService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly tokens: AuthTokenService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly rbac: RbacAccessService,
    private readonly audit: AdminAuditService,
    private readonly locales: LocaleService,
    private readonly authCodes: AuthCodeService,
    private readonly lockout: AuthLockoutService,
  ) {}

  async registerCustomer(
    dto: RegisterCustomerDto,
    metadata: SessionMetadata,
    requestedLocale?: string,
  ): Promise<SuccessEnvelope<RegistrationData>> {
    this.assertConsent(dto.acceptedTermsAndPrivacyPolicy);

    const preferredLanguage = dto.preferredLanguage
      ? this.locales.requireSupported(dto.preferredLanguage)
      : null;
    const otp = generateNumericCode(6);
    const now = new Date();
    const password = await hash(dto.password, this.bcryptRounds());

    const result = await this.repository.transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`auth-email:${dto.email.trim().toLowerCase()}`}, 0))`;

      const existing = await this.repository.findUserByEmail(dto.email, transaction);
      if (existing) {
        if (existing.deletedAt) {
          throw new ConflictException('An account with this email already exists');
        }
        if (existing.isVerified) {
          await this.assertExistingIdentityCredentials(existing, dto.password);
          return { kind: 'verified' as const, user: existing };
        }
        if (
          existing.accountStatus !== AccountStatus.PendingVerification ||
          (existing.role && existing.role !== '' && existing.role !== UserRole.Customer) ||
          (existing.roles.length > 0 && !existing.roles.every((role) => role === UserRole.Customer))
        ) {
          throw new ConflictException({
            code: 'UNVERIFIED_SIGNUP_CANNOT_BE_REPLACED',
            message:
            'An unverified signup already exists for this email. Complete that signup or use its verification flow.',
          });
        }

        // An unverified local signup is only a pending registration, not an
        // enabled Customer identity. Replace its signup data and invalidate
        // the old verification code/session so the owner can retry safely.
        await this.repository.updateUser(
          existing.id,
          {
            firstName: dto.firstName,
            lastName: dto.lastName,
            phoneCountryCode: dto.phoneCountryCode,
            phoneNumber: dto.phoneNumber,
            password,
            zipCode: dto.zipCode,
            role: '',
            roles: { set: [] },
            accountStatus: AccountStatus.PendingVerification,
            isVerified: false,
            isAdmin: false,
            authType: 'local',
            otp: null,
            otpHash: this.authCodes.hash('email-verification', otp),
            otpExpires: this.otpExpiry(),
            otpAttempts: 0,
            acceptedTermsAt: now,
            acceptedPrivacyAt: now,
            preferredLanguage,
            onboardingStatus: 'pending_customer_verification',
            submittedAt: null,
          },
          transaction,
        );
        await transaction.refreshToken.updateMany({
          where: { userId: existing.id, revokedAt: null },
          data: { revokedAt: now },
        });
        await transaction.customerProfile.deleteMany({ where: { userId: existing.id } });
        const updated = await this.repository.findUserByIdForUpdate(existing.id, transaction);
        if (!updated) throw new NotFoundException('Account not found');
        return { kind: 'pending' as const, user: updated };
      }

      const user = await this.repository.createUser(
        {
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          phoneCountryCode: dto.phoneCountryCode,
          phoneNumber: dto.phoneNumber,
          password,
          zipCode: dto.zipCode,
          role: '',
          roles: [],
          accountStatus: AccountStatus.PendingVerification,
          isVerified: false,
          isAdmin: false,
          authType: 'local',
          otp: null,
          otpHash: this.authCodes.hash('email-verification', otp),
          otpExpires: this.otpExpiry(),
          otpAttempts: 0,
          acceptedTermsAt: now,
          acceptedPrivacyAt: now,
          preferredLanguage,
          onboardingStatus: 'pending_customer_verification',
        },
        transaction,
      );
      return { kind: 'pending' as const, user };
    });

    if (result.kind === 'verified') {
      return this.addCustomerRoleToIdentity(result.user, dto.acceptedTermsAndPrivacyPolicy, metadata);
    }

    const tokens = await this.tokens.issueVerificationSession(
      result.user,
      metadata,
      undefined,
      UserRole.Customer,
    );

    await this.mail.sendVerificationEmail({
      to: result.user.email,
      name: dto.firstName,
      otp,
      device: metadata.device,
      locale: preferredLanguage ?? requestedLocale ?? this.locales.defaultLocale,
    });

    const serialized = serializeUser(result.user);
    serialized.pendingRole = UserRole.Customer;
    serialized.verificationState = 'pending';

    return success(
      {
        user: serialized,
        tokens,
        verificationRequired: true,
      },
      'Signup received. Verify your email with the six-digit OTP to activate the Customer account.',
    );
  }

  async registerTasker(
    dto: RegisterTaskerDto,
    metadata: SessionMetadata,
    requestedLocale?: string,
  ): Promise<SuccessEnvelope<RegistrationData>> {
    this.assertConsent(dto.acceptedTermsAndPrivacyPolicy);

    const preferredLanguage = dto.preferredLanguage
      ? this.locales.requireSupported(dto.preferredLanguage)
      : null;
    const otp = generateNumericCode(6);
    const now = new Date();
    const password = await hash(dto.password, this.bcryptRounds());

    const result = await this.repository.transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`auth-email:${dto.email.trim().toLowerCase()}`}, 0))`;

      const existing = await this.repository.findUserByEmail(dto.email, transaction);
      if (existing) {
        if (existing.deletedAt) {
          throw new ConflictException('An account with this email already exists');
        }
        if (existing.isVerified) {
          await this.assertExistingIdentityCredentials(existing, dto.password);
          return { kind: 'verified' as const, user: existing };
        }
        if (
          existing.accountStatus !== AccountStatus.PendingVerification ||
          (existing.role && existing.role !== '' && existing.role !== UserRole.Tasker) ||
          (existing.roles.length > 0 && !existing.roles.every((role) => role === UserRole.Tasker))
        ) {
          throw new ConflictException({
            code: 'UNVERIFIED_SIGNUP_CANNOT_BE_REPLACED',
            message:
            'An unverified signup already exists for this email. Complete that signup or use its verification flow.',
          });
        }

        // An unverified local signup is only a pending registration, not an
        // enabled Tasker identity. Replace its signup data and invalidate the
        // old verification code/session so the owner can retry safely.
        await this.repository.updateUser(
          existing.id,
          {
            firstName: dto.firstName,
            lastName: dto.lastName,
            phoneCountryCode: dto.phoneCountryCode,
            phoneNumber: dto.phoneNumber,
            password,
            zipCode: dto.zipCode,
            role: '',
            roles: { set: [] },
            accountStatus: AccountStatus.PendingVerification,
            isVerified: false,
            isAdmin: false,
            authType: 'local',
            otp: null,
            otpHash: this.authCodes.hash('email-verification', otp),
            otpExpires: this.otpExpiry(),
            otpAttempts: 0,
            acceptedTermsAt: now,
            acceptedPrivacyAt: now,
            preferredLanguage,
            onboardingStatus: 'pending_tasker_verification',
            submittedAt: null,
          },
          transaction,
        );
        await transaction.refreshToken.updateMany({
          where: { userId: existing.id, revokedAt: null },
          data: { revokedAt: now },
        });
        await transaction.taskerProfile.deleteMany({ where: { userId: existing.id } });
        const updated = await this.repository.findUserByIdForUpdate(existing.id, transaction);
        if (!updated) throw new NotFoundException('Account not found');
        return { kind: 'pending' as const, user: updated };
      }

      const user = await this.repository.createUser(
        {
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          phoneCountryCode: dto.phoneCountryCode,
          phoneNumber: dto.phoneNumber,
          password,
          zipCode: dto.zipCode,
          role: '',
          roles: [],
          accountStatus: AccountStatus.PendingVerification,
          isVerified: false,
          isAdmin: false,
          authType: 'local',
          otp: null,
          otpHash: this.authCodes.hash('email-verification', otp),
          otpExpires: this.otpExpiry(),
          otpAttempts: 0,
          acceptedTermsAt: now,
          acceptedPrivacyAt: now,
          preferredLanguage,
          onboardingStatus: 'pending_tasker_verification',
        },
        transaction,
      );
      return { kind: 'pending' as const, user };
    });

    if (result.kind === 'verified') {
      return this.addTaskerRoleToIdentity(result.user, metadata);
    }

    const tokens = await this.tokens.issueVerificationSession(
      result.user,
      metadata,
      undefined,
      UserRole.Tasker,
    );

    await this.mail.sendVerificationEmail({
      to: result.user.email,
      name: dto.firstName,
      otp,
      device: metadata.device,
      locale: preferredLanguage ?? requestedLocale ?? this.locales.defaultLocale,
    });

    const serialized = serializeUser(result.user);
    serialized.pendingRole = UserRole.Tasker;
    serialized.verificationState = 'pending';

    return success(
      {
        user: serialized,
        tokens,
        verificationRequired: true,
      },
      'Signup received. Verify your email with the six-digit OTP to activate the Tasker account, then submit your professional application via POST /taskers/onboarding.',
    );
  }

  async addCustomerRole(
    userId: number,
    dto: AddCustomerRoleDto,
    metadata: SessionMetadata,
  ): Promise<SuccessEnvelope<RegistrationData>> {
    this.assertConsent(dto.acceptedTermsAndPrivacyPolicy);
    const user = await this.repository.findUserById(userId);
    if (!user || user.deletedAt) throw new NotFoundException('Account not found');
    return this.addCustomerRoleToIdentity(user, dto.acceptedTermsAndPrivacyPolicy, metadata);
  }

  async addTaskerRole(
    userId: number,
    dto: AddTaskerRoleDto,
    metadata: SessionMetadata,
  ): Promise<SuccessEnvelope<RegistrationData>> {
    this.assertConsent(dto.acceptedTermsAndPrivacyPolicy);
    const user = await this.repository.findUserById(userId);
    if (!user || user.deletedAt) throw new NotFoundException('Account not found');
    return this.addTaskerRoleToIdentity(user, metadata);
  }

  private async addCustomerRoleToIdentity(
    identity: User,
    accepted: boolean,
    metadata: SessionMetadata,
  ): Promise<SuccessEnvelope<RegistrationData>> {
    this.assertConsent(accepted);
    this.assertMarketplaceRoleCanBeAdded(identity, UserRole.Customer);
    if (!identity.isVerified) {
      throw new ConflictException({
        code: 'VERIFY_EXISTING_IDENTITY_FIRST',
        message: 'Verify the existing account before adding another role.',
      });
    }

    const result = await this.repository.transaction(async (transaction) => {
      const locked = await this.repository.findUserByIdForUpdate(identity.id, transaction);
      if (!locked || locked.deletedAt) throw new NotFoundException('Account not found');
      this.assertIdentityUsableForRoleEnrollment(locked);
      this.assertMarketplaceRoleCanBeAdded(locked, UserRole.Customer);

      const now = new Date();
      await this.repository.createCustomerProfile(
        { userId: locked.id, status: AccountStatus.Active, activatedAt: now },
        transaction,
      );
      const previousRoles = userRoles(locked);
      const updated = await this.repository.updateUser(
        locked.id,
        {
          roles: { set: normalizeRoleMembership(previousRoles, UserRole.Customer) },
          acceptedTermsAt: locked.acceptedTermsAt ?? now,
          acceptedPrivacyAt: locked.acceptedPrivacyAt ?? now,
        },
        transaction,
      );
      await this.audit.record(
        {
          actorId: locked.id,
          targetUserId: locked.id,
          action: 'customer_role_enabled',
          entityType: 'user_role',
          entityId: locked.id,
          metadata: { previousRoles, roles: userRoles(updated), enabledRole: UserRole.Customer },
        },
        transaction,
      );
      return {
        user: updated,
        tokens: await this.tokens.issue(updated, metadata, transaction, UserRole.Customer),
      };
    });

    return success(
      {
        user: serializeUser(result.user, UserRole.Customer),
        tokens: result.tokens,
        verificationRequired: false,
        roleAdded: UserRole.Customer,
      },
      'Customer role enabled on the existing Latache account.',
    );
  }

  private async addTaskerRoleToIdentity(
    identity: User,
    metadata: SessionMetadata,
  ): Promise<SuccessEnvelope<RegistrationData>> {
    this.assertMarketplaceRoleCanBeAdded(identity, UserRole.Tasker);
    if (!identity.isVerified) {
      throw new ConflictException({
        code: 'VERIFY_EXISTING_IDENTITY_FIRST',
        message: 'Verify the existing account before adding another role.',
      });
    }

    const result = await this.repository.transaction(async (transaction) => {
      const locked = await this.repository.findUserByIdForUpdate(identity.id, transaction);
      if (!locked || locked.deletedAt) throw new NotFoundException('Account not found');
      this.assertIdentityUsableForRoleEnrollment(locked);
      this.assertMarketplaceRoleCanBeAdded(locked, UserRole.Tasker);

      const now = new Date();
      await this.repository.createTaskerProfile(
        { userId: locked.id, status: AccountStatus.PendingApproval },
        transaction,
      );
      const previousRoles = userRoles(locked);
      const updated = await this.repository.updateUser(
        locked.id,
        {
          roles: { set: normalizeRoleMembership(previousRoles, UserRole.Tasker) },
          acceptedTermsAt: locked.acceptedTermsAt ?? now,
          acceptedPrivacyAt: locked.acceptedPrivacyAt ?? now,
        },
        transaction,
      );
      await this.audit.record(
        {
          actorId: locked.id,
          targetUserId: locked.id,
          action: 'tasker_role_enabled',
          entityType: 'user_role',
          entityId: locked.id,
          metadata: { previousRoles, roles: userRoles(updated), enabledRole: UserRole.Tasker },
        },
        transaction,
      );
      return {
        user: updated,
        tokens: await this.tokens.issue(updated, metadata, transaction, UserRole.Tasker),
      };
    });

    return success(
      {
        user: serializeUser(result.user, UserRole.Tasker),
        tokens: result.tokens,
        verificationRequired: false,
        roleAdded: UserRole.Tasker,
      },
      'Tasker role added to the existing Latache account. Submit your professional application via POST /taskers/onboarding to complete it.',
    );
  }

  async createAdmin(
    actor: User,
    dto: CreateAdminDto,
  ): Promise<SuccessEnvelope<{ user: PublicUser }>> {
    const preferredLanguage = dto.preferredLanguage
      ? this.locales.requireSupported(dto.preferredLanguage)
      : null;
    const role = await this.rbac.requireActiveRoleByCode(dto.adminRole);
    if (role.code === AdminRole.SuperAdmin) {
      throw new BadRequestException('Additional super administrators cannot be created');
    }
    const effective = this.rbac.resolveEffectivePermissions(role, dto.permissions);
    this.assertDelegatedAdminCreationAccess(actor, effective.permissions);

    try {
      await this.assertEmailAvailable(dto.email);
      const user = await this.repository.createUser({
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        phoneCountryCode: dto.phoneCountryCode ?? '',
        phoneNumber: dto.phoneNumber ?? '',
        password: await hash(dto.password, this.bcryptRounds()),
        role: UserRole.Admin,
        roles: [UserRole.Admin],
        accountStatus: AccountStatus.Active,
        rbacRoleId: role.id,
        adminRole: role.code,
        permissions: effective.permissions,
        inheritsRolePermissions: effective.inheritsRolePermissions,
        mustChangePassword: true,
        isVerified: true,
        isAdmin: true,
        authType: 'local',
        createdById: actor.id,
        preferredLanguage,
      });

      await this.audit.record({
        actorId: actor.id,
        targetUserId: user.id,
        action: 'administrator_created',
        entityType: 'administrator',
        entityId: user.id,
        metadata: {
          adminRole: role.code,
          permissions: effective.permissions,
          inheritsRolePermissions: effective.inheritsRolePermissions,
        },
      });

      await this.mail.sendAdminWelcomeEmail({
        to: user.email,
        name: user.firstName || user.email,
        temporaryPassword: dto.password,
        adminRole: role.code,
        locale: preferredLanguage ?? this.locales.defaultLocale,
      });

      return success({ user: serializeUser(user, UserRole.Admin) }, 'Administrator account created successfully.');
    } catch (error) {
      this.rethrowUniqueEmail(error);
      throw error;
    }
  }

  private assertDelegatedAdminCreationAccess(actor: User, targetPermissions: string[]): void {
    if (actor.role === UserRole.SuperAdmin) return;
    if (actor.role !== UserRole.Admin || !actor.permissions.includes('admins.create')) {
      throw new ForbiddenException('Administrator creation permission is required');
    }
    const actorPermissions = new Set(actor.permissions);
    const escalation = targetPermissions.filter((permission) => !actorPermissions.has(permission));
    if (escalation.length > 0) {
      throw new ForbiddenException(
        `Cannot create an administrator with permissions you do not hold: ${escalation.join(', ')}`,
      );
    }
  }

  private async assertExistingIdentityCredentials(user: User, password: string): Promise<void> {
    const credentialError = () =>
      new UnauthorizedException(
        'An account with this email already exists; authenticate with the existing account to add another role.',
      );
    // Share the same lockout check and failed-attempt bookkeeping as
    // POST /auth/login: without this, an attacker can grind passwords against
    // a known verified email through the registration endpoint instead,
    // never triggering the login lockout that protects the same credential.
    if (user.deletedAt || !user.password || this.lockout.isLocked(user)) {
      throw credentialError();
    }
    if (!(await compare(password, user.password))) {
      await this.lockout.recordFailedAttempt(user.id);
      throw credentialError();
    }
    this.assertIdentityUsableForRoleEnrollment(user);
  }

  private assertIdentityUsableForRoleEnrollment(user: User): void {
    if (user.accountStatus === AccountStatus.Suspended) {
      throw new ForbiddenException('This account is suspended');
    }
    if (user.accountStatus === AccountStatus.Deactivated) {
      throw new ForbiddenException('This account is deactivated');
    }
  }

  private assertMarketplaceRoleCanBeAdded(user: User, role: UserRole.Customer | UserRole.Tasker): void {
    if (hasUserRole(user, role)) {
      throw new ConflictException({
        code: 'ROLE_ALREADY_ENABLED',
        message: `${role === UserRole.Customer ? 'Customer' : 'Tasker'} role is already enabled for this account.`,
        roles: userRoles(user),
      });
    }
    if (hasAnyUserRole(user, [UserRole.Admin, UserRole.SuperAdmin])) {
      throw new ForbiddenException({
        code: 'ADMIN_MARKETPLACE_ROLE_SEPARATION',
        message: 'Administrator identities cannot also hold Customer or Tasker marketplace roles.',
      });
    }
  }

  private assertConsent(accepted: boolean): void {
    if (!accepted) {
      throw new BadRequestException('Terms and Conditions and Privacy Policy must be accepted');
    }
  }

  private async assertEmailAvailable(
    email: string,
    transaction?: Prisma.TransactionClient,
  ): Promise<void> {
    const existing = await this.repository.findUserByEmail(email, transaction);
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }
  }

  private otpExpiry(): Date {
    const minutes = this.config.get<number>('auth.otpExpiresInMinutes', 10);
    return new Date(Date.now() + minutes * 60_000);
  }

  private bcryptRounds(): number {
    return this.config.get<number>('auth.bcryptRounds', 12);
  }

  private rethrowUniqueEmail(error: unknown): void {
    if (hasPrismaErrorCode(error, 'P2002')) {
      throw new ConflictException('An account with this email already exists');
    }
  }
}
