import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), 'src');
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

describe('tasker suspension appeal exposes a reason and a way to submit it without a session', () => {
  const authRole = read('modules/auth/services/auth-role.service.ts');
  const supportConstants = read('modules/support/support.constants.ts');
  const supportService = read('modules/support/support.service.ts');
  const appealsController = read('modules/support/support-appeals.controller.ts');
  const supportModule = read('modules/support/support.module.ts');
  const supportDto = read('modules/support/dto/support.dto.ts');

  it('includes profile.statusReason in the TASKER_PROFILE_INACTIVE login error', () => {
    expect(authRole).toContain("code: 'TASKER_PROFILE_INACTIVE'");
    expect(authRole).toMatch(
      /code: 'TASKER_PROFILE_INACTIVE',[\s\S]*?statusReason: profile\.statusReason,/,
    );
  });

  it('adds appeal as a valid support ticket category', () => {
    expect(supportConstants).toMatch(/SUPPORT_CATEGORIES = \[[\s\S]*?'appeal'[\s\S]*?\]/);
  });

  it('exposes an unauthenticated appeal submission endpoint', () => {
    expect(appealsController).toContain("@Controller('support/appeals')");
    expect(appealsController).not.toContain('@UseGuards');
    expect(appealsController).not.toContain('JwtAuthGuard');
    expect(supportModule).toContain('SupportAppealsController');
  });

  it('verifies credentials and requires the account to actually be inactive before creating the ticket', () => {
    expect(supportService).toContain('async createAppeal(dto: CreateAppealDto)');
    expect(supportService).toContain('compare(');
    expect(supportService).toMatch(/if \(!user\?\.password \|\| !passwordMatches\)/);
    expect(supportService).toContain("category: 'appeal'");
    expect(supportService).toMatch(/if \(!isInactive\)/);
  });

  it('CreateAppealDto requires email, password, and a message', () => {
    expect(supportDto).toContain('export class CreateAppealDto');
    expect(supportDto).toMatch(/class CreateAppealDto[\s\S]*?email!: string/);
    expect(supportDto).toMatch(/class CreateAppealDto[\s\S]*?password!: string/);
    expect(supportDto).toMatch(/class CreateAppealDto[\s\S]*?message!: string/);
  });
});

describe('admin booking reassign action', () => {
  const dto = read('modules/admin-dashboard/dto/admin-bookings.dto.ts');
  const service = read('modules/admin-dashboard/services/admin-bookings.service.ts');
  const controller = read('modules/admin-dashboard/controllers/admin-bookings.controller.ts');

  it('DTO accepts reassign with an optional reason and a newTaskerId', () => {
    expect(dto).toContain("@IsIn(['cancel', 'reassign'])");
    expect(dto).toContain("action!: 'cancel' | 'reassign'");
    expect(dto).toContain('newTaskerId?: number');
    expect(dto).toMatch(/reason\?: string/);
  });

  it('routes the reassign action to a dedicated handler', () => {
    expect(service).toContain("if (dto.action === 'reassign') return this.reassign(actor, id, dto);");
    expect(service).toContain('private async reassign(actor: User, id: number, dto: AdminBookingActionDto)');
  });

  it('reuses the same non-paid/non-disputed guard style as cancel', () => {
    const reassignBody = service.slice(service.indexOf('private async reassign('));
    expect(reassignBody).toContain('complaints.length > 0');
    expect(reassignBody).toMatch(
      /\['pending', 'confirmed', 'en_route', 'arrived'\]\.includes\(booking\.status\)/,
    );
    expect(reassignBody).toContain('PAYMENT_STATUS.Paid');
    expect(reassignBody).toContain('PAYMENT_STATUS.PartiallyRefunded');
    expect(reassignBody).toContain('PAYMENT_STATUS.Refunded');
  });

  it('only allows handing off to an active, approved tasker, and resets status to pending', () => {
    const reassignBody = service.slice(service.indexOf('private async reassign('));
    expect(reassignBody).toContain("roles: { has: UserRole.Tasker }");
    expect(reassignBody).toContain("accountStatus: 'active'");
    expect(reassignBody).toContain("onboardingStatus: 'approved'");
    expect(reassignBody).toContain("taskerProfile: { is: { status: 'active' } }");
    expect(reassignBody).toContain("status: 'pending'");
    expect(reassignBody).toContain('newTaskerId === booking.taskerId');
  });

  it('notifies the outgoing tasker, the new tasker, and the customer', () => {
    const reassignBody = service.slice(service.indexOf('private async reassign('));
    const notifyCalls = reassignBody.match(/this\.notifications\.create\(/g) ?? [];
    expect(notifyCalls.length).toBeGreaterThanOrEqual(3);
    expect(reassignBody).toMatch(/this\.notifications\.create\(\s*previousTaskerId,/);
    expect(reassignBody).toMatch(/this\.notifications\.create\(\s*newTaskerId,/);
    expect(reassignBody).toMatch(/this\.notifications\.create\(\s*booking\.customerId,/);
  });

  it('documents reassign in the endpoint Swagger examples', () => {
    expect(controller).toContain("action: 'reassign'");
    expect(controller).toContain('newTaskerId: 57');
  });
});
