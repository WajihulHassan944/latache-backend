import { Injectable, UnauthorizedException } from '@nestjs/common';
import { serializeUser, type PublicUser } from '../../../common/utils/user.util';
import { success, type SuccessEnvelope } from '../auth-response';
import type { UpdateProfileDto } from '../dto';
import { AuthRepository } from '../repositories/auth.repository';

@Injectable()
export class AuthProfileService {
  constructor(private readonly repository: AuthRepository) {}

  async me(userId: number): Promise<SuccessEnvelope<{ user: PublicUser }>> {
    const user = await this.repository.findUserById(userId);
    if (!user || user.deletedAt) throw new UnauthorizedException('Account not found');
    return success({ user: serializeUser(user) }, 'Authenticated profile retrieved.');
  }

  async update(
    userId: number,
    dto: UpdateProfileDto,
  ): Promise<SuccessEnvelope<{ user: PublicUser }>> {
    const user = await this.repository.updateUser(userId, dto);
    return success({ user: serializeUser(user) }, 'Profile updated successfully.');
  }
}
