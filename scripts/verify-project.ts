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
  'prisma/migrations/20260805002000_revamp_auth_module/migration.sql',
  'prisma/seed.ts',
  'src/database/prisma.service.ts',
  'src/modules/mail/mail.module.ts',
  'src/modules/mail/mail.service.ts',
  'src/modules/auth/auth.controller.ts',
  'src/modules/auth/auth.module.ts',
  'src/modules/auth/guards/jwt-identity.guard.ts',
  'src/modules/auth/guards/jwt-auth.guard.ts',
  'src/modules/auth/services/auth-registration.service.ts',
  'src/modules/auth/services/auth-password.service.ts',
  'src/modules/auth/services/auth-token.service.ts',
  'src/modules/auth/auth.swagger.spec.ts',
  'src/modules/uploads/uploads.module.ts',
  'src/modules/uploads/uploads.controller.ts',
  'src/modules/uploads/uploads.service.ts',
  'docs/auth-module.md',
]) {
  requireFile(path);
}

const packageJson = JSON.parse(read('package.json')) as {
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
if (packageJson.version !== '3.3.2') {
  failures.push(`Expected package version 3.3.2, received ${packageJson.version ?? '<missing>'}`);
}
const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
for (const dependency of [
  'sequelize',
  'sequelize-typescript',
  '@nestjs/sequelize',
  'sequelize-cli',
  'resend',
  'typeorm',
  '@nestjs/typeorm',
]) {
  if (dependency in dependencies) failures.push(`Forbidden dependency remains: ${dependency}`);
}
for (const dependency of ['@prisma/client', '@prisma/adapter-pg', 'prisma', 'nodemailer', 'cloudinary']) {
  if (!(dependency in dependencies)) failures.push(`Required dependency is missing: ${dependency}`);
}

const sourceFiles = walk('src').filter((path) => path.endsWith('.ts'));
const sourceText = sourceFiles.map((path) => read(path)).join('\n');
for (const marker of [
  "from '@nestjs/sequelize'",
  "from 'sequelize'",
  "from 'sequelize-typescript'",
  "from 'resend'",
  'PASSWORD_RESET_JWT_SECRET',
  'PASS_JWT_EXPIRES_IN',
  'ALLOW_QUERY_TOKEN_COMPATIBILITY',
  'registerLegacy',
  'resetWithToken',
  'verifyPasswordResetToken',
  'passwordResetLinkTemplate',
]) {
  if (sourceText.includes(marker)) failures.push(`Forbidden auth/source marker remains: ${marker}`);
}

const runtimeJavaScript = ['src', 'prisma', 'scripts', 'test']
  .flatMap(walk)
  .filter((path) => path.endsWith('.js') || path.endsWith('.cjs'));
if (runtimeJavaScript.length > 0) {
  failures.push(`JavaScript runtime/source files remain: ${runtimeJavaScript.join(', ')}`);
}

const htmlFiles = walk('.').filter(
  (path) =>
    (path.endsWith('.html') || path.endsWith('.htm')) &&
    !path.startsWith('node_modules/') &&
    !path.startsWith('dist/'),
);
if (htmlFiles.length > 0) {
  failures.push(`Standalone HTML files remain: ${htmlFiles.join(', ')}`);
}

const nestCli = read('nest-cli.json');
if (nestCli.includes('mail/templates') || nestCli.includes('.html')) {
  failures.push('Nest CLI still references removed standalone email templates');
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
  'accountStatus',
  'adminRole',
  'permissions',
  'phoneCountryCode',
  'lastLoginAt',
]) {
  if (!schema.includes(marker)) failures.push(`Prisma schema marker is missing: ${marker}`);
}

const baseline = read('prisma/migrations/20260805000000_baseline/migration.sql');
for (const table of [
  'Users',
  'Services',
  'RefreshTokens',
  'UserServices',
  'UserAvailabilities',
  'Bookings',
]) {
  if (!baseline.includes(`CREATE TABLE "${table}"`)) {
    failures.push(`Baseline migration does not create ${table}`);
  }
}

const authModule = read('src/modules/auth/auth.module.ts');
for (const provider of [
  'JwtIdentityGuard',
  'JwtAuthGuard',
  'AdminAuthGuard',
  'RolesGuard',
  'PermissionsGuard',
  'AuthSessionsRepository',
  'UsersModule',
]) {
  if (!authModule.includes(provider)) {
    failures.push(`AuthModule provider/export graph is missing ${provider}`);
  }
}

const authExportsBlock = authModule.match(/exports:\s*\[([\s\S]*?)\]/)?.[1] ?? '';
for (const provider of [
  'JwtIdentityGuard',
  'JwtAuthGuard',
  'AdminAuthGuard',
  'AuthSessionsRepository',
  'JwtModule',
  'UsersModule',
]) {
  if (!authExportsBlock.includes(provider)) {
    failures.push(`AuthModule exports are missing ${provider}`);
  }
}

const tokenService = read('src/modules/auth/services/auth-token.service.ts');
if (tokenService.includes('user.isVerified &&')) {
  failures.push('Pending-verification registration sessions cannot be refreshed');
}

