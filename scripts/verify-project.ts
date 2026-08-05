import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(process.cwd());
const failures: string[] = [];

const read = (path: string): string => readFileSync(join(root, path), 'utf8');
const requireFile = (path: string): void => {
  if (!existsSync(join(root, path))) failures.push(`Missing required file: ${path}`);
};
const walk = (directory: string): string[] => {
  const absolute = join(root, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute).flatMap((entry) => {
    const path = join(absolute, entry);
    return statSync(path).isDirectory()
      ? walk(relative(root, path))
      : [relative(root, path).replaceAll('\\', '/')];
  });
};

for (const path of [
  'package.json',
  'prisma.config.ts',
  'prisma/schema.prisma',
  'prisma/migrations/20260805000000_baseline/migration.sql',
  'prisma/seed.ts',
  'src/database/prisma.service.ts',
  'src/modules/mail/mail.module.ts',
  'src/modules/mail/mail.service.ts',
]) {
  requireFile(path);
}

const packageJson = JSON.parse(read('package.json')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const allDependencies = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
};
for (const dependency of [
  'sequelize',
  'sequelize-typescript',
  '@nestjs/sequelize',
  'sequelize-cli',
  'resend',
  'typeorm',
  '@nestjs/typeorm',
]) {
  if (dependency in allDependencies) failures.push(`Forbidden dependency remains: ${dependency}`);
}
for (const dependency of [
  '@prisma/client',
  '@prisma/adapter-pg',
  'prisma',
  'nodemailer',
]) {
  if (!(dependency in allDependencies)) failures.push(`Required dependency is missing: ${dependency}`);
}

const sourceFiles = walk('src').filter((path) => path.endsWith('.ts'));
const sourceText = sourceFiles.map((path) => read(path)).join('\n');
for (const marker of [
  "from '@nestjs/sequelize'",
  "from 'sequelize'",
  "from 'sequelize-typescript'",
  "from 'resend'",
]) {
  if (sourceText.includes(marker)) failures.push(`Forbidden source import remains: ${marker}`);
}

const runtimeJavaScript = ['src', 'prisma', 'scripts', 'test']
  .flatMap(walk)
  .filter((path) => path.endsWith('.js') || path.endsWith('.cjs'));
if (runtimeJavaScript.length) {
  failures.push(`JavaScript runtime/source files remain: ${runtimeJavaScript.join(', ')}`);
}

const schema = read('prisma/schema.prisma');
for (const marker of [
  'provider     = "prisma-client"',
  'moduleFormat = "cjs"',
  'model User {',
  'model Service {',
  'model RefreshToken {',
  'model UserService {',
  'model UserAvailability {',
  'model Booking {',
  '@@map("Users")',
  '@@map("Bookings")',
]) {
  if (!schema.includes(marker)) failures.push(`Prisma schema marker is missing: ${marker}`);
}

const migration = read('prisma/migrations/20260805000000_baseline/migration.sql');
for (const table of [
  'Users',
  'Services',
  'RefreshTokens',
  'UserServices',
  'UserAvailabilities',
  'Bookings',
]) {
  if (!migration.includes(`CREATE TABLE "${table}"`)) {
    failures.push(`Baseline migration does not create ${table}`);
  }
}

const mailModule = read('src/modules/mail/mail.module.ts');
if (!mailModule.includes("from 'nodemailer'")) {
  failures.push('MailModule is not using Nodemailer');
}

const controllers: Record<string, string> = {
  auth: 'src/modules/auth/auth.controller.ts',
  services: 'src/modules/services/services.controller.ts',
  taskers: 'src/modules/taskers/taskers.controller.ts',
  bookings: 'src/modules/bookings/bookings.controller.ts',
};
const contracts: Array<[string, 'Get' | 'Post', string]> = [
  ['auth', 'Get', 'get-loggedin-user'],
  ['auth', 'Post', 'sign-up'],
  ['auth', 'Post', 'verify-otp'],
  ['auth', 'Post', 'resend-otp'],
  ['auth', 'Get', 'verify-token'],
  ['auth', 'Get', 'verify-pass-token'],
  ['auth', 'Post', 'login'],
  ['auth', 'Post', 'refresh-token'],
  ['auth', 'Post', 'logout'],
  ['auth', 'Post', 'logout-all'],
  ['auth', 'Post', 'forgot-password'],
  ['auth', 'Post', 'verify-forgot-password'],
  ['services', 'Get', 'get-services'],
  ['services', 'Post', 'add-service'],
  ['taskers', 'Post', 'onboarding'],
  ['taskers', 'Get', ''],
  ['taskers', 'Get', ':id/availability'],
  ['taskers', 'Get', ':id'],
  ['bookings', 'Post', 'book-tasker'],
  ['bookings', 'Get', 'upcoming'],
  ['bookings', 'Get', 'completed'],
  ['bookings', 'Get', 'next'],
];

if (!read('src/main.ts').includes("app.setGlobalPrefix('api')")) {
  failures.push('Global /api prefix is missing');
}
for (const [prefix, path] of Object.entries(controllers)) {
  const controller = read(path);
  if (!controller.includes(`@Controller('${prefix}')`)) {
    failures.push(`Controller prefix /${prefix} is missing from ${path}`);
  }
}
for (const [prefix, method, route] of contracts) {
  const controller = read(controllers[prefix] as string);
  const decorator = route ? `@${method}('${route}')` : `@${method}()`;
  if (!controller.includes(decorator)) {
    failures.push(`${method.toUpperCase()} /api/${prefix}/${route} is missing`);
  }
}

if (failures.length) {
  console.error(`Static verification failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(
  `Verified Prisma/Nodemailer architecture, six tables, TypeScript source policy, and ${contracts.length} legacy routes.`,
);
