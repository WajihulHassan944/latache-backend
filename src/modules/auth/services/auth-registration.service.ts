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
import { dateOnlyToDate, todayDateOnly } from '../../../common/utils/date.util';
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
import {
  platformAmountToUsd,
  resolvePlatformCurrencyContext,
  usdAmountToPlatform,
} from '../../platform-settings/platform-currency.presets';
import { AuthCodeService } from './auth-code.service';
import { AuthTokenService, type AuthTokens, type SessionMetadata } from './auth-token.service';

export interface RegistrationData {
  user: PublicUser;
  tokens: AuthTokens;
  verificationRequired: boolean;
  roleAdded?: UserRole;
}

type TaskerApplicationInput = Pick<
  RegisterTaskerDto,
  | 'serviceIds'
  | 'yearsOfExperience'
  | 'aboutMe'
  | 'hourlyRate'
  | 'availability'
  | 'identityDocuments'
  | 'serviceArea'
>;

interface PreparedTaskerApplication {
  serviceIds: number[];
  canonicalHourlyRate: number;
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
  ) {}

  async registerCustomer(
    dto: RegisterCustomerDto,
    metadata: SessionMetadata,
    requestedLocale?: string,
  ): Promise<SuccessEnvelope<RegistrationData>> {
    this.assertConsent(dto.acceptedTermsAndPrivacyPolicy);
    const existing = await this.repository.findUserByEmail(dto.email);
    if (existing) {
      await this.assertExistingIdentityCredentials(existing, dto.password);
      return this.addCustomerRoleToIdentity(
        existing,
        dto.acceptedTermsAndPrivacyPolicy,
        metadata,
      );
    }

    const preferredLanguage = dto.preferredLanguage
      ? this.locales.requireSupported(dto.preferredLanguage)
      : null;
    const otp = generateNumericCode(6);
    const now = new Date();
    const password = await hash(dto.password, this.bcryptRounds());

    const result = await this.repository.transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`auth-email:${dto.email.trim().toLowerCase()}`}, 0))`;
      await this.assertEmailAvailable(dto.email, transaction);
      const user = await this.repository.createUser(
        {
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          phoneCountryCode: dto.phoneCountryCode,
          phoneNumber: dto.phoneNumber,
          password,
          zipCode: dto.zipCode,
          role: UserRole.Customer,
          roles: [UserRole.Customer],
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
        },
        transaction,
      );
      await this.repository.createCustomerProfile({ userId: user.id, status: 'active' }, transaction);
      return {
        user,
        tokens: await this.tokens.issue(user, metadata, transaction, UserRole.Customer),
      };
    });

    await this.mail.sendVerificationEmail({
      to: result.user.email,
      name: dto.firstName,
      otp,
      device: metadata.device,
      locale: preferredLanguage ?? requestedLocale ?? this.locales.defaultLocale,
    });

    return success(
      {
        user: serializeUser(result.user, UserRole.Customer),
        tokens: result.tokens,
        verificationRequired: true,
      },
      'Customer account created. Verify the email with the six-digit OTP.',
    );
  }

  async registerTasker(
    dto: RegisterTaskerDto,
    metadata: SessionMetadata,
    requestedLocale?: string,
  ): Promise<SuccessEnvelope<RegistrationData>> {
    this.assertConsent(dto.acceptedTermsAndPrivacyPolicy);
    await this.validateTaskerApplication(dto);

    const existing = await this.repository.findUserByEmail(dto.email);
    if (existing) {
      await this.assertExistingIdentityCredentials(existing, dto.password);
      return this.addTaskerRoleToIdentity(existing, dto, metadata);
    }

    const preferredLanguage = dto.preferredLanguage
      ? this.locales.requireSupported(dto.preferredLanguage)
      : null;
    const otp = generateNumericCode(6);
    const now = new Date();
    const password = await hash(dto.password, this.bcryptRounds());
    const serviceIds = [...new Set(dto.serviceIds)];

    try {
      const result = await this.repository.transaction(
        async (transaction: Prisma.TransactionClient) => {
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`auth-email:${dto.email.trim().toLowerCase()}`}, 0))`;
          await this.assertEmailAvailable(dto.email, transaction);
          const application = await this.prepareTaskerApplication(dto, transaction);
          const user = await this.repository.createUser(
            {
              firstName: dto.firstName,
              lastName: dto.lastName,
              email: dto.email,
              phoneCountryCode: dto.phoneCountryCode,
              phoneNumber: dto.phoneNumber,
              password,
              zipCode: dto.zipCode,
              role: UserRole.Tasker,
              roles: [UserRole.Tasker],
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
              yearsOfExperience: dto.yearsOfExperience,
              hourlyRate: application.canonicalHourlyRate,
              aboutMe: dto.aboutMe,
              bio: dto.aboutMe,
              idType: dto.identityDocuments.governmentIdType,
              docType: dto.identityDocuments.governmentIdType,
              identityDocument: dto.identityDocuments as unknown as Prisma.InputJsonValue,
              serviceAreaLabel: dto.serviceArea.label,
              serviceAreaLat: dto.serviceArea.lat,
              serviceAreaLng: dto.serviceArea.lng,
              serviceAreaRadiusKm: dto.serviceArea.radiusKm,
              serviceAreaCity: dto.serviceArea.city,
              serviceAreaArea: dto.serviceArea.area,
              onboardingStatus: 'submitted',
              submittedAt: now,
              preferredLanguage,
            },
            transaction,
          );

          await this.repository.createTaskerProfile(
            { userId: user.id, status: AccountStatus.PendingApproval },
            transaction,
          );
          await this.createTaskerApplicationResources(user.id, dto, application, transaction);

          return {
            user,
            tokens: await this.tokens.issue(user, metadata, transaction, UserRole.Tasker),
          };
        },
      );

      await this.mail.sendVerificationEmail({
        to: result.user.email,
        name: dto.firstName,
        otp,
        device: metadata.device,
        locale: preferredLanguage ?? requestedLocale ?? this.locales.defaultLocale,
      });

      return success(
        {
          user: serializeUser(result.user, UserRole.Tasker),
          tokens: result.tokens,
          verificationRequired: true,
        },
        'Tasker application submitted. Verify the email while the profile awaits approval.',
      );
    } catch (error) {
      this.rethrowUniqueEmail(error);
      throw error;
    }
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
    await this.validateTaskerApplication(dto);
    const user = await this.repository.findUserById(userId);
    if (!user || user.deletedAt) throw new NotFoundException('Account not found');
    return this.addTaskerRoleToIdentity(user, dto, metadata);
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
    dto: TaskerApplicationInput,
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
      const application = await this.prepareTaskerApplication(dto, transaction);
      await this.repository.createTaskerProfile(
        { userId: locked.id, status: AccountStatus.PendingApproval },
        transaction,
      );
      const previousRoles = userRoles(locked);
      const updated = await this.repository.updateUser(
        locked.id,
        {
          roles: { set: normalizeRoleMembership(previousRoles, UserRole.Tasker) },
          yearsOfExperience: dto.yearsOfExperience,
          hourlyRate: application.canonicalHourlyRate,
          aboutMe: dto.aboutMe,
          bio: locked.bio || dto.aboutMe,
          idType: dto.identityDocuments.governmentIdType,
          docType: dto.identityDocuments.governmentIdType,
          identityDocument: dto.identityDocuments as unknown as Prisma.InputJsonValue,
          serviceAreaLabel: dto.serviceArea.label,
          serviceAreaLat: dto.serviceArea.lat,
          serviceAreaLng: dto.serviceArea.lng,
          serviceAreaRadiusKm: dto.serviceArea.radiusKm,
          serviceAreaCity: dto.serviceArea.city,
          serviceAreaArea: dto.serviceArea.area,
          onboardingStatus: 'submitted',
          submittedAt: now,
          acceptedTermsAt: locked.acceptedTermsAt ?? now,
          acceptedPrivacyAt: locked.acceptedPrivacyAt ?? now,
        },
        transaction,
      );
      await this.createTaskerApplicationResources(locked.id, dto, application, transaction);
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
      'Tasker role added to the existing Latache account. The Tasker profile is pending approval.',
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
    if (user.deletedAt || !user.password || !(await compare(password, user.password))) {
      throw new UnauthorizedException('An account with this email already exists; authenticate with the existing account to add another role.');
    }
    this.assertIdentityUsableForRoleEnrollment(user);
    if (user.loginLockedUntil && user.loginLockedUntil.getTime() > Date.now()) {
      throw new ForbiddenException({
        code: 'LOCAL_LOGIN_TEMPORARILY_LOCKED',
        message: 'The existing identity is temporarily locked after failed login attempts.',
      });
    }
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

  private async validateTaskerApplication(dto: TaskerApplicationInput): Promise<void> {
    this.validateTaskerAvailability(dto);
    const serviceIds = [...new Set(dto.serviceIds)];
    if (serviceIds.length !== dto.serviceIds.length) {
      throw new BadRequestException('serviceIds must not contain duplicates');
    }
    const serviceCount = await this.repository.countServices(serviceIds);
    if (serviceCount !== serviceIds.length) {
      throw new NotFoundException('One or more selected services do not exist');
    }
  }

  private async prepareTaskerApplication(
    dto: TaskerApplicationInput,
    transaction: Prisma.TransactionClient,
  ): Promise<PreparedTaskerApplication> {
    const serviceIds = [...new Set(dto.serviceIds)];
    const [services, currencySetting] = await Promise.all([
      transaction.service.findMany({
        where: { id: { in: serviceIds }, isActive: true },
        select: { id: true, minHourlyRateUsd: true, maxHourlyRateUsd: true },
      }),
      transaction.platformSetting.findUnique({ where: { key: 'currency' }, select: { value: true } }),
    ]);
    if (services.length !== serviceIds.length) {
      throw new NotFoundException('One or more selected services are unavailable');
    }

    const currency = resolvePlatformCurrencyContext(
      (currencySetting?.value ?? {}) as Record<string, unknown>,
    );
    const canonicalHourlyRate = platformAmountToUsd(dto.hourlyRate, currency);
    const invalid = services.find((service) => {
      const minimum = Number(service.minHourlyRateUsd);
      const maximum = Number(service.maxHourlyRateUsd);
      return canonicalHourlyRate < minimum || canonicalHourlyRate > maximum;
    });
    if (invalid) {
      const minimum = Number(invalid.minHourlyRateUsd);
      const maximum = Number(invalid.maxHourlyRateUsd);
      throw new BadRequestException({
        code: 'TASKER_RATE_OUT_OF_SERVICE_RANGE',
        message: `Hourly rate must be between ${currency.symbol}${usdAmountToPlatform(minimum, currency)} and ${currency.symbol}${usdAmountToPlatform(maximum, currency)} for every selected service.`,
        serviceId: String(invalid.id),
        minimumHourlyRate: usdAmountToPlatform(minimum, currency),
        maximumHourlyRate: usdAmountToPlatform(maximum, currency),
        currency: currency.code,
        symbol: currency.symbol,
      });
    }
    return { serviceIds, canonicalHourlyRate };
  }

  private async createTaskerApplicationResources(
    userId: number,
    dto: TaskerApplicationInput,
    application: PreparedTaskerApplication,
    transaction: Prisma.TransactionClient,
  ): Promise<void> {
    const serviceIds = application.serviceIds;
    await transaction.userService.createMany({
      data: serviceIds.map((serviceId) => ({
        userId,
        serviceId,
        hourlyRate: application.canonicalHourlyRate.toFixed(2),
      })),
    });
    await transaction.userAvailability.createMany({
      data: dto.availability.map((slot) => ({
        userId,
        date: this.dateOnly(slot.date),
        startTime: slot.startTime,
        endTime: slot.endTime,
      })),
    });
  }

  private validateTaskerAvailability(dto: Pick<TaskerApplicationInput, 'availability'>): void {
    const seen = new Set<string>();
    const today = dateOnlyToDate(todayDateOnly());
    const byDate = new Map<string, Array<{ startTime: string; endTime: string }>>();

    for (const slot of dto.availability) {
      const date = this.dateOnly(slot.date);
      if (date.getTime() < today.getTime()) {
        throw new BadRequestException(`Availability date ${slot.date} is in the past`);
      }
      if (slot.endTime <= slot.startTime) {
        throw new BadRequestException(`endTime must be later than startTime for ${slot.date}`);
      }
      const key = `${slot.date}:${slot.startTime}:${slot.endTime}`;
      if (seen.has(key)) {
        throw new BadRequestException('Availability contains duplicate slots');
      }
      seen.add(key);

      const slots = byDate.get(slot.date) ?? [];
      slots.push({ startTime: slot.startTime, endTime: slot.endTime });
      byDate.set(slot.date, slots);
    }

    for (const [date, slots] of byDate) {
      slots.sort((left, right) => left.startTime.localeCompare(right.startTime));
      for (let index = 1; index < slots.length; index += 1) {
        const previous = slots[index - 1];
        const current = slots[index];
        if (previous && current && current.startTime < previous.endTime) {
          throw new BadRequestException(`Availability slots overlap on ${date}`);
        }
      }
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

  private dateOnly(value: string): Date {
    try {
      return dateOnlyToDate(value);
    } catch {
      throw new BadRequestException(`Invalid date: ${value}`);
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
