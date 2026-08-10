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

const requiredFiles = [
  'package.json',
  'prisma/schema.prisma',
  'prisma/migrations/20260807020000_add_customer_dashboard_and_stripe/migration.sql',
  'prisma/migrations/20260808090000_add_admin_dashboard_foundation/migration.sql',
  'prisma/migrations/20260810070000_add_elite_tasker_program/migration.sql',
  'prisma/migrations/20260810130000_add_booking_dispute_management/migration.sql',
  'prisma/migrations/20260810173000_add_finance_platform_settings/migration.sql',
  'src/modules/admin-audit/admin-audit.service.ts',
  'src/modules/admin-dashboard/admin-dashboard.module.ts',
  'src/modules/admin-dashboard/controllers/admin-analytics.controller.ts',
  'src/modules/admin-dashboard/controllers/admin-customers.controller.ts',
  'src/modules/admin-dashboard/controllers/admin-taskers.controller.ts',
  'src/modules/admin-dashboard/controllers/admin-bookings.controller.ts',
  'src/modules/admin-dashboard/controllers/admin-disputes.controller.ts',
  'src/modules/admin-finance/admin-finance.module.ts',
  'src/modules/admin-finance/controllers/admin-finance.controller.ts',
  'src/modules/platform-settings/platform-settings.module.ts',
  'src/modules/platform-settings/platform-settings.controller.ts',
  'src/modules/elite-program/elite-program.module.ts',
  'src/modules/elite-program/controllers/admin-elite-taskers.controller.ts',
  'src/modules/elite-program/controllers/tasker-elite.controller.ts',
  'src/modules/auth/auth.controller.ts',
  'src/modules/bookings/bookings.controller.ts',
  'src/modules/dashboard/dashboard.controller.ts',
  'src/modules/notifications/notifications.controller.ts',
  'src/modules/conversations/conversations.controller.ts',
  'src/modules/reviews/reviews.controller.ts',
  'src/modules/favorites/favorites.controller.ts',
  'src/modules/payments/payments.controller.ts',
  'src/modules/payments/stripe-webhooks.controller.ts',
  'src/modules/tasker-dashboard/controllers/tasker-profile.controller.ts',
  'src/modules/tasker-dashboard/controllers/tasker-wallet.controller.ts',
  'docs/auth-module.md',
  'docs/admin-dashboard.md',
  'docs/elite-tasker-program.md',
  'docs/admin-bookings-disputes.md',
  'docs/admin-finance-platform-settings.md',
];
for (const file of requiredFiles) requireFile(file);

