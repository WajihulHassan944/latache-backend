import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { UpdateLocationDto } from '../../../common/dto/update-location.dto';
import type { UserRole } from '../../../common/enums/user-role.enum';
import { serializeUser, type PublicUser } from '../../../common/utils/user.util';
import { success, type SuccessEnvelope } from '../auth-response';
import type { UpdateProfileDto } from '../dto';
import { AuthRepository } from '../repositories/auth.repository';
import { LocaleService } from '../../localization/locale.service';
import { AuthRoleService } from './auth-role.service';

@Injectable()
export class AuthProfileService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly locales: LocaleService,
    private readonly roles: AuthRoleService,
  ) {}

  async me(
    userId: number,
    activeRole?: UserRole,
  ): Promise<SuccessEnvelope<{ user: PublicUser; profiles: unknown }>> {
    const user = await this.repository.findUserById(userId);
    if (!user || user.deletedAt) throw new UnauthorizedException('Account not found');
    const profiles = await this.roles.profileStates(userId);
    return success(
      { user: serializeUser(user, activeRole), profiles },
      'Authenticated profile retrieved.',
    );
  }

  async update(
    userId: number,
    dto: UpdateProfileDto,
    activeRole?: UserRole,
  ): Promise<SuccessEnvelope<{ user: PublicUser }>> {
    if (dto.preferredLanguage !== undefined) {
      dto.preferredLanguage = this.locales.requireSupported(dto.preferredLanguage);
    }
    const user = await this.repository.updateUser(userId, dto);
    return success({ user: serializeUser(user, activeRole) }, 'Profile updated successfully.');
  }

  /**
   * Explicit Customer location save. Kept separate from update() so
   * latitude/longitude only ever change through this dedicated call, never
   * as a side effect of a general profile edit or of GET /api/taskers
   * merely being called with lat/lng.
   */
  async updateLocation(
    userId: number,
    dto: UpdateLocationDto,
    activeRole?: UserRole,
  ): Promise<SuccessEnvelope<{ user: PublicUser }>> {
    const user = await this.repository.updateUser(userId, {
      latitude: dto.latitude,
      longitude: dto.longitude,
      locationUpdatedAt: new Date(),
    });
    return success({ user: serializeUser(user, activeRole) }, 'Location saved successfully.');
  }
}
