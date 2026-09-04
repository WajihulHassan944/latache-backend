import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SERVICE_ICON_OPTIONS, SERVICE_ICON_VALUES } from './service-icon.constant';

describe('SERVICE_ICON_OPTIONS', () => {
  it('has no duplicate values', () => {
    expect(new Set(SERVICE_ICON_VALUES).size).toBe(SERVICE_ICON_VALUES.length);
  });

  it('gives every option a non-empty label', () => {
    for (const option of SERVICE_ICON_OPTIONS) {
      expect(option.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('covers every icon already used by the seeded catalogue, so existing services always validate', () => {
    const seed = readFileSync(join(process.cwd(), 'prisma/seed.ts'), 'utf8');
    const seededIcons = [...seed.matchAll(/icon:\s*'([^']+)'/g)].map((match) => match[1]);
    expect(seededIcons.length).toBeGreaterThan(0);
    for (const icon of seededIcons) {
      expect(SERVICE_ICON_VALUES).toContain(icon);
    }
  });
});