const packageJson = JSON.parse(read('package.json')) as {
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
if (packageJson.version !== '3.10.0') failures.push(`Expected package version 3.10.0, received ${packageJson.version ?? '<missing>'}`);
const dependencies: Record<string, string> = {
  ...(packageJson.dependencies ?? {}),
  ...(packageJson.devDependencies ?? {}),
};
for (const required of ['@prisma/client', '@prisma/adapter-pg', 'nodemailer', 'cloudinary', 'stripe']) {
  if (!(required in dependencies)) failures.push(`Required dependency missing: ${required}`);
}
for (const forbidden of ['sequelize', 'sequelize-typescript', '@nestjs/sequelize', 'typeorm', '@nestjs/typeorm', 'resend']) {
  if (forbidden in dependencies) failures.push(`Forbidden legacy dependency remains: ${forbidden}`);
}

const schema = read('prisma/schema.prisma');
for (const marker of [
  'model FavoriteTasker {',
  'model ServiceOption {',
  'model CustomerWallet {',
  'model CustomerWalletLedgerEntry {',
  'model PaymentTransaction {',
  'model StripeWebhookEvent {',
  'model AdminAuditLog {',
  'adminAuditActions',
  'adminAuditTargets',
  'model EliteTier {',
  'model EliteMembershipRequest {',
  'model EliteTierTransition {',
  'model EliteBenefit {',
  'model EliteBadge {',
  'model EliteTaskerBadge {',
  'model DisputeEvidence {',
  'model DisputeEvidenceRequest {',
  'model DisputeResolution {',
  'evidenceReviewStatus',
  'resolutionAmount',
  'model PlatformSetting {',
  'taxAmount',
  'commissionRatePercent',
  'taxRatePercent',
  'taxInclusive',
  'serviceSurchargeAmount',
  'reviewedById',
  'eliteTierId',
  'requirementsSnapshot',
  'stripeCustomerId',
  'paymentStatus',
  'estimatedDurationMinutes',
  'extensionMinutes',
]) {
  if (!schema.includes(marker)) failures.push(`Prisma schema marker missing: ${marker}`);
}

const sourceFiles = walk('src').filter((path) => path.endsWith('.ts'));
const sourceText = sourceFiles.map((path) => read(path)).join('\n');
for (const marker of ["from 'sequelize'", "from 'sequelize-typescript'", "from 'resend'"]) {
  if (sourceText.includes(marker)) failures.push(`Forbidden source marker remains: ${marker}`);
}
const removedTaskerControllers = [
  'src/modules/tasker-dashboard/controllers/tasker-dashboard.controller.ts',
  'src/modules/tasker-dashboard/controllers/tasker-tasks.controller.ts',
  'src/modules/tasker-dashboard/controllers/tasker-messages.controller.ts',
  'src/modules/tasker-dashboard/controllers/tasker-notifications.controller.ts',
  'src/modules/tasker-dashboard/controllers/tasker-reviews.controller.ts',
];
for (const file of removedTaskerControllers) {
  if (existsSync(join(root, file))) failures.push(`Duplicate Tasker API controller remains: ${file}`);
}

const controllerFiles = sourceFiles.filter((path) => path.endsWith('controller.ts'));
const routes = new Map<string, string>();
const controllerPattern = /@Controller\(['\"]([^'\"]+)['\"]\)/;
const routePattern = /@(Get|Post|Patch|Put|Delete)\((?:['\"]([^'\"]*)['\"])?\)/g;
for (const file of controllerFiles) {
  const text = read(file);
  const prefix = controllerPattern.exec(text)?.[1] ?? '';
  for (const match of text.matchAll(routePattern)) {
    const method = match[1];
    const suffix = match[2] ?? '';
    if (!method) continue;
    const key = `${method.toUpperCase()} /api/${[prefix, suffix].filter(Boolean).join('/')}`;
    const existing = routes.get(key);
    if (existing) failures.push(`Duplicate API route ${key} in ${existing} and ${file}`);
    else routes.set(key, file);
  }
}

for (const expected of [
  'GET /api/dashboard/overview',
  'POST /api/bookings/quote',
  'POST /api/bookings',
  'GET /api/bookings',
  'POST /api/bookings/:bookingId/reschedule',
  'POST /api/bookings/:bookingId/extend',
  'GET /api/conversations',
  'GET /api/notifications',
  'GET /api/reviews',
  'GET /api/favorites/taskers',
  'POST /api/payments/setup-intent',
  'GET /api/payments/methods',
  'GET /api/payments/wallet',
  'POST /api/payments/wallet/topups',
  'POST /api/payments/webhooks/stripe',
  'GET /api/admin/dashboard/overview',
  'GET /api/admin/dashboard/revenue',
  'GET /api/admin/dashboard/activity',
  'GET /api/admin/customers',
  'GET /api/admin/customers/payments',
  'GET /api/admin/customers/reports',
  'PATCH /api/admin/customers/:id/status',
  'GET /api/admin/taskers',
  'GET /api/admin/taskers/pending-verification',
  'GET /api/admin/taskers/performance',
  'GET /api/admin/taskers/earnings',
  'POST /api/admin/taskers/:id/verification',
  'PATCH /api/admin/taskers/:id/status',
  'GET /api/admin/bookings',
  'GET /api/admin/bookings/:id',
  'POST /api/admin/bookings/:id/actions',
  'GET /api/admin/disputes',
  'GET /api/admin/disputes/:id',
  'GET /api/admin/finance',
  'POST /api/admin/finance/payouts/:id/actions',
  'GET /api/admin/platform-settings',
  'PUT /api/admin/platform-settings',
  'POST /api/admin/disputes/:id/actions',
  'GET /api/bookings/:bookingId/complaints',
  'POST /api/bookings/:bookingId/complaints/:complaintId/evidence',
  'PATCH /api/rbac/admins/:id',
  'PATCH /api/rbac/admins/:id/access',
  'PATCH /api/rbac/admins/:id/status',
  'DELETE /api/rbac/admins/:id',
  'GET /api/admin/elite-taskers/overview',
  'GET /api/admin/elite-taskers',
  'GET /api/admin/elite-taskers/program',
  'PATCH /api/admin/elite-taskers/program/tiers/:tierCode',
  'PUT /api/admin/elite-taskers/program/tiers/:tierCode/benefits',
  'POST /api/admin/elite-taskers/program/badges',
  'PATCH /api/admin/elite-taskers/program/badges/:badgeId',
  'DELETE /api/admin/elite-taskers/program/badges/:badgeId',
  'GET /api/admin/elite-taskers/performance',
  'GET /api/admin/elite-taskers/reports',
  'POST /api/admin/elite-taskers/requests/:requestId/decision',
  'PATCH /api/admin/elite-taskers/:taskerId/tier',
  'POST /api/admin/elite-taskers/:taskerId/badges/:badgeId',
  'DELETE /api/admin/elite-taskers/:taskerId/badges/:badgeId',
  'GET /api/admin/elite-taskers/:taskerId',
  'GET /api/tasker-dashboard/elite',
  'POST /api/tasker-dashboard/elite/requests',
  'DELETE /api/tasker-dashboard/elite/requests/:requestId',
]) {
  if (!routes.has(expected)) failures.push(`Expected unified route missing: ${expected}`);
}
for (const deprecatedPrefix of [
  '/api/tasker-dashboard/tasks',
  '/api/tasker-dashboard/messages',
  '/api/tasker-dashboard/notifications',
  '/api/tasker-dashboard/reviews',
]) {
  if ([...routes.keys()].some((route) => route.includes(deprecatedPrefix))) {
    failures.push(`Deprecated duplicate API surface remains: ${deprecatedPrefix}`);
  }
}

const main = read('src/main.ts');
for (const marker of ["app.setGlobalPrefix('api')", "startsWith('/api/payments/webhooks/stripe')", "SwaggerModule.setup('api/docs'", ".setVersion('3.10.0')"]) {
  if (!main.includes(marker)) failures.push(`Bootstrap marker missing: ${marker}`);
}

const migration = read('prisma/migrations/20260807020000_add_customer_dashboard_and_stripe/migration.sql');
for (const marker of ['CREATE TABLE IF NOT EXISTS "PaymentTransactions"', 'CREATE TABLE IF NOT EXISTS "StripeWebhookEvents"', 'CREATE TABLE IF NOT EXISTS "FavoriteTaskers"']) {
  if (!migration.includes(marker)) failures.push(`Customer migration marker missing: ${marker}`);
}

const adminMigration = read('prisma/migrations/20260808090000_add_admin_dashboard_foundation/migration.sql');
for (const marker of ['CREATE TABLE "AdminAuditLogs"', 'AdminAuditLogs_actorId_fkey', 'AdminAuditLogs_targetUserId_fkey']) {
  if (!adminMigration.includes(marker)) failures.push(`Admin dashboard migration marker missing: ${marker}`);
}

const eliteMigration = read('prisma/migrations/20260810070000_add_elite_tasker_program/migration.sql');
for (const marker of [
  'CREATE TABLE "EliteTiers"',
  'CREATE TABLE "EliteMembershipRequests"',
  'CREATE TABLE "EliteTierTransitions"',
  'CREATE TABLE "EliteBenefits"',
  'CREATE TABLE "EliteBadges"',
  'CREATE TABLE "EliteTaskerBadges"',
  'elite_requests_one_pending_per_tasker',
  '"requirementsSnapshot" JSONB',
  "'elite.read'",
  "'elite.manage'",
]) {
  if (!eliteMigration.includes(marker)) failures.push(`Elite Program migration marker missing: ${marker}`);
}

const eliteController = read('src/modules/elite-program/controllers/admin-elite-taskers.controller.ts');
for (const marker of [
  "@Permissions('elite.read')",
  "@Permissions('elite.manage')",
  "view=members, applications, upgrade_requests, or downgrade_requests",
  'trackingAvailable=false',
]) {
  if (!eliteController.includes(marker)) failures.push(`Elite controller marker missing: ${marker}`);
}

const eliteModule = read('src/modules/elite-program/elite-program.module.ts');
for (const marker of ['AuthModule', 'AdminAuditModule', 'NotificationsModule', 'EliteProgramService']) {
  if (!eliteModule.includes(marker)) failures.push(`Elite module dependency marker missing: ${marker}`);
}

const permissionCatalog = read('src/modules/rbac/constants/permission-catalog.ts');
for (const marker of ["key: 'elite.read'", "key: 'elite.manage'", "key: 'settings.read'", "key: 'settings.manage'"]) {
  if (!permissionCatalog.includes(marker)) failures.push(`Elite RBAC marker missing: ${marker}`);
}

if (routes.has('GET /api/admin/dashboard/elite-taskers')) {
  failures.push('Deprecated duplicate Elite analytics route remains: GET /api/admin/dashboard/elite-taskers');
}

const rbacController = read('src/modules/rbac/controllers/rbac.controller.ts');
for (const marker of ["@Patch('admins/:id')", "@Delete('admins/:id')", "@Permissions('admins.update')", "@Permissions('admins.delete')"]) {
  if (!rbacController.includes(marker)) failures.push(`Administrator-management marker missing: ${marker}`);
}

const taskerAdmin = read('src/modules/admin-dashboard/services/admin-taskers.service.ts');
for (const marker of ["{ in: ['submitted', 'pending_review'] }", 'Tasker is not currently awaiting administrator verification', 'backgroundCheck: null', 'insuranceVerification: null']) {
  if (!taskerAdmin.includes(marker)) failures.push(`Tasker admin-flow marker missing: ${marker}`);
}



const bookingDisputeMigration = read('prisma/migrations/20260810130000_add_booking_dispute_management/migration.sql');
for (const marker of [
  'ALTER TABLE "TaskComplaints"',
  'CREATE TABLE "DisputeEvidence"',
  'CREATE TABLE "DisputeEvidenceRequests"',
  'CREATE TABLE "DisputeResolutions"',
  'DisputeResolutions_refundTransactionId_key',
  "evidenceReviewStatus\" VARCHAR(32) NOT NULL DEFAULT 'not_required'",
]) {
  if (!bookingDisputeMigration.includes(marker)) failures.push(`Booking/dispute migration marker missing: ${marker}`);
}
if (/INSERT\s+INTO/i.test(bookingDisputeMigration)) {
  failures.push('Booking/dispute migration must not seed fake operational or financial rows');
}

const adminDashboardModule = read('src/modules/admin-dashboard/admin-dashboard.module.ts');
for (const marker of [
  'PaymentsModule',
  'AdminBookingsController',
  'AdminDisputesController',
  'AdminBookingsService',
  'AdminDisputesService',
]) {
  if (!adminDashboardModule.includes(marker)) failures.push(`Admin booking/dispute module marker missing: ${marker}`);
}

const adminBookingsController = read('src/modules/admin-dashboard/controllers/admin-bookings.controller.ts');
for (const marker of ["@Permissions('bookings.read')", "@Permissions('bookings.manage')", 'format=csv']) {
  if (!adminBookingsController.includes(marker)) failures.push(`Admin bookings controller marker missing: ${marker}`);
}
const adminBookingsService = read('src/modules/admin-dashboard/services/admin-bookings.service.ts');
for (const marker of ['reports.read', 'Resolve active booking disputes before administrative cancellation', 'A settled booking must be handled through dispute/refund resolution']) {
  if (!adminBookingsService.includes(marker)) failures.push(`Admin bookings service marker missing: ${marker}`);
}

const adminDisputesController = read('src/modules/admin-dashboard/controllers/admin-disputes.controller.ts');
for (const marker of ["@Permissions('support.read')", "@Permissions('support.manage')", 'Refund resolution types additionally require finance.manage']) {
  if (!adminDisputesController.includes(marker)) failures.push(`Admin disputes controller marker missing: ${marker}`);
}
const adminDisputesService = read('src/modules/admin-dashboard/services/admin-disputes.service.ts');
for (const marker of [
  'finance.manage',
  'A refund resolution is already processing for this dispute',
  "trackingAvailable: false",
  "status: 'processing'",
  'requestEvidence',
  'reviewEvidence',
]) {
  if (!adminDisputesService.includes(marker)) failures.push(`Admin disputes service marker missing: ${marker}`);
}

const paymentsService = read('src/modules/payments/payments.service.ts');
for (const marker of [
  'issueDisputeRefund',
  "event.type === 'refund.created'",
  "event.type === 'refund.updated'",
  "event.type === 'refund.failed'",
  'applyTaskerRefundClawback',
  'PartiallyRefunded',
  'Refunded',
]) {
  if (!paymentsService.includes(marker)) failures.push(`Dispute payment marker missing: ${marker}`);
}

const bookingController = read('src/modules/bookings/bookings.controller.ts');
for (const marker of ["@Get(':bookingId/complaints')", "@Post(':bookingId/complaints/:complaintId/evidence')"]) {
  if (!bookingController.includes(marker)) failures.push(`Participant dispute route marker missing: ${marker}`);
}
const bookingService = read('src/modules/bookings/bookings.service.ts');
for (const marker of ['assertBookingAttachmentOwnership', 'res.cloudinary.com', 'disputeEvidenceRequest.updateMany']) {
  if (!bookingService.includes(marker)) failures.push(`Participant evidence-flow marker missing: ${marker}`);
}

if (routes.has('GET /api/admin/customers/bookings')) {
  failures.push('Semantic duplicate admin-wide booking route remains: GET /api/admin/customers/bookings');
}



const financeSettingsMigration = read('prisma/migrations/20260810173000_add_finance_platform_settings/migration.sql');
for (const marker of [
  'CREATE TABLE IF NOT EXISTS "PlatformSettings"',
  'ADD COLUMN IF NOT EXISTS "taxAmount"',
  'ADD COLUMN IF NOT EXISTS "commissionRatePercent"',
  'ADD COLUMN IF NOT EXISTS "taxRatePercent"',
  'ADD COLUMN IF NOT EXISTS "taxInclusive"',
  'ADD COLUMN IF NOT EXISTS "serviceSurchargeAmount"',
  'ADD COLUMN IF NOT EXISTS "reviewedById"',
  "'settings.read'",
]) {
  if (!financeSettingsMigration.includes(marker)) failures.push(`Finance/settings migration marker missing: ${marker}`);
}
if (/INSERT\s+INTO\s+"(?:PaymentTransactions|TaskerWithdrawals|CustomerWalletLedger|TaskerWalletLedger|DisputeResolutions)"/i.test(financeSettingsMigration)) {
  failures.push('Finance/settings migration must not seed operational financial records');
}

const adminFinanceController = read('src/modules/admin-finance/controllers/admin-finance.controller.ts');
for (const marker of [
  "@Controller('admin/finance')",
  "@Permissions('finance.read')",
  "@Permissions('finance.manage')",
  'reports.read is required for finance CSV exports',
  'No provider transfer is fabricated',
]) {
  if (!adminFinanceController.includes(marker)) failures.push(`Admin finance marker missing: ${marker}`);
}

const platformSettingsController = read('src/modules/platform-settings/platform-settings.controller.ts');
for (const marker of [
  "@Controller('admin/platform-settings')",
  "@Permissions('settings.read')",
  "@Permissions('settings.manage')",
  'Automatic FX refresh and referral payouts are rejected',
]) {
  if (!platformSettingsController.includes(marker)) failures.push(`Platform settings marker missing: ${marker}`);
}

const platformSettingsService = read('src/modules/platform-settings/platform-settings.service.ts');
for (const marker of [
  'calculatePricingCharges',
  'assertBookingRules',
  'serviceRadiusPolicy',
  'Referral payouts cannot be enabled',
  'Multi-currency settlement is not enabled',
]) {
  if (!platformSettingsService.includes(marker)) failures.push(`Platform settings runtime marker missing: ${marker}`);
}
if (failures.length > 0) {
  console.error(`Static verification failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Static verification passed. ${routes.size} unique API routes found.`);
