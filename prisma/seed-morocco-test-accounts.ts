/**
 * One-off QA data seed: 50 ready-to-use test accounts (Customer + Tasker)
 * spread across major Moroccan cities, for testing "nearby taskers"
 * discovery. Every account is pre-verified/pre-approved (no OTP, no admin
 * review needed) and shares one password. Safe to re-run - every write is
 * an upsert keyed by email/userId, so running it twice just confirms the
 * same 50 rows exist rather than duplicating them.
 *
 * Run with: npx tsx prisma/seed-morocco-test-accounts.ts
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from 'bcryptjs';
import { PrismaClient } from '../src/generated/prisma/client';
import { AccountStatus } from '../src/common/enums/account-status.enum';
import { UserRole } from '../src/common/enums/user-role.enum';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required to seed test accounts');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const TEST_PASSWORD = 'Tester@2026';

const CITIES = [
  { name: 'Casablanca', lat: 33.5731, lng: -7.5898, zip: '20000' },
  { name: 'Rabat', lat: 34.0209, lng: -6.8416, zip: '10000' },
  { name: 'Marrakech', lat: 31.6295, lng: -7.9811, zip: '40000' },
  { name: 'Fes', lat: 34.0331, lng: -5.0003, zip: '30000' },
  { name: 'Tangier', lat: 35.7595, lng: -5.834, zip: '90000' },
  { name: 'Agadir', lat: 30.4278, lng: -9.5981, zip: '80000' },
  { name: 'Meknes', lat: 33.8935, lng: -5.5473, zip: '50000' },
  { name: 'Oujda', lat: 34.6814, lng: -1.9086, zip: '60000' },
  { name: 'Kenitra', lat: 34.261, lng: -6.5802, zip: '14000' },
  { name: 'Tetouan', lat: 35.5785, lng: -5.3684, zip: '93000' },
] as const;

// 30 names for Taskers (3/city) followed by 20 for Customers (2/city) - just
// a flat pool, order doesn't matter beyond giving every account a distinct,
// plausible Moroccan name.
const NAMES: Array<{ firstName: string; lastName: string }> = [
  { firstName: 'Youssef', lastName: 'Benali' },
  { firstName: 'Omar', lastName: 'El Amrani' },
  { firstName: 'Hamza', lastName: 'Tazi' },
  { firstName: 'Rachid', lastName: 'Idrissi' },
  { firstName: 'Khalid', lastName: 'Fassi' },
  { firstName: 'Said', lastName: 'Chraibi' },
  { firstName: 'Mehdi', lastName: 'Bennani' },
  { firstName: 'Anas', lastName: 'Alaoui' },
  { firstName: 'Younes', lastName: 'Ziani' },
  { firstName: 'Ayoub', lastName: 'Haddad' },
  { firstName: 'Karim', lastName: 'Lahlou' },
  { firstName: 'Abdellah', lastName: 'Berrada' },
  { firstName: 'Nabil', lastName: 'Ouazzani' },
  { firstName: 'Tarik', lastName: 'Sbai' },
  { firstName: 'Zakaria', lastName: 'Guerraoui' },
  { firstName: 'Mouad', lastName: 'Naciri' },
  { firstName: 'Soufiane', lastName: 'Bouzidi' },
  { firstName: 'Reda', lastName: 'Mansouri' },
  { firstName: 'Ismail', lastName: 'Kabbaj' },
  { firstName: 'Walid', lastName: 'Serghini' },
  { firstName: 'Amine', lastName: 'Belhaj' },
  { firstName: 'Driss', lastName: 'Ouahbi' },
  { firstName: 'Jalal', lastName: 'Rifai' },
  { firstName: 'Badr', lastName: 'Zahiri' },
  { firstName: 'Othmane', lastName: 'Skalli' },
  { firstName: 'Hicham', lastName: 'Barkouki' },
  { firstName: 'Fouad', lastName: 'Lamrani' },
  { firstName: 'Adil', lastName: 'Chaoui' },
  { firstName: 'Simo', lastName: 'Ghali' },
  { firstName: 'Noureddine', lastName: 'Jabri' },
  { firstName: 'Fatima', lastName: 'Khadiri' },
  { firstName: 'Khadija', lastName: 'Moussaoui' },
  { firstName: 'Amina', lastName: 'Rguibi' },
  { firstName: 'Samira', lastName: 'Taibi' },
  { firstName: 'Nadia', lastName: 'Bakkali' },
  { firstName: 'Laila', lastName: 'Senhaji' },
  { firstName: 'Salma', lastName: 'Cherkaoui' },
  { firstName: 'Imane', lastName: 'Harrak' },
  { firstName: 'Sara', lastName: 'Belkadi' },
  { firstName: 'Houda', lastName: 'Zerouali' },
  { firstName: 'Meryem', lastName: 'Ouali' },
  { firstName: 'Ghita', lastName: 'Bendahou' },
  { firstName: 'Asmae', lastName: 'Rahmouni' },
  { firstName: 'Soukaina', lastName: 'Fahim' },
  { firstName: 'Hind', lastName: 'Kettani' },
  { firstName: 'Rania', lastName: 'Ammor' },
  { firstName: 'Nisrine', lastName: 'Toumi' },
  { firstName: 'Zineb', lastName: 'Essafi' },
  { firstName: 'Kawtar', lastName: 'Ouaddi' },
  { firstName: 'Bouchra', lastName: 'Lazrak' },
];

const SERVICE_SLUGS = [
  'electrician',
  'plumbing',
  'painter',
  'carpentry',
  'moving-help',
  'gardening',
  'general-repair',
  'cleaning',
  'handyman',
] as const;

const SKILL_BY_SERVICE: Record<string, string> = {
  electrician: 'electrician',
  plumbing: 'plumbing',
  painter: 'painting',
  carpentry: 'carpentry',
  'moving-help': 'moving',
  gardening: 'gardening',
  'general-repair': 'general-repair',
  cleaning: 'cleaning',
  handyman: 'handyman',
};

const slugifyCity = (city: string): string => city.toLowerCase().replace(/\s+/g, '-');

const avatarUrl = (firstName: string, lastName: string): string =>
  `https://ui-avatars.com/api/?name=${encodeURIComponent(`${firstName} ${lastName}`)}&background=random&size=256`;

/** Small deterministic jitter (~0-3km) so taskers/customers in the same city aren't stacked on one exact point. */
const jitter = (seed: number): number => ((seed % 7) - 3) * 0.008;

