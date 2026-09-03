import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from 'bcryptjs';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  DEFAULT_ADMIN_PERMISSIONS,
  SYSTEM_RBAC_ROLES,
} from '../src/modules/rbac/constants/permission-catalog';
import { AccountStatus } from '../src/common/enums/account-status.enum';
import { AdminRole } from '../src/common/enums/admin-role.enum';
import { UserRole } from '../src/common/enums/user-role.enum';
import { normalizeSearchText } from '../src/modules/localization/locale.service';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required to seed the database');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const productionLike = ['staging', 'production'].includes(
  (process.env.NODE_ENV ?? 'development').trim().toLowerCase(),
);

const services = [
  {
    name: 'Electrician',
    description: 'Wiring, fixtures and installations',
    slug: 'electrician',
    icon: 'Zap',
  },
  {
    name: 'Plumbing',
    description: 'Leaks, drains and pipe repairs',
    slug: 'plumbing',
    icon: 'Droplets',
  },
  {
    name: 'Painter',
    description: 'Interior and exterior wall perfection',
    slug: 'painter',
    icon: 'Paintbrush',
  },
  {
    name: 'Carpentry',
    description: 'Custom furniture and repair',
    slug: 'carpentry',
    icon: 'Hammer',
  },
  {
    name: 'Moving Help',
    description: 'Pack, lift and transport',
    slug: 'moving-help',
    icon: 'Truck',
  },
  {
    name: 'Gardening',
    description: 'Landscape and maintenance',
    slug: 'gardening',
    icon: 'Sprout',
  },
  {
    name: 'General Repair',
    description: 'Quick fixes for home issues',
    slug: 'general-repair',
    icon: 'Wrench',
  },
  {
    name: 'Cleaning',
    description: 'Home and office cleaning services',
    slug: 'cleaning',
    icon: 'Sparkles',
  },
  {
    name: 'Handyman',
    description: 'General fixes and multi-skill home tasks',
    slug: 'handyman',
    icon: 'FileText',
  },
] as const;

const seedSeo = async (): Promise<void> => {
  await prisma.seoSettings.upsert({
    where: { id: 'global' },
    create: { id: 'global', siteName: 'Latache', defaultTitle: 'Latache', defaultDescription: 'Find trusted local taskers and services with Latache.' },
    update: {},
  });
};

const seedServices = async (): Promise<void> => {
  for (const service of services) {
    const existing = await prisma.service.findFirst({ where: { slug: service.slug } });
    const row = existing
      ? await prisma.service.update({
          where: { id: existing.id },
          data: { ...service, updatedAt: new Date() },
        })
      : await prisma.service.create({
          data: { ...service, createdAt: new Date(), updatedAt: new Date() },
        });
    await prisma.serviceTranslation.upsert({
      where: { serviceId_locale: { serviceId: row.id, locale: 'en' } },
      create: {
        serviceId: row.id,
        locale: 'en',
        name: service.name,
        description: service.description,
        normalizedName: normalizeSearchText(service.name),
        normalizedDescription: normalizeSearchText(service.description),
      },
      update: {
        name: service.name,
        description: service.description,
        normalizedName: normalizeSearchText(service.name),
        normalizedDescription: normalizeSearchText(service.description),
      },
    });
  }
};

const seedRbacRoles = async (): Promise<Map<string, string>> => {
  const roleIds = new Map<string, string>();

  for (const definition of SYSTEM_RBAC_ROLES) {
    const role = await prisma.rbacRole.upsert({
      where: { code: definition.code },
      create: {
        code: definition.code,
        name: definition.name,
        description: definition.description,
        permissions: [...definition.permissions],
        isSystem: true,
        isActive: true,
      },
      update: {
        name: definition.name,
        description: definition.description,
        ...(definition.code === AdminRole.SuperAdmin
          ? { permissions: [...definition.permissions] }
          : {}),
        isSystem: true,
        isActive: true,
        deletedAt: null,
      },
    });
    roleIds.set(role.code, role.id);

    await prisma.user.updateMany({
      where: {
        adminRole: role.code,
        rbacRoleId: null,
      },
      data: { rbacRoleId: role.id },
    });
  }

  return roleIds;
};

const seedSuperAdmin = async (roleIds: Map<string, string>): Promise<void> => {
  const configuredEmail = process.env.SUPERADMIN_EMAIL?.trim();
  const configuredPassword = process.env.SUPERADMIN_PASSWORD;
  if (productionLike && (!configuredEmail || !configuredPassword)) {
    throw new Error('SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD are required to seed production');
  }
  const email = (configuredEmail ?? 'latache.superadmin@yopmail.com').toLowerCase();
  const password = configuredPassword ?? 'Admin@12345';
  if (
    productionLike &&
    (email === 'latache.superadmin@yopmail.com' ||
      password === 'Admin@12345' ||
      password.length < 12)
  ) {
    throw new Error(
      'Production Super Admin credentials must be client-owned and use a non-default password of at least 12 characters',
    );
  }
  const passwordHash = await hash(password, Number(process.env.BCRYPT_ROUNDS ?? 12));
  const rotateExistingPassword =
    !productionLike ||
    (process.env.SUPERADMIN_ROTATE_PASSWORD_ON_SEED ?? 'false').toLowerCase() === 'true';
  const superAdminRoleId = roleIds.get(AdminRole.SuperAdmin);
  const customAdminRoleId = roleIds.get(AdminRole.CustomAdmin);
  if (!superAdminRoleId || !customAdminRoleId) {
    throw new Error('RBAC system roles were not seeded correctly');
  }
  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
  });

  const canonicalData = {
    firstName: 'Latache',
    lastName: 'Super Admin',
    email,
    role: UserRole.SuperAdmin,
    roles: [UserRole.SuperAdmin],
    accountStatus: AccountStatus.Active,
    adminRole: AdminRole.SuperAdmin,
    permissions: DEFAULT_ADMIN_PERMISSIONS[AdminRole.SuperAdmin],
    rbacRoleId: superAdminRoleId,
    inheritsRolePermissions: true,
    isVerified: true,
    isAdmin: true,
    authType: 'local',
    deletedAt: null,
  };

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        ...canonicalData,
        ...(rotateExistingPassword
          ? { password: passwordHash, mustChangePassword: productionLike }
          : {}),
      },
    });
  } else {
    await prisma.user.create({
      data: {
        ...canonicalData,
        password: passwordHash,
        mustChangePassword: productionLike,
      },
    });
  }

  // Keep exactly one canonical super administrator.
  await prisma.user.updateMany({
    where: {
      role: UserRole.SuperAdmin,
      email: { not: email },
    },
    data: {
      role: UserRole.Admin,
      roles: [UserRole.Admin],
      adminRole: AdminRole.CustomAdmin,
      permissions: [],
      rbacRoleId: customAdminRoleId,
      inheritsRolePermissions: true,
      accountStatus: AccountStatus.Suspended,
      isAdmin: true,
    },
  });

  console.info(`Super administrator seeded: ${email}`);
};

async function main(): Promise<void> {
  await seedServices();
  await seedSeo();
  const roleIds = await seedRbacRoles();
  await seedSuperAdmin(roleIds);
}

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
