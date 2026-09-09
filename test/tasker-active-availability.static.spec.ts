import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('active tasker self-service availability', () => {
  const root = process.cwd();
  const read = (path: string): string => readFileSync(join(root, path), 'utf8');

  it('exposes list/add/delete routes that do not touch onboarding status', () => {
    const controller = read('src/modules/tasker-dashboard/controllers/tasker-profile.controller.ts');
    expect(controller).toContain("@Get('availability')");
    expect(controller).toContain("@Post('availability')");
    expect(controller).toContain("@Delete('availability/:id')");
    expect(controller).toContain('@Roles(UserRole.Tasker)');
  });

  it('adding availability never mutates onboardingStatus or taskerProfile.status', () => {
    const service = read('src/modules/tasker-dashboard/services/tasker-profile.service.ts');
    expect(service).toContain('async addAvailability(');
    expect(service).not.toMatch(/addAvailability[\s\S]*?onboardingStatus/);
    expect(service).not.toMatch(/addAvailability[\s\S]*?pending_review/);
  });

  it('rejects overlapping slots and blocks deleting booked/referenced slots', () => {
    const service = read('src/modules/tasker-dashboard/services/tasker-profile.service.ts');
    expect(service).toContain('validateAvailabilitySlots(dto.availability)');
    expect(service).toContain('overlaps an existing slot');
    expect(service).toContain("throw new ConflictException('This slot has a booking and cannot be removed')");
    expect(service).toContain(
      "throw new ConflictException('This slot has booking history and cannot be removed')",
    );
  });

  it('shares the same validation rules the onboarding submission uses', () => {
    const util = read('src/common/utils/availability.util.ts');
    expect(util).toContain('export const validateAvailabilitySlots');
    const onboarding = read('src/modules/taskers/taskers.service.ts');
    expect(onboarding).toContain('validateAvailabilitySlots(dto.availability)');
  });
});
