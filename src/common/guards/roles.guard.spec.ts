import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AllowPendingProfile, Roles } from '../decorators/roles.decorator';
import { UserRole } from '../enums/user-role.enum';
import { RolesGuard } from './roles.guard';

class OperationalOnly {
  @Roles(UserRole.Tasker)
  handler() {}
}

class DepositLike {
  @Roles(UserRole.Tasker)
  @AllowPendingProfile()
  handler() {}
}

const context = (target: { prototype: { handler: () => void } }, role: UserRole) =>
  ({
    getHandler: () => target.prototype.handler,
    getClass: () => target,
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 1 }, auth: { role } }) }),
  }) as unknown as ExecutionContext;

describe('RolesGuard pending profiles', () => {
  const pending = { assertOperational: jest.fn().mockRejectedValue(new ForbiddenException('Tasker profile is pending_approval.')) };
  const guard = new RolesGuard(new Reflector(), pending as never);

  it('blocks a pending Tasker on normal single-role routes', async () => {
    await expect(guard.canActivate(context(OperationalOnly, UserRole.Tasker))).rejects.toThrow(ForbiddenException);
  });

  it('lets a pending Tasker reach a route marked AllowPendingProfile (signup deposit)', async () => {
    await expect(guard.canActivate(context(DepositLike, UserRole.Tasker))).resolves.toBe(true);
  });

  it('still rejects the wrong role on that route', async () => {
    await expect(guard.canActivate(context(DepositLike, UserRole.Customer))).rejects.toThrow(ForbiddenException);
  });
});