const identityGuard = read('src/modules/auth/guards/jwt-identity.guard.ts');
for (const marker of ['extractBearerToken', 'findActiveById', 'sessionId']) {
  if (!identityGuard.includes(marker)) {
    failures.push(`Identity guard security marker is missing: ${marker}`);
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
  uploads: 'src/modules/uploads/uploads.controller.ts',
};
const canonicalContracts: Array<[
  keyof typeof controllers,
  'Get' | 'Post' | 'Patch' | 'Delete',
  string,
]> = [
  ['auth', 'Post', 'customers/register'],
  ['auth', 'Post', 'taskers/register'],
  ['auth', 'Post', 'admins/register'],
  ['auth', 'Post', 'login'],
  ['auth', 'Post', 'refresh'],
  ['auth', 'Post', 'verify-email'],
  ['auth', 'Post', 'resend-verification-email'],
  ['auth', 'Post', 'forgot-password'],
  ['auth', 'Post', 'verify-reset-otp'],
  ['auth', 'Post', 'reset-password'],
  ['auth', 'Patch', 'change-password'],
  ['auth', 'Get', 'me'],
  ['auth', 'Patch', 'me'],
  ['auth', 'Get', 'sessions'],
  ['auth', 'Delete', 'sessions/:id'],
  ['auth', 'Post', 'logout'],
  ['auth', 'Post', 'sessions/logout-all'],
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
  ['uploads', 'Post', 'registration'],
  ['uploads', 'Post', 'single'],
  ['uploads', 'Post', 'multiple'],
  ['uploads', 'Delete', ''],
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
for (const [prefix, method, route] of canonicalContracts) {
  const controllerPath = controllers[prefix];
  if (!controllerPath) {
    failures.push(`Controller mapping not found for route prefix: ${prefix}`);
    continue;
  }
  const controller = read(controllerPath);
  const decorator = route ? `@${method}('${route}')` : `@${method}()`;
  if (!controller.includes(decorator)) {
    failures.push(`${method.toUpperCase()} /api/${prefix}/${route} is missing`);
  }
}

const authController = read('src/modules/auth/auth.controller.ts');
for (const route of [
  'sign-up',
  'refresh-token',
  'verify-otp',
  'resend-otp',
  'verify-pass-token',
  'verify-forgot-password',
  'get-loggedin-user',
  'verify-token',
  'logout-all',
]) {
  const routePattern = new RegExp(`@(Get|Post|Patch|Delete)\\('${route.replace('/', '\\/')}'\\)`);
  if (routePattern.test(authController)) {
    failures.push(`Removed legacy auth route remains: /api/auth/${route}`);
  }
}
for (const marker of [
  "@ApiTags('01 Auth')",
  '@ApiOperation',
  '@ApiCreatedResponse',
  '@ApiOkResponse',
  "@ApiBearerAuth('bearer')",
]) {
  if (!authController.includes(marker)) failures.push(`Auth Swagger marker is missing: ${marker}`);
}


const uploadsController = read('src/modules/uploads/uploads.controller.ts');
for (const marker of [
  "@ApiTags('02 Uploads')",
  "@ApiConsumes('multipart/form-data')",
  "@Post('registration')",
  "@Post('single')",
  "@Post('multiple')",
  '@Delete()',
]) {
  if (!uploadsController.includes(marker)) failures.push(`Uploads marker is missing: ${marker}`);
}
const uploadsService = read('src/modules/uploads/uploads.service.ts');
for (const marker of ['upload_stream', 'uploader.destroy', 'ownerNamespace', 'assertFolderAccess']) {
  if (!uploadsService.includes(marker)) failures.push(`Cloudinary upload security marker is missing: ${marker}`);
}
if (!authController.includes('loginRequestExamples') || !authController.includes('loginResponseExamples')) {
  failures.push('Role-specific login Swagger examples are missing');
}

const registrationDto = read('src/modules/auth/dto/common-auth.dto.ts');
if (!registrationDto.includes('acceptedTermsAndPrivacyPolicy!: true')) {
  failures.push('Canonical signup consent field is missing');
}
for (const removedDto of [
  'src/modules/auth/dto/sign-up.dto.ts',
  'src/modules/auth/dto/optional-refresh-token.dto.ts',
  'src/modules/auth/dto/resend-otp.dto.ts',
  'src/modules/auth/dto/reset-password-with-otp.dto.ts',
  'src/modules/auth/dto/verify-otp.dto.ts',
]) {
  if (existsSync(join(root, removedDto))) failures.push(`Removed legacy DTO remains: ${removedDto}`);
}
const taskerDto = read('src/modules/auth/dto/register-tasker.dto.ts');
if (!taskerDto.includes('@ArrayMinSize(3)') || !taskerDto.includes('@ArrayMaxSize(3)')) {
  failures.push('Tasker registration must require exactly three services');
}

const seed = read('prisma/seed.ts');
for (const marker of [
  'latache.superadmin@yopmail.com',
  'Admin@12345',
  'password: passwordHash',
  'AdminRole.SuperAdmin',
]) {
  if (!seed.includes(marker)) failures.push(`Super-admin seed marker is missing: ${marker}`);
}

if (failures.length > 0) {
  console.error(`Static verification failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(
  `Verified Prisma/Nodemailer architecture, canonical auth and Cloudinary upload route surface, six mapped tables, ${canonicalContracts.length} total routes, and removal of every legacy auth alias.`,
);
