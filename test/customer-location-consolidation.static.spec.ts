import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Customer location consolidated onto default saved address', () => {
  const root = process.cwd();
  const read = (path: string): string => readFileSync(join(root, path), 'utf8');

  it('removes PATCH /auth/me/location entirely', () => {
    const controller = read('src/modules/auth/auth.controller.ts');
    expect(controller).not.toContain("@Patch('me/location')");
    expect(controller).not.toContain('updateMyLocation');
    const service = read('src/modules/auth/auth.service.ts');
    expect(service).not.toContain('updateMyLocation');
    const profileService = read('src/modules/auth/services/auth-profile.service.ts');
    expect(profileService).not.toContain('updateLocation');
  });

  it('guards against the route ever coming back unnoticed', () => {
    const spec = read('src/modules/auth/auth.swagger.spec.ts');
    expect(spec).toContain("'me/location'");
    expect(spec).not.toContain('updateMyLocation');
  });

  it('leaves the Guest location endpoint untouched', () => {
    const guestController = read('src/modules/guest/guest.controller.ts');
    expect(guestController).toContain("@Patch('location')");
    expect(guestController).toContain('updateLocation');
  });

  it('GET /api/taskers falls back to the Customer default saved address, not User.latitude/longitude', () => {
    const controller = read('src/modules/taskers/taskers.controller.ts');
    expect(controller).toContain('this.addresses.getDefaultLocation(request.user.id)');
    const addressesService = read('src/modules/addresses/addresses.service.ts');
    expect(addressesService).toContain('async getDefaultLocation(');
    expect(addressesService).toContain('isDefault: true');
  });

  it('Admin near-customer search filters on the default saved address', () => {
    const adminService = read('src/modules/admin-dashboard/services/admin-customers.service.ts');
    expect(adminService).toContain('savedAddresses: {');
    expect(adminService).toMatch(/savedAddresses[\s\S]*?isDefault: true/);
  });
});
