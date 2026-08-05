import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from 'bcryptjs';
import { PrismaClient } from '../src/generated/prisma/client';
import { DEFAULT_ADMIN_PERMISSIONS } from '../src/modules/auth/constants/admin-permissions';
import { AccountStatus } from '../src/common/enums/account-status.enum';
import { AdminRole } from '../src/common/enums/admin-role.enum';
import { UserRole } from '../src/common/enums/user-role.enum';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required to seed the database');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const services = [
  { name: 'Electrician', description: 'Wiring, fixtures and installations', slug: 'electrician', icon: 'Zap' },
  { name: 'Plumbing', description: 'Leaks, drains and pipe repairs', slug: 'plumbing', icon: 'Droplets' },
  { name: 'Painter', description: 'Interior and exterior wall perfection', slug: 'painter', icon: 'Paintbrush' },
  { name: 'Carpentry', description: 'Custom furniture and repair', slug: 'carpentry', icon: 'Hammer' },
  { name: 'Moving Help', description: 'Pack, lift and transport', slug: 'moving-help', icon: 'Truck' },
  { name: 'Gardening', description: 'Landscape and maintenance', slug: 'gardening', icon: 'Sprout' },
  { name: 'General Repair', description: 'Quick fixes for home issues', slug: 'general-repair', icon: 'Wrench' },
  { name: 'Cleaning', description: 'Home and office cleaning services', slug: 'cleaning', icon: 'Sparkles' },
] as const;

const seedServices = async (): Promise<void> => {
  for (const service of services) {
    const existing = await prisma.service.findFirst({ where: { slug: service.slug } });
    if (existing) {
      await prisma.service.update({
        where: { id: existing.id },
        data: { ...service, updatedAt: new Date() },
      });
    } else {
      const now = new Date();
      await prisma.service.create({ data: { ...service, createdAt: now, updatedAt: now } });
    }
  }
};

const seedSuperAdmin = async (): Promise<void> => {
  const email = (process.env.SUPERADMIN_EMAIL ?? 'latache.superadmin@yopmail.com')
    .trim()
    .toLowerCase();
  const password = process.env.SUPERADMIN_PASSWORD ?? 'Admin@12345';
  const passwordHash = await hash(password, Number(process.env.BCRYPT_ROUNDS ?? 12));
  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
  });

  const canonicalData = {
    firstName: 'Latache',
    lastName: 'Super Admin',
    email,
    role: UserRole.SuperAdmin,
    accountStatus: AccountStatus.Active,
    adminRole: AdminRole.SuperAdmin,
    permissions: DEFAULT_ADMIN_PERMISSIONS[AdminRole.SuperAdmin],
    isVerified: true,
    isAdmin: true,
    authType: 'local',
    mustChangePassword: false,
    deletedAt: null,
  };

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        ...canonicalData,
        password: passwordHash,
      },
    });
  } else {
    await prisma.user.create({
      data: {
        ...canonicalData,
        password: passwordHash,
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
      adminRole: AdminRole.CustomAdmin,
      permissions: [],
      accountStatus: AccountStatus.Suspended,
      isAdmin: true,
    },
  });

  console.info(`Super administrator seeded: ${email}`);
};

async function main(): Promise<void> {
  await seedServices();
  await seedSuperAdmin();
}

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
