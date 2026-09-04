import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TaskersController } from './taskers.controller';

describe('TaskersController.submitOnboarding route guarding', () => {
  it('does not run RolesGuard\'s operational-profile check, since a pending_approval/rejected Tasker must be able to reach this endpoint - that is precisely how the profile becomes active', () => {
    const handler = TaskersController.prototype.submitOnboarding;

    const roles = Reflect.getMetadata(ROLES_KEY, handler) as unknown[] | undefined;
    expect(roles).toBeUndefined();

    const guards = (Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[] | undefined) ?? [];
    expect(guards).not.toContain(RolesGuard);
  });
});
