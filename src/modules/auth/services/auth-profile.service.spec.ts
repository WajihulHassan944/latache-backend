import { AuthProfileService } from './auth-profile.service';
import type { AuthRepository } from '../repositories/auth.repository';
import type { LocaleService } from '../../localization/locale.service';
import type { AuthRoleService } from './auth-role.service';

describe('AuthProfileService.updateLocation', () => {
  it('persists both coordinates and stamps locationUpdatedAt, never touching any other profile field', async () => {
    const updateUser = jest.fn().mockResolvedValue({
      id: 12,
      role: 'customer',
      latitude: 33.5731,
      longitude: -7.5898,
      locationUpdatedAt: new Date('2026-09-04T10:00:00.000Z'),
    });
    const repository = { updateUser } as unknown as AuthRepository;
    const service = new AuthProfileService(
      repository,
      {} as LocaleService,
      {} as AuthRoleService,
    );

    const result = await service.updateLocation(12, { latitude: 33.5731, longitude: -7.5898 });

    expect(updateUser).toHaveBeenCalledWith(12, {
      latitude: 33.5731,
      longitude: -7.5898,
      locationUpdatedAt: expect.any(Date),
    });
    expect(result.success).toBe(true);
    expect(result.data.user.latitude).toBe(33.5731);
    expect(result.data.user.longitude).toBe(-7.5898);
  });
});