interface PlannedAccount {
  role: 'tasker' | 'customer';
  email: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  city: (typeof CITIES)[number];
  index: number; // 0-4 within the city block
  globalIndex: number; // 0-49
}

function buildPlan(): PlannedAccount[] {
  const plan: PlannedAccount[] = [];
  let nameCursor = 0;
  let globalIndex = 0;
  for (const city of CITIES) {
    for (let index = 0; index < 5; index += 1) {
      const role: 'tasker' | 'customer' = index < 3 ? 'tasker' : 'customer';
      const roleSuffix = role === 'tasker' ? index + 1 : index - 2;
      const name = NAMES[nameCursor % NAMES.length] ?? NAMES[0]!;
      nameCursor += 1;
      const citySlug = slugifyCity(city.name);
      const email = `latache.${role}.${citySlug}${roleSuffix}@yopmail.com`.toLowerCase();
      const phoneNumber = `6${(61000000 + globalIndex * 37).toString().padStart(8, '0')}`.slice(0, 9);
      plan.push({
        role,
        email,
        firstName: name.firstName,
        lastName: name.lastName,
        phoneNumber,
        city,
        index,
        globalIndex,
      });
      globalIndex += 1;
    }
  }
  return plan;
}

async function upsertCustomer(
  account: PlannedAccount,
  passwordHash: string,
): Promise<void> {
  const now = new Date();
  const user = await prisma.user.upsert({
    where: { email: account.email },
    create: {
      email: account.email,
      password: passwordHash,
      firstName: account.firstName,
      lastName: account.lastName,
      phoneCountryCode: '+212',
      phoneNumber: account.phoneNumber,
      preferredLanguage: 'en',
      zipCode: account.city.zip,
      profilePicture: avatarUrl(account.firstName, account.lastName),
      role: '',
      roles: [UserRole.Customer],
      accountStatus: AccountStatus.Active,
      isVerified: true,
      isAdmin: false,
      authType: 'local',
      acceptedTermsAt: now,
      acceptedPrivacyAt: now,
    },
    update: {
      password: passwordHash,
      firstName: account.firstName,
      lastName: account.lastName,
      phoneCountryCode: '+212',
      phoneNumber: account.phoneNumber,
      preferredLanguage: 'en',
      zipCode: account.city.zip,
      profilePicture: avatarUrl(account.firstName, account.lastName),
      roles: [UserRole.Customer],
      accountStatus: AccountStatus.Active,
      isVerified: true,
      deletedAt: null,
      acceptedTermsAt: now,
      acceptedPrivacyAt: now,
    },
  });

  await prisma.customerProfile.upsert({
    where: { userId: user.id },
    create: { userId: user.id, status: 'active', activatedAt: now },
    update: { status: 'active', suspendedAt: null, deactivatedAt: null },
  });
}

