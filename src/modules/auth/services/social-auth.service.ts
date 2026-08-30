import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { compare } from 'bcryptjs';
import { AdminAuditService } from '../../admin-audit/admin-audit.service';
import { LocaleService } from '../../localization/locale.service';
import { AccountStatus } from '../../../common/enums/account-status.enum';
import { UserRole } from '../../../common/enums/user-role.enum';
import { normalizeRoleMembership, userRoles } from '../../../common/utils/user-role.util';
import { serializeUser } from '../../../common/utils/user.util';
import { PrismaService } from '../../../database/prisma.service';
import type { Prisma, User } from '../../../generated/prisma/client';
import { success } from '../auth-response';
import type { LinkSocialAuthDto, SocialAuthDto } from '../dto/social-auth.dto';
import type { SocialAuthProvider } from '../social-auth.constants';
import { AuthSessionsRepository } from '../repositories/auth-sessions.repository';
import { AuthRoleService } from './auth-role.service';
import { AuthTokenService, type SessionMetadata } from './auth-token.service';
import { SocialAuthProviderService, type VerifiedSocialIdentity } from './social-auth-provider.service';

@Injectable()
export class SocialAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: SocialAuthProviderService,
    private readonly tokens: AuthTokenService,
    private readonly roles: AuthRoleService,
    private readonly locales: LocaleService,
    private readonly audit: AdminAuditService,
    private readonly sessions: AuthSessionsRepository,
  ) {}

  async authenticate(provider: SocialAuthProvider, dto: SocialAuthDto, metadata: SessionMetadata) {
    const verified = await this.providers.verify(provider, dto.idToken, dto.nonce);
    const result = await this.prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
      await this.lock(transaction, `social:${provider}:${verified.subject}`);
      await this.lock(transaction, `auth-email:${verified.email}`);

      let identity = await transaction.socialAuthIdentity.findFirst({
        where: { provider, providerSubject: verified.subject },
      });
      let user: User | null = identity
        ? await transaction.user.findUnique({ where: { id: identity.userId } })
        : null;
      let created = false;
      let linked = Boolean(identity);

      if (!user && identity) throw new ForbiddenException('Linked Latache account is unavailable');

      if (!user) {
        user = await transaction.user.findFirst({
          where: { email: { equals: verified.email, mode: 'insensitive' } },
        });
        if (user && this.isAdministrative(user)) {
          throw new ForbiddenException('Google and Apple sign-in are not enabled for Admin accounts');
        }
        if (user) this.assertIdentityUsable(user);
        if (user && !verified.emailAuthoritative) {
          throw new ConflictException({
            code: 'SOCIAL_ACCOUNT_LINK_REQUIRED',
            message:
              'This email already belongs to a Latache account. Sign in with an existing Latache method, then link this provider from the authenticated account.',
            provider,
          });
        }

        if (!user) {
          if (dto.acceptedTermsAndPrivacyPolicy !== true) {
            throw new BadRequestException({
              code: 'TERMS_ACCEPTANCE_REQUIRED',
              message: 'Terms and Privacy acceptance is required to create a Latache account.',
            });
          }
          const preferredLanguage = dto.preferredLanguage
            ? this.locales.requireSupported(dto.preferredLanguage)
            : null;
          const now = new Date();
          user = await transaction.user.create({
            data: {
              firstName: dto.firstName ?? verified.firstName ?? '',
              lastName: dto.lastName ?? verified.lastName ?? '',
              email: verified.email,
              phoneCountryCode: dto.phoneCountryCode ?? '',
              phoneNumber: dto.phoneNumber ?? '',
              zipCode: dto.zipCode ?? '',
              preferredLanguage,
              password: null,
              role: UserRole.Customer,
              roles: [UserRole.Customer],
              accountStatus: AccountStatus.Active,
              isVerified: true,
              isAdmin: false,
              authType: provider,
              acceptedTermsAt: now,
              acceptedPrivacyAt: now,
            },
          });
          await transaction.customerProfile.create({
            data: { userId: user.id, status: AccountStatus.Active, activatedAt: now },
          });
          created = true;
        } else if (!user.isVerified) {
          user = await transaction.user.update({
            where: { id: user.id },
            data: {
              isVerified: true,
              accountStatus: AccountStatus.Active,
              otp: null,
              otpHash: null,
              otpExpires: null,
              otpAttempts: 0,
            },
          });
        }

        identity = await transaction.socialAuthIdentity.create({
          data: this.identityCreateData(user.id, verified),
        });
        linked = true;
        await this.audit.record(
          {
            actorId: user.id,
            targetUserId: user.id,
            action: created ? 'social_identity_registered' : 'social_identity_linked',
            entityType: 'social_auth_identity',
            entityId: identity.id,
            metadata: { provider, providerEmail: verified.email, privateEmail: verified.isPrivateEmail },
          },
          transaction,
        );
      }

      this.assertIdentityUsable(user);
      user = await this.ensureRequestedCustomerRole(user, dto, transaction);

      const available = userRoles(user).filter(
        (role) => role === UserRole.Customer || role === UserRole.Tasker,
      );
      let selectedRole: UserRole.Customer | UserRole.Tasker;
      let taskerEnrollmentRequired = false;

      if (dto.role === UserRole.Tasker && !available.includes(UserRole.Tasker)) {
        if (!available.includes(UserRole.Customer)) {
          throw new ForbiddenException('Tasker onboarding requires an active marketplace identity');
        }
        selectedRole = UserRole.Customer;
        taskerEnrollmentRequired = true;
      } else if (dto.role) {
        selectedRole = dto.role;
      } else if (available.length === 1) {
        selectedRole = available[0] as UserRole.Customer | UserRole.Tasker;
      } else if (available.length > 1) {
        throw new BadRequestException({
          code: 'ROLE_SELECTION_REQUIRED',
          message: 'Select customer or tasker for this social login.',
          availableRoles: available,
        });
      } else {
        throw new ForbiddenException('This account has no marketplace role');
      }

      await this.roles.assertSelectable(user, selectedRole, transaction);
      const now = new Date();
      await transaction.socialAuthIdentity.update({
        where: { id: identity!.id },
        data: {
          providerEmail: verified.email,
          emailVerified: verified.emailVerified,
          isPrivateEmail: verified.isPrivateEmail,
          providerClientId: verified.clientId,
          lastLoginAt: now,
        },
      });
      user = await transaction.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
      const tokens = await this.tokens.issue(user, metadata, transaction, selectedRole);
      return { user, tokens, selectedRole, created, linked, taskerEnrollmentRequired };
    });

    return success(
      {
        user: serializeUser(result.user, result.selectedRole),
        tokens: result.tokens,
        provider,
        accountCreated: result.created,
        providerLinked: result.linked,
        taskerEnrollmentRequired: result.taskerEnrollmentRequired,
        nextAction: result.taskerEnrollmentRequired ? 'POST /api/auth/roles/tasker' : null,
      },
      result.created ? `${provider} signup successful.` : `${provider} login successful.`,
    );
  }

  async link(userId: number, provider: SocialAuthProvider, dto: LinkSocialAuthDto) {
    await this.assertLinkReauthentication(userId, dto);
    const verified = await this.providers.verify(provider, dto.idToken, dto.nonce);
    const result = await this.prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
      await this.lock(transaction, `social:${provider}:${verified.subject}`);
      await this.lock(transaction, `social-user-provider:${userId}:${provider}`);
      const user = await transaction.user.findUnique({ where: { id: userId } });
      if (!user || user.deletedAt) throw new NotFoundException('Account not found');
      this.assertIdentityUsable(user);
      if (this.isAdministrative(user)) {
        throw new ForbiddenException('Google and Apple linking is not enabled for Admin accounts');
      }
      const bySubject = await transaction.socialAuthIdentity.findFirst({
        where: { provider, providerSubject: verified.subject },
      });
      if (bySubject && bySubject.userId !== user.id) {
        throw new ConflictException({
          code: 'SOCIAL_IDENTITY_ALREADY_LINKED',
          message: 'This provider account is already linked to another Latache identity.',
        });
      }
      const existing = await transaction.socialAuthIdentity.findFirst({
        where: { provider, userId: user.id },
      });
      if (existing && existing.providerSubject !== verified.subject) {
        throw new ConflictException({
          code: 'SOCIAL_PROVIDER_ALREADY_LINKED',
          message: `A different ${provider} account is already linked to this Latache identity.`,
        });
      }
      const identity = existing
        ? await transaction.socialAuthIdentity.update({
            where: { id: existing.id },
            data: this.identityUpdateData(verified),
          })
        : await transaction.socialAuthIdentity.create({
            data: this.identityCreateData(user.id, verified),
          });
      await this.audit.record(
        {
          actorId: user.id,
          targetUserId: user.id,
          action: existing ? 'social_identity_reverified' : 'social_identity_linked',
          entityType: 'social_auth_identity',
          entityId: identity.id,
          metadata: { provider, providerEmail: verified.email, privateEmail: verified.isPrivateEmail },
        },
        transaction,
      );
      return identity;
    });
    return success(
      { provider, linked: true, providerEmail: result.providerEmail, isPrivateEmail: result.isPrivateEmail },
      `${provider} account linked successfully.`,
    );
  }

  async unlink(userId: number, provider: SocialAuthProvider) {
    await this.prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
      await this.lock(transaction, `social-user-provider:${userId}:${provider}`);
      const user = await transaction.user.findUnique({ where: { id: userId } });
      if (!user || user.deletedAt) throw new NotFoundException('Account not found');
      this.assertIdentityUsable(user);
      const identities = await transaction.socialAuthIdentity.findMany({ where: { userId } });
      const target = identities.find((identity) => identity.provider === provider);
      if (!target) throw new NotFoundException(`${provider} is not linked to this account`);
      if (!user.password && identities.length <= 1) {
        throw new ConflictException({
          code: 'AUTH_METHOD_REQUIRED',
          message: 'Set a password or link another provider before removing the last sign-in method.',
        });
      }
      await transaction.socialAuthIdentity.delete({ where: { id: target.id } });
      await this.sessions.revokeAll(user.id, transaction);
      await this.audit.record(
        {
          actorId: user.id,
          targetUserId: user.id,
          action: 'social_identity_unlinked',
          entityType: 'social_auth_identity',
          entityId: target.id,
          metadata: { provider },
        },
        transaction,
      );
    });
    return success(
      { provider, linked: false, sessionsRevoked: true },
      `${provider} account unlinked successfully. Sign in again on your devices.`,
    );
  }

  private async assertLinkReauthentication(userId: number, dto: LinkSocialAuthDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new NotFoundException('Account not found');
    this.assertIdentityUsable(user);

    if (user.password && dto.currentPassword && (await compare(dto.currentPassword, user.password))) {
      return;
    }

    if (dto.reauthProvider && dto.reauthIdToken) {
      await this.verifyLinkedReauthentication(
        userId,
        dto.reauthProvider,
        dto.reauthIdToken,
        dto.reauthNonce,
      );
      return;
    }

    throw new ForbiddenException({
      code: 'AUTH_STEP_UP_REQUIRED',
      message:
        'Reauthenticate with the current Latache password or an already-linked social provider before linking a new sign-in provider.',
    });
  }

  async verifyLinkedReauthentication(
    userId: number,
    provider: SocialAuthProvider,
    idToken: string,
    nonce?: string,
  ): Promise<void> {
    const verified = await this.providers.verify(provider, idToken, nonce);
    await this.prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
      await this.lock(transaction, `social:${provider}:${verified.subject}`);
      const user = await transaction.user.findUnique({ where: { id: userId } });
      if (!user || user.deletedAt) throw new NotFoundException('Account not found');
      this.assertIdentityUsable(user);
      const identity = await transaction.socialAuthIdentity.findFirst({
        where: {
          userId,
          provider,
          providerSubject: verified.subject,
        },
      });
      if (!identity) {
        throw new ForbiddenException({
          code: 'SOCIAL_REAUTHENTICATION_REQUIRED',
          message: 'Reauthenticate with an already-linked social provider before continuing.',
        });
      }
      await transaction.socialAuthIdentity.update({
        where: { id: identity.id },
        data: {
          providerEmail: verified.email,
          emailVerified: verified.emailVerified,
          isPrivateEmail: verified.isPrivateEmail,
          providerClientId: verified.clientId,
          lastLoginAt: new Date(),
        },
      });
    });
  }

  async methods(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new NotFoundException('Account not found');
    const identities = await this.prisma.socialAuthIdentity.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        provider: true,
        providerEmail: true,
        emailVerified: true,
        isPrivateEmail: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });
    const localPasswordEnabled = Boolean(user.password);
    const totalMethods = identities.length + (localPasswordEnabled ? 1 : 0);
    return success(
      {
        localPasswordEnabled,
        canSetPassword: !localPasswordEnabled,
        providers: identities.map((identity) => ({
          ...identity,
          canUnlink: totalMethods > 1,
        })),
      },
      'Authentication methods retrieved.',
    );
  }

  private async ensureRequestedCustomerRole(
    user: User,
    dto: SocialAuthDto,
    transaction: Prisma.TransactionClient,
  ): Promise<User> {
    if (dto.role !== UserRole.Customer || userRoles(user).includes(UserRole.Customer)) return user;
    if (dto.acceptedTermsAndPrivacyPolicy !== true) {
      throw new BadRequestException({
        code: 'TERMS_ACCEPTANCE_REQUIRED',
        message: 'Terms and Privacy acceptance is required to enable Customer access.',
      });
    }
    const now = new Date();
    await transaction.customerProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, status: AccountStatus.Active, activatedAt: now },
      update: { status: AccountStatus.Active, deactivatedAt: null, suspendedAt: null },
    });
    return transaction.user.update({
      where: { id: user.id },
      data: {
        roles: { set: normalizeRoleMembership(userRoles(user), UserRole.Customer) },
        acceptedTermsAt: user.acceptedTermsAt ?? now,
        acceptedPrivacyAt: user.acceptedPrivacyAt ?? now,
      },
    });
  }

  private assertIdentityUsable(user: User): void {
    if (this.isAdministrative(user)) {
      throw new ForbiddenException('Google and Apple sign-in are not enabled for Admin accounts');
    }
    if (user.deletedAt || user.accountStatus === AccountStatus.Deactivated) {
      throw new ForbiddenException('This account is deactivated');
    }
    if (user.accountStatus === AccountStatus.Suspended) {
      throw new ForbiddenException('This account is suspended');
    }
  }

  private isAdministrative(user: User): boolean {
    const roles = userRoles(user);
    return roles.includes(UserRole.Admin) || roles.includes(UserRole.SuperAdmin);
  }

  private identityCreateData(userId: number, verified: VerifiedSocialIdentity) {
    return {
      userId,
      provider: verified.provider,
      providerSubject: verified.subject,
      providerEmail: verified.email,
      emailVerified: verified.emailVerified,
      isPrivateEmail: verified.isPrivateEmail,
      providerClientId: verified.clientId,
      lastLoginAt: new Date(),
    };
  }

  private identityUpdateData(verified: VerifiedSocialIdentity) {
    return {
      providerEmail: verified.email,
      emailVerified: verified.emailVerified,
      isPrivateEmail: verified.isPrivateEmail,
      providerClientId: verified.clientId,
      lastLoginAt: new Date(),
    };
  }

  private lock(transaction: Prisma.TransactionClient, key: string): Promise<number> {
    return transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }
}
