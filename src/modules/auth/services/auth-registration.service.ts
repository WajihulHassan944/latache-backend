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
import { MailService } from '../../mail/mail.service';
import { success, type SuccessEnvelope } from '../auth-response';
import { ADMIN_PERMISSIONS, permissionsForAdminRole } from '../constants/admin-permissions';
import type { CreateAdminDto, RegisterCustomerDto, RegisterTaskerDto } from '../dto';
import { AuthRepository } from '../repositories/auth.repository';
import { AuthTokenService, type AuthTokens, type SessionMetadata } from './auth-token.service';

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
  ) {}

  async registerCustomer(
    dto: RegisterCustomerDto,
    metadata: SessionMetadata,
  ): Promise<SuccessEnvelope<RegistrationData>> {
    this.assertConsent(dto.acceptedTermsAndPrivacyPolicy);
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
      },
      metadata,
    );

    await this.mail.sendVerificationEmail({
      to: result.user.email,
      name: dto.firstName,
      otp,
      device: metadata.device,
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
  ): Promise<SuccessEnvelope<RegistrationData>> {
    this.assertConsent(dto.acceptedTermsAndPrivacyPolicy);
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
      const result = await this.repository.transaction(async (transaction: Prisma.TransactionClient) => {
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
      });

      await this.mail.sendVerificationEmail({
        to: result.user.email,
        name: dto.firstName,
        otp,
        device: metadata.device,
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
    if (actor.role !== UserRole.SuperAdmin) {
      throw new ForbiddenException('Only the super administrator can create admins');
    }
    if (dto.adminRole === AdminRole.SuperAdmin) {
      throw new BadRequestException('Additional super administrators cannot be created');
    }

    if (
      dto.adminRole === AdminRole.CustomAdmin &&
      (!dto.permissions || dto.permissions.length === 0)
    ) {
      throw new BadRequestException(
        'permissions must contain at least one permission for custom_admin',
      );
    }

    const permissionCatalog = new Set<string>(ADMIN_PERMISSIONS);
    const invalidPermissions = (dto.permissions ?? []).filter(
      (permission) => !permissionCatalog.has(permission),
    );
    if (invalidPermissions.length > 0) {
      throw new BadRequestException(`Unknown permissions: ${invalidPermissions.join(', ')}`);
    }

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
        adminRole: dto.adminRole,
        permissions: permissionsForAdminRole(dto.adminRole, dto.permissions),
        mustChangePassword: true,
        isVerified: true,
        isAdmin: true,
        authType: 'local',
        createdById: actor.id,
      });

      await this.mail.sendAdminWelcomeEmail({
        to: user.email,
        name: user.firstName || user.email,
        temporaryPassword: dto.password,
        adminRole: dto.adminRole,
      });

      return success({ user: serializeUser(user) }, 'Administrator account created successfully.');
    } catch (error) {
      this.rethrowUniqueEmail(error);
      throw error;
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

    const byDate = new Map<
      string,
      Array<{ startTime: string; endTime: string }>
    >();

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
          throw new BadRequestException(
            `Availability slots overlap on ${date}`,
          );
        }
      }
    }
  }

  private assertConsent(accepted: boolean): void {
    if (!accepted) {
      throw new BadRequestException(
        'Terms and Conditions and Privacy Policy must be accepted',
      );
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