async function upsertTasker(
  account: PlannedAccount,
  passwordHash: string,
  serviceIdBySlug: Map<string, number>,
): Promise<void> {
  const now = new Date();
  const serviceSlug = SERVICE_SLUGS[account.globalIndex % SERVICE_SLUGS.length] ?? SERVICE_SLUGS[0];
  const serviceId = serviceIdBySlug.get(serviceSlug);
  if (!serviceId) {
    throw new Error(`Service "${serviceSlug}" was not found - run "npx prisma db seed" first`);
  }
  const skill = SKILL_BY_SERVICE[serviceSlug] ?? serviceSlug;
  const hourlyRate = 8 + (account.globalIndex % 12);
  const lat = account.city.lat + jitter(account.globalIndex);
  const lng = account.city.lng + jitter(account.globalIndex + 3);

  const user = await prisma.user.upsert({
    where: { email: account.email },
    create: {
      email: account.email,
      password: passwordHash,
      firstName: account.firstName,
      lastName: account.lastName,
      phoneCountryCode: '+212',
      phoneNumber: account.phoneNumber,
      preferredLanguage: 'en',
      zipCode: account.city.zip,
      profilePicture: avatarUrl(account.firstName, account.lastName),
      role: '',
      roles: [UserRole.Tasker],
      accountStatus: AccountStatus.Active,
      isVerified: true,
      isAdmin: false,
      isProfilePublic: true,
      isDocVerified: true,
      authType: 'local',
      acceptedTermsAt: now,
      acceptedPrivacyAt: now,
      bio: `Experienced ${skill} professional serving ${account.city.name} and nearby areas.`,
      aboutMe: `Experienced ${skill} professional serving ${account.city.name} and nearby areas.`,
      yearsOfExperience: 2 + (account.globalIndex % 8),
      idType: 'national_id',
      identityDocument: { type: 'national_id', verified: true, note: 'QA test account - not a real document' },
      serviceAreaLabel: account.city.name,
      serviceAreaCity: account.city.name,
      serviceAreaArea: account.city.name,
      serviceAreaLat: lat,
      serviceAreaLng: lng,
      serviceAreaRadiusKm: 20,
      onboardingStatus: 'approved',
      submittedAt: now,
      skills: [skill],
    },
    update: {
      password: passwordHash,
      firstName: account.firstName,
      lastName: account.lastName,
      phoneCountryCode: '+212',
      phoneNumber: account.phoneNumber,
      preferredLanguage: 'en',
      zipCode: account.city.zip,
      profilePicture: avatarUrl(account.firstName, account.lastName),
      roles: [UserRole.Tasker],
      accountStatus: AccountStatus.Active,
      isVerified: true,
      isProfilePublic: true,
      isDocVerified: true,
      deletedAt: null,
      serviceAreaLabel: account.city.name,
      serviceAreaCity: account.city.name,
      serviceAreaArea: account.city.name,
      serviceAreaLat: lat,
      serviceAreaLng: lng,
      serviceAreaRadiusKm: 20,
      onboardingStatus: 'approved',
      skills: [skill],
    },
  });

  await prisma.taskerProfile.upsert({
    where: { userId: user.id },
    create: { userId: user.id, status: 'active', approvedAt: now },
    update: { status: 'active', approvedAt: now, suspendedAt: null, deactivatedAt: null, rejectedAt: null },
  });

  await prisma.userService.upsert({
    where: { userId_serviceId: { userId: user.id, serviceId } },
    create: { userId: user.id, serviceId, hourlyRate },
    update: { hourlyRate },
  });

  const existingSlots = await prisma.userAvailability.count({ where: { userId: user.id } });
  if (existingSlots === 0) {
    const slots = Array.from({ length: 7 }, (_, dayOffset) => {
      const date = new Date();
      date.setDate(date.getDate() + dayOffset + 1);
      date.setHours(0, 0, 0, 0);
      return { userId: user.id, date, startTime: '09:00', endTime: '17:00', isBooked: false, isCustom: false };
    });
    await prisma.userAvailability.createMany({ data: slots });
  }
}

async function main(): Promise<void> {
  const services = await prisma.service.findMany({ where: { slug: { in: [...SERVICE_SLUGS] } } });
  const serviceIdBySlug = new Map(services.map((service) => [service.slug as string, service.id]));
  if (serviceIdBySlug.size < SERVICE_SLUGS.length) {
    throw new Error('Not every expected service slug was found - run "npx prisma db seed" first');
  }

  const passwordHash = await hash(TEST_PASSWORD, Number(process.env.BCRYPT_ROUNDS ?? 12));
  const plan = buildPlan();

  let taskers = 0;
  let customers = 0;
  for (const account of plan) {
    if (account.role === 'tasker') {
      await upsertTasker(account, passwordHash, serviceIdBySlug);
      taskers += 1;
    } else {
      await upsertCustomer(account, passwordHash);
      customers += 1;
    }
    console.info(`Seeded ${account.role}: ${account.email} (${account.city.name})`);
  }

  console.info(`\nDone. ${taskers} taskers + ${customers} customers across ${CITIES.length} cities.`);
  console.info(`Shared password for every seeded account: ${TEST_PASSWORD}`);
}

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
