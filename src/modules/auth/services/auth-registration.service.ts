import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash } from 'bcryptjs';
import { AccountStatus } from '../../../common/enums/account-status.enum';
import { AdminRole } from '../../../common/enums/admin-role.enum';
import { UserRole } from '../../../common/enums/user-role.enum';
import { generateNumericCode } from '../../../common/utils/crypto.util';
import { dateOnlyToDate, todayDateOnly } from '../../../common/utils/date.util';
import { serializeUser, type PublicUser } from '../../../common/utils/user.util';
import { hasPrismaErrorCode } from '../../../database/prisma-error.util';
import type { Prisma, User } from '../../../generated/prisma/client';
import { AdminAuditService } from '../../admin-audit/admin-audit.service';
import { MailService } from '../../mail/mail.service';
import { RbacAccessService } from '../../rbac/services/rbac-access.service';
import { success, type SuccessEnvelope } from '../auth-response';
import type { CreateAdminDto, RegisterCustomerDto, RegisterTaskerDto } from '../dto';
import { AuthRepository } from '../repositories/auth.repository';
import { AuthTokenService, type AuthTokens, type SessionMetadata } from './auth-token.service';
import { LocaleService } from '../../localization/locale.service';

export interface RegistrationData {
  user: PublicUser;
  tokens: AuthTokens;
  verificationRequired: true;
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

    const result = await this.createUserWithTokens(
      {
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        phoneCountryCode: dto.phoneCountryCode,
        phoneNumber: dto.phoneNumber,
        password,
        zipCode: dto.zipCode,
        role: UserRole.Customer,
        accountStatus: AccountStatus.PendingVerification,
        isVerified: false,
        isAdmin: false,
        authType: 'local',
        otp,
        otpExpires: this.otpExpiry(),
        otpAttempts: 0,
        acceptedTermsAt: now,
        acceptedPrivacyAt: now,
        preferredLanguage,
      },
      metadata,
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
        user: serializeUser(result.user),
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
    const preferredLanguage = dto.preferredLanguage
      ? this.locales.requireSupported(dto.preferredLanguage)
      : null;
    this.validateTaskerAvailability(dto);

    const serviceIds = [...new Set(dto.serviceIds)];
    if (serviceIds.length !== dto.serviceIds.length) {
      throw new BadRequestException('serviceIds must not contain duplicates');
    }
    const serviceCount = await this.repository.countServices(serviceIds);
    if (serviceCount !== serviceIds.length) {
      throw new NotFoundException('One or more selected services do not exist');
    }

    const otp = generateNumericCode(6);
    const now = new Date();
    const password = await hash(dto.password, this.bcryptRounds());

    try {
      const result = await this.repository.transaction(
        async (transaction: Prisma.TransactionClient) => {
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
              role: UserRole.Tasker,
              accountStatus: AccountStatus.PendingVerification,
              isVerified: false,
              isAdmin: false,
              authType: 'local',
              otp,
              otpExpires: this.otpExpiry(),
              otpAttempts: 0,
              acceptedTermsAt: now,
              acceptedPrivacyAt: now,
              yearsOfExperience: dto.yearsOfExperience,
              hourlyRate: dto.hourlyRate,
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

          await transaction.userService.createMany({
            data: serviceIds.map((serviceId) => ({
              userId: user.id,
              serviceId,
              hourlyRate: dto.hourlyRate,
            })),
          });
          await transaction.userAvailability.createMany({
            data: dto.availability.map((slot) => ({
              userId: user.id,
              date: this.dateOnly(slot.date),
              startTime: slot.startTime,
              endTime: slot.endTime,
            })),
          });

          return {
            user,
            tokens: await this.tokens.issue(user, metadata, transaction),
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
          user: serializeUser(result.user),
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

      return success({ user: serializeUser(user) }, 'Administrator account created successfully.');
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

  private async createUserWithTokens(
    data: Prisma.UserUncheckedCreateInput,
    metadata: SessionMetadata,
  ): Promise<{ user: User; tokens: AuthTokens }> {
    try {
      return await this.repository.transaction(async (transaction: Prisma.TransactionClient) => {
        await this.assertEmailAvailable(String(data.email), transaction);
        const user = await this.repository.createUser(data, transaction);
        return { user, tokens: await this.tokens.issue(user, metadata, transaction) };
      });
    } catch (error) {
      this.rethrowUniqueEmail(error);
      throw error;
    }
  }

  private validateTaskerAvailability(dto: RegisterTaskerDto): void {
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
