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
  'prisma/migrations/20260810190000_add_services_support_center/migration.sql',
  'prisma/migrations/20260810193000_add_realtime_outbox/migration.sql',
  'prisma/migrations/20260810194500_add_review_moderation/migration.sql',
  'prisma/migrations/20260812100000_add_conversation_calls/migration.sql',
  'prisma/migrations/20260812143000_add_tasker_earning_clearance_cash_accounting/migration.sql',
  'prisma/migrations/20260812190000_add_multilingual_architecture/migration.sql',
  'prisma/migrations/20260812223000_add_performance_indexes/migration.sql',
  'prisma/migrations/20260812233000_add_permanent_deletion_controls/migration.sql',
  'prisma/migrations/20260818120000_add_booking_completion_approval/migration.sql',
  'prisma/migrations/20260818121000_hash_auth_codes/migration.sql',
  'prisma/migrations/20260818130000_complete_production_chat_system/migration.sql',
  'prisma/migrations/20260818140000_complete_referral_reward_system/migration.sql',
  'src/infrastructure/redis/redis.service.ts',
  'src/infrastructure/redis/app-cache.service.ts',
  'src/infrastructure/jobs/performance-jobs.service.ts',
  'src/infrastructure/observability/request-logging.interceptor.ts',
  'src/modules/admin-audit/admin-audit.service.ts',
  'src/modules/admin-dashboard/admin-dashboard.module.ts',
  'src/modules/admin-dashboard/controllers/admin-analytics.controller.ts',
  'src/modules/admin-dashboard/controllers/admin-customers.controller.ts',
  'src/modules/admin-dashboard/controllers/admin-taskers.controller.ts',
  'src/modules/admin-dashboard/controllers/admin-bookings.controller.ts',
  'src/modules/admin-dashboard/controllers/admin-disputes.controller.ts',
  'src/modules/disputes/disputes.module.ts',
  'src/modules/disputes/dispute-lifecycle.service.ts',
  'prisma/migrations/20260818190000_harden_dispute_lifecycle/migration.sql',
  'prisma/migrations/20260825133000_complete_seo_management/migration.sql',
  'docs/dispute-lifecycle-hardening.md',
  'src/modules/admin-finance/admin-finance.module.ts',
  'src/modules/admin-finance/controllers/admin-finance.controller.ts',
  'src/modules/platform-settings/platform-settings.module.ts',
  'src/modules/platform-settings/platform-settings.controller.ts',
  'src/modules/support/support.module.ts',
  'src/modules/support/support.controller.ts',
  'src/modules/support/admin-support.controller.ts',
  'src/modules/admin-services/admin-services.module.ts',
  'src/modules/admin-services/controllers/admin-services.controller.ts',
  'src/modules/elite-program/elite-program.module.ts',
  'src/modules/elite-program/controllers/admin-elite-taskers.controller.ts',
  'src/modules/elite-program/controllers/tasker-elite.controller.ts',
  'src/modules/auth/auth.controller.ts',
  'src/modules/bookings/bookings.controller.ts',
  'src/modules/dashboard/dashboard.controller.ts',
  'src/modules/notifications/notifications.controller.ts',
  'src/modules/conversations/conversations.controller.ts',
  'src/modules/reviews/reviews.controller.ts',
  'src/modules/realtime/realtime.module.ts',
  'src/modules/realtime/realtime.gateway.ts',
  'src/modules/realtime/realtime-outbox.service.ts',
  'src/modules/realtime/realtime.controller.ts',
  'src/modules/realtime/realtime-calls.service.ts',
  'src/modules/realtime/webrtc-config.service.ts',
  'src/modules/uploads/conversation-attachment.constants.ts',
  'src/modules/uploads/support-attachment.constants.ts',
  'src/modules/realtime/realtime-calls.service.ts',
  'src/modules/realtime/webrtc-config.service.ts',
  'src/modules/uploads/conversation-attachment.constants.ts',
  'src/modules/admin-dashboard/controllers/admin-reviews.controller.ts',
  'src/modules/seo-management/seo-management.module.ts',
  'src/modules/seo-management/controllers/seo-management.controller.ts',
  'src/modules/seo-management/services/seo-management.service.ts',
  'src/modules/seo-management/dto/seo.dto.ts',
  'docs/seo-management.md',
  'src/modules/favorites/favorites.controller.ts',
  'src/modules/payments/payments.controller.ts',
  'src/modules/payments/stripe-webhooks.controller.ts',
  'src/modules/tasker-dashboard/controllers/tasker-profile.controller.ts',
  'src/modules/tasker-dashboard/controllers/tasker-wallet.controller.ts',
  'src/modules/tasker-finance/tasker-finance.module.ts',
  'src/modules/tasker-finance/tasker-finance.service.ts',
  'src/modules/tasker-finance/tasker-earnings.worker.ts',
  'src/modules/localization/locale.service.ts',
  'src/common/utils/cors.util.ts',
  'src/modules/notifications/notification-template.service.ts',
  'src/modules/mail/email-layout.ts',
  'src/modules/account-deletion/account-deletion.service.ts',
  'src/modules/account-deletion/object-storage-deletion.service.ts',
  'docs/auth-module.md',
  'docs/admin-dashboard.md',
  'docs/elite-tasker-program.md',
  'docs/admin-bookings-disputes.md',
  'docs/admin-finance-platform-settings.md',
  'docs/admin-services-support.md',
  'docs/api-consistency-audit.md',
  'docs/realtime.md',
  'docs/conversation-attachments-calls.md',
  'docs/chat-attachments-calls.md',
  'docs/production-chat-system.md',
  'docs/production-referral-reward-system.md',
  'docs/tasker-earnings-clearance-cash-accounting.md',
  'docs/multilingual-architecture.md',
  'docs/performance-architecture.md',
  'docs/email-design-and-darija.md',
  'docs/permanent-deletion.md',
  'docs/production-readiness.md',
  'docs/postman.md',
  'postman/Latache-OpenAPI-v3.21.1.json',
  'postman/Latache-v3.21.1.postman_collection.json',
  'postman/Latache-Local.postman_environment.json',
];
for (const file of requiredFiles) requireFile(file);

const packageJson = JSON.parse(read('package.json')) as {
  version?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
if (packageJson.version !== '3.32.0')
  failures.push(`Expected package version 3.32.0, received ${packageJson.version ?? '<missing>'}`);
if (!packageJson.scripts?.build?.includes('npm run clean')) {
  failures.push('Production build must remove stale dist output before compiling');
}
const buildConfig = read('tsconfig.build.json');
for (const marker of [
  '"rootDir": "./src"',
  '"tsBuildInfoFile": "./dist/tsconfig.build.tsbuildinfo"',
  '"include": ["src/**/*.ts"]',
]) {
  if (!buildConfig.includes(marker))
    failures.push(`Canonical Nest build-layout marker missing: ${marker}`);
}
const dependencies: Record<string, string> = {
  ...(packageJson.dependencies ?? {}),
  ...(packageJson.devDependencies ?? {}),
};
for (const required of [
  '@prisma/client',
  '@prisma/adapter-pg',
  'nodemailer',
  'cloudinary',
  'stripe',
  '@nestjs/websockets',
  '@nestjs/platform-socket.io',
  'socket.io',
  '@socket.io/redis-adapter',
  'ioredis',
  'bullmq',
  'compression',
]) {
  if (!(required in dependencies)) failures.push(`Required dependency missing: ${required}`);
}
for (const forbidden of [
  'sequelize',
  'sequelize-typescript',
  '@nestjs/sequelize',
  'typeorm',
  '@nestjs/typeorm',
  'resend',
]) {
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
  'model DisputeParticipantAction {',
  'model DisputeComment {',
  'model DisputeSatisfactionSurvey {',
  'model DisputeDelivery {',
  'model DisputeCashRefund {',
  'model DisciplinaryAction {',
  'model StripeChargeback {',
  'activeBookingKey',
  'clientRequestKey',
  'slaDueAt',
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
  'model SupportTicket {',
  'model SupportTicketMessage {',
  'model RealtimeOutboxEvent {',
  'model ConversationCall {',
  'task_notifications_user_cursor_idx',
  'realtime_outbox_cleanup_cursor_idx',
  'conversationCallsInitiated',
  'conversationCallsReceived',
  'model TaskerEarning {',
  'model TaskerPlatformAccount {',
  'model TaskerPlatformReceivable {',
  'model TaskerPlatformLedgerEntry {',
  'model ServiceTranslation {',
  'model ServiceOptionTranslation {',
  'model EliteTierTranslation {',
  'model EliteBenefitTranslation {',
  'model EliteBadgeTranslation {',
  'model ObjectStorageDeletionTask {',
  'preferredLanguage',
  'templateKey',
  'templateParams',
  'model ConversationCall {',
  'conversationCallsInitiated',
  'conversationCallsReceived',
  'moderationStatus',
  'reviewsModerated',
  'supportTickets',
  'isActive    Boolean',
  'completionApprovalDueAt',
  'completionAutoApprovedAt',
  'otpHash',
  'passwordResetCodeHash',
  'model SeoSettings {',
  'model SeoPage {',
  'model SeoRedirect {',
  'model SeoSitemapEntry {',
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
  if (existsSync(join(root, file)))
    failures.push(`Duplicate Tasker API controller remains: ${file}`);
}

const controllerFiles = sourceFiles.filter((path) => path.endsWith('controller.ts'));
const routes = new Map<string, string>();
const controllerPattern = /@Controller\(['"]([^'"]+)['"]\)/;
const routePattern = /@(Get|Post|Patch|Put|Delete)\((?:['"]([^'"]*)['"])?\)/g;
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
  'POST /api/bookings/:bookingId/cash-payment/confirm',
  'GET /api/conversations',
  'GET /api/conversations/capabilities',
  'GET /api/conversations/:bookingId/calls',
  'GET /api/conversations/:bookingId/calls/:callId',
  'GET /api/conversations/capabilities',
  'GET /api/conversations/:bookingId/calls',
  'GET /api/conversations/:bookingId/calls/:callId',
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
  'DELETE /api/admin/customers/:id',
  'GET /api/admin/taskers',
  'GET /api/admin/taskers/pending-verification',
  'GET /api/admin/taskers/performance',
  'GET /api/admin/taskers/earnings',
  'POST /api/admin/taskers/:id/verification',
  'PATCH /api/admin/taskers/:id/status',
  'DELETE /api/admin/taskers/:id',
  'GET /api/admin/bookings',
  'GET /api/admin/bookings/:id',
  'POST /api/admin/bookings/:id/actions',
  'GET /api/admin/disputes',
  'GET /api/admin/disputes/:id',
  'GET /api/admin/finance',
  'POST /api/admin/finance/payouts/:id/actions',
  'POST /api/admin/finance/earnings/:id/actions',
  'GET /api/admin/platform-settings',
  'PUT /api/admin/platform-settings',
  'GET /api/platform/content',
  'POST /api/admin/disputes/:id/actions',
  'GET /api/disputes',
  'GET /api/disputes/:disputeId',
  'POST /api/bookings/:bookingId/disputes',
  'POST /api/disputes/:disputeId/evidence',
  'POST /api/disputes/:disputeId/actions',
  'POST /api/disputes/:disputeId/satisfaction',
  'GET /api/realtime/session',
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
  'GET /api/admin/services',
  'GET /api/admin/services/:serviceId',
  'GET /api/services',
  'GET /api/services/:serviceId',
  'POST /api/services',
  'PATCH /api/services/:serviceId',
  'DELETE /api/services/:serviceId',
  'POST /api/support/tickets',
  'GET /api/support/tickets',
  'GET /api/support/tickets/:id',
  'GET /api/support/tickets/:id/messages',
  'POST /api/support/tickets/:id/messages',
  'POST /api/support/tickets/:id/actions',
  'POST /api/support/tickets/:id/feedback',
  'GET /api/admin/support',
  'GET /api/admin/support/:id',
  'GET /api/admin/support/:id/messages',
  'POST /api/admin/support/:id/messages',
  'POST /api/admin/support/:id/actions',
  'GET /api/admin/reviews',
  'PATCH /api/admin/reviews/:reviewId/moderation',
  'GET /api/tasker-dashboard/wallet/earnings',
  'GET /api/tasker-dashboard/wallet/platform-payables',
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

const conversationCallsMigration = read(
  'prisma/migrations/20260812100000_add_conversation_calls/migration.sql',
);
for (const marker of [
  'CREATE TABLE "ConversationCalls"',
  'ConversationCalls_bookingId_fkey',
  'ConversationCalls_initiatorId_fkey',
  'ConversationCalls_recipientId_fkey',
  'conversation_calls_initiator_request_unique',
]) {
  if (!conversationCallsMigration.includes(marker))
    failures.push(`Conversation-call migration marker missing: ${marker}`);
}
if (/INSERT\s+INTO/i.test(conversationCallsMigration)) {
  failures.push('Conversation-call migration must not seed fake calls');
}

const realtimeCallConstants = read('src/modules/realtime/realtime.constants.ts');
for (const marker of [
  "'call:initiate'",
  "'call:accept'",
  "'call:reject'",
  "'call:cancel'",
  "'call:end'",
  "'call:offer'",
  "'call:answer'",
  "'call:ice_candidate'",
  "'call:incoming'",
  "'call:state'",
]) {
  if (!realtimeCallConstants.includes(marker))
    failures.push(`Realtime call event missing: ${marker}`);
}

const conversationUploadFolders = read('src/modules/uploads/dto/upload-folder.enum.ts');
if (!conversationUploadFolders.includes("ConversationAttachment = 'conversation-attachments'")) {
  failures.push('Conversation attachment upload folder is missing');
}
const conversationController = read('src/modules/conversations/conversations.controller.ts');
for (const marker of [
  "@Get('capabilities')",
  "@Get(':bookingId/calls')",
  "@Get(':bookingId/calls/:callId')",
]) {
  if (!conversationController.includes(marker))
    failures.push(`Conversation controller marker missing: ${marker}`);
}

const main = read('src/main.ts');
for (const marker of [
  "app.setGlobalPrefix('api')",
  "startsWith('/api/payments/webhooks/stripe')",
  "SwaggerModule.setup('api/docs'",
  ".setVersion('3.22.0')",
  '.addServer(',
  'RealtimeIoAdapter',
  'connectToRedis',
  'compression',
  'buildAllowedOrigins',
  'normalizeHttpOrigin',
]) {
  if (!main.includes(marker)) failures.push(`Bootstrap marker missing: ${marker}`);
}
if (main.includes("new Error('Origin is not allowed by CORS')")) {
  failures.push('CORS rejection must not abort same-origin Swagger/API requests');
}

const corsUtility = read('src/common/utils/cors.util.ts');
for (const marker of ['url.origin', "url.protocol !== 'http:'", 'apiBaseUrl']) {
  if (!corsUtility.includes(marker)) failures.push(`CORS utility marker missing: ${marker}`);
}

const emailLayout = read('src/modules/mail/email-layout.ts');
const mailService = read('src/modules/mail/mail.service.ts');
for (const marker of [
  'https://latache-web.vercel.app/images/logo-full.svg',
  'https://res.cloudinary.com/daflot6fo/image/upload/v1786533881/latache-email-header_hcqhvb.png',
  'https://res.cloudinary.com/daflot6fo/image/upload/v1786533881/latache-security-shield_oioyd1.png',
  'https://res.cloudinary.com/daflot6fo/image/upload/v1786533881/latache-email-footer_abofsj.png',
  'data-latache-email-shell="v1"',
  'align="center" alt=""',
  'background="${LATACHE_EMAIL_ASSETS.footer.url}"',
]) {
  if (!emailLayout.includes(marker)) failures.push(`Shared email design marker missing: ${marker}`);
}
if (emailLayout.includes('background:#efc58e')) {
  failures.push('Email footer must use the hosted footer image as its background, not a flat fill');
}
for (const marker of [
  "event: 'smtp_delivery_accepted'",
  'SMTP_RECIPIENT_NOT_ACCEPTED',
  'recipientDomain',
]) {
  if (!mailService.includes(marker)) failures.push(`SMTP delivery marker missing: ${marker}`);
}
if (!read('src/config/configuration.ts').includes("['en', 'ar', 'ary']")) {
  failures.push('English, Arabic, and Darija must be enabled by default');
}
for (const file of walk('src/modules/mail')) {
  if (/\.(html|hbs|ejs)$/i.test(file))
    failures.push(`Standalone mail template is forbidden: ${file}`);
}

const realtimeConstants = read('src/modules/realtime/realtime.constants.ts');
for (const marker of [
  "'call:initiate'",
  "'call:accept'",
  "'call:reject'",
  "'call:cancel'",
  "'call:end'",
  "'call:offer'",
  "'call:answer'",
  "'call:ice_candidate'",
  "'call:media_state'",
  "'call:incoming'",
  "'call:state'",
]) {
  if (!realtimeConstants.includes(marker)) failures.push(`Realtime call marker missing: ${marker}`);
}

const uploadFolders = read('src/modules/uploads/dto/upload-folder.enum.ts');
if (!uploadFolders.includes("ConversationAttachment = 'conversation-attachments'")) {
  failures.push('Conversation attachment upload folder is missing');
}

const callMigration = read('prisma/migrations/20260812100000_add_conversation_calls/migration.sql');
for (const marker of [
  'CREATE TABLE "ConversationCalls"',
  'conversation_calls_one_active_per_booking',
  'ConversationCalls_bookingId_fkey',
]) {
  if (!callMigration.includes(marker))
    failures.push(`Conversation-call migration marker missing: ${marker}`);
}

const migration = read(
  'prisma/migrations/20260807020000_add_customer_dashboard_and_stripe/migration.sql',
);
for (const marker of [
  'CREATE TABLE IF NOT EXISTS "PaymentTransactions"',
  'CREATE TABLE IF NOT EXISTS "StripeWebhookEvents"',
  'CREATE TABLE IF NOT EXISTS "FavoriteTaskers"',
]) {
  if (!migration.includes(marker)) failures.push(`Customer migration marker missing: ${marker}`);
}

const taskerFinanceMigration = read(
  'prisma/migrations/20260812143000_add_tasker_earning_clearance_cash_accounting/migration.sql',
);
for (const marker of [
  'CREATE TABLE "TaskerEarnings"',
  'CREATE TABLE "TaskerPlatformAccounts"',
  'CREATE TABLE "TaskerPlatformReceivables"',
  'CREATE TABLE "TaskerPlatformLedger"',
  'tasker_earnings_release_queue_idx',
  'TaskerPlatformLedger_idempotencyKey_key',
]) {
  if (!taskerFinanceMigration.includes(marker))
    failures.push(`Tasker-finance migration marker missing: ${marker}`);
}

const permanentDeletionMigration = read(
  'prisma/migrations/20260812233000_add_permanent_deletion_controls/migration.sql',
);
for (const marker of [
  'CREATE TABLE "ObjectStorageDeletionTasks"',
  'storage_deletion_provider_public_resource_unique',
  "'customers.delete'",
  "'taskers.delete'",
]) {
  if (!permanentDeletionMigration.includes(marker))
    failures.push(`Permanent-deletion migration marker missing: ${marker}`);
}
const accountDeletionService = read('src/modules/account-deletion/account-deletion.service.ts');
for (const marker of [
  'ACCOUNT_PURGE_BLOCKED',
  'FOR UPDATE',
  'account_permanently_deleted',
  'this.storage.enqueue',
]) {
  if (!accountDeletionService.includes(marker))
    failures.push(`Permanent-deletion safety marker missing: ${marker}`);
}
if (/INSERT\s+INTO/i.test(taskerFinanceMigration)) {
  failures.push('Tasker-finance migration must not seed fake operational or financial records');
}

const taskerFinanceService = read('src/modules/tasker-finance/tasker-finance.service.ts');
for (const marker of [
  'createPendingEarning',
  'confirmCashCollection',
  'releaseMatureEarning',
  'applyRefundAdjustment',
  'FOR UPDATE',
  'EarningDebtOffset',
]) {
  if (!taskerFinanceService.includes(marker))
    failures.push(`Tasker-finance runtime marker missing: ${marker}`);
}

const adminMigration = read(
  'prisma/migrations/20260808090000_add_admin_dashboard_foundation/migration.sql',
);
for (const marker of [
  'CREATE TABLE "AdminAuditLogs"',
  'AdminAuditLogs_actorId_fkey',
  'AdminAuditLogs_targetUserId_fkey',
]) {
  if (!adminMigration.includes(marker))
    failures.push(`Admin dashboard migration marker missing: ${marker}`);
}

const eliteMigration = read(
  'prisma/migrations/20260810070000_add_elite_tasker_program/migration.sql',
);
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
  if (!eliteMigration.includes(marker))
    failures.push(`Elite Program migration marker missing: ${marker}`);
}

const eliteController = read(
  'src/modules/elite-program/controllers/admin-elite-taskers.controller.ts',
);
for (const marker of [
  "@Permissions('elite.read')",
  "@Permissions('elite.manage')",
  'view=members, applications, upgrade_requests, or downgrade_requests',
  'trackingAvailable=false',
]) {
  if (!eliteController.includes(marker))
    failures.push(`Elite controller marker missing: ${marker}`);
}

const eliteModule = read('src/modules/elite-program/elite-program.module.ts');
for (const marker of [
  'AuthModule',
  'AdminAuditModule',
  'NotificationsModule',
  'EliteProgramService',
]) {
  if (!eliteModule.includes(marker))
    failures.push(`Elite module dependency marker missing: ${marker}`);
}

const permissionCatalog = read('src/modules/rbac/constants/permission-catalog.ts');
for (const marker of [
  "key: 'elite.read'",
  "key: 'elite.manage'",
  "key: 'settings.read'",
  "key: 'settings.manage'",
]) {
  if (!permissionCatalog.includes(marker)) failures.push(`Elite RBAC marker missing: ${marker}`);
}

if (routes.has('GET /api/admin/dashboard/elite-taskers')) {
  failures.push(
    'Deprecated duplicate Elite analytics route remains: GET /api/admin/dashboard/elite-taskers',
  );
}

const rbacController = read('src/modules/rbac/controllers/rbac.controller.ts');
for (const marker of [
  "@Patch('admins/:id')",
  "@Delete('admins/:id')",
  "@Permissions('admins.update')",
  "@Permissions('admins.delete')",
]) {
  if (!rbacController.includes(marker))
    failures.push(`Administrator-management marker missing: ${marker}`);
}

const taskerAdmin = read('src/modules/admin-dashboard/services/admin-taskers.service.ts');
for (const marker of [
  "{ in: ['submitted', 'pending_review'] }",
  'Tasker is not currently awaiting administrator verification',
  'backgroundCheck: null',
  'insuranceVerification: null',
]) {
  if (!taskerAdmin.includes(marker)) failures.push(`Tasker admin-flow marker missing: ${marker}`);
}

const bookingDisputeMigration = read(
  'prisma/migrations/20260810130000_add_booking_dispute_management/migration.sql',
);
for (const marker of [
  'ALTER TABLE "TaskComplaints"',
  'CREATE TABLE "DisputeEvidence"',
  'CREATE TABLE "DisputeEvidenceRequests"',
  'CREATE TABLE "DisputeResolutions"',
  'DisputeResolutions_refundTransactionId_key',
  "evidenceReviewStatus\" VARCHAR(32) NOT NULL DEFAULT 'not_required'",
]) {
  if (!bookingDisputeMigration.includes(marker))
    failures.push(`Booking/dispute migration marker missing: ${marker}`);
}
if (/INSERT\s+INTO/i.test(bookingDisputeMigration)) {
  failures.push('Booking/dispute migration must not seed fake operational or financial rows');
}

const disputeHardeningMigration = read(
  'prisma/migrations/20260818190000_harden_dispute_lifecycle/migration.sql',
);
for (const marker of [
  'TaskComplaints_activeBookingKey_key',
  'task_complaints_filer_client_request_unique',
  'CREATE TABLE "DisputeParticipantActions"',
  'CREATE TABLE "DisputeComments"',
  'CREATE TABLE "DisputeSatisfactionSurveys"',
  'CREATE TABLE "DisputeDeliveries"',
  'CREATE TABLE "DisputeCashRefunds"',
  'CREATE TABLE "DisciplinaryActions"',
  'CREATE TABLE "StripeChargebacks"',
]) {
  if (!disputeHardeningMigration.includes(marker))
    failures.push(`Dispute hardening migration marker missing: ${marker}`);
}
if (/\b(?:DROP|TRUNCATE)\b/i.test(disputeHardeningMigration)) {
  failures.push('Dispute hardening migration must remain additive and non-destructive');
}
if (/INSERT\s+INTO/i.test(disputeHardeningMigration)) {
  failures.push('Dispute hardening migration must not seed operational or financial rows');
}

const adminDashboardModule = read('src/modules/admin-dashboard/admin-dashboard.module.ts');
for (const marker of [
  'PaymentsModule',
  'AdminBookingsController',
  'AdminDisputesController',
  'AdminBookingsService',
  'AdminDisputesService',
]) {
  if (!adminDashboardModule.includes(marker))
    failures.push(`Admin booking/dispute module marker missing: ${marker}`);
}

const adminBookingsController = read(
  'src/modules/admin-dashboard/controllers/admin-bookings.controller.ts',
);
for (const marker of [
  "@Permissions('bookings.read')",
  "@Permissions('bookings.manage')",
  'format=csv',
]) {
  if (!adminBookingsController.includes(marker))
    failures.push(`Admin bookings controller marker missing: ${marker}`);
}
const adminBookingsService = read('src/modules/admin-dashboard/services/admin-bookings.service.ts');
for (const marker of [
  'reports.read',
  'Resolve active booking disputes before administrative cancellation',
  'A settled booking must be handled through dispute/refund resolution',
]) {
  if (!adminBookingsService.includes(marker))
    failures.push(`Admin bookings service marker missing: ${marker}`);
}

const adminDisputesController = read(
  'src/modules/admin-dashboard/controllers/admin-disputes.controller.ts',
);
for (const marker of [
  "@Permissions('support.read')",
  "@Permissions('support.manage')",
  'Refund resolution types additionally require finance.manage',
]) {
  if (!adminDisputesController.includes(marker))
    failures.push(`Admin disputes controller marker missing: ${marker}`);
}
const adminDisputesService = read('src/modules/admin-dashboard/services/admin-disputes.service.ts');
for (const marker of [
  'finance.manage',
  'A refund resolution is already processing for this dispute',
  'trackingAvailable: true',
  "status: 'processing'",
  'requestEvidence',
  'reviewEvidence',
  'proposeResolution',
  'confirmCashRefund',
  'pending_manual_transfer',
]) {
  if (!adminDisputesService.includes(marker))
    failures.push(`Admin disputes service marker missing: ${marker}`);
}

const paymentsService = read('src/modules/payments/payments.service.ts');
for (const marker of [
  'issueDisputeRefund',
  "event.type === 'refund.created'",
  "event.type === 'refund.updated'",
  "event.type === 'refund.failed'",
  "event.type === 'charge.dispute.created'",
  "event.type === 'charge.dispute.updated'",
  "event.type === 'charge.dispute.closed'",
  'confirmManualCashDisputeRefund',
  'applyTaskerRefundClawback',
  'PartiallyRefunded',
  'Refunded',
]) {
  if (!paymentsService.includes(marker)) failures.push(`Dispute payment marker missing: ${marker}`);
}

const participantDisputesController = read(
  'src/modules/bookings/participant-disputes.controller.ts',
);
for (const marker of [
  "@Get('disputes')",
  "@Get('disputes/:disputeId')",
  "@Post('bookings/:bookingId/disputes')",
  "@Post('disputes/:disputeId/evidence')",
  "@Post('disputes/:disputeId/actions')",
  "@Post('disputes/:disputeId/satisfaction')",
]) {
  if (!participantDisputesController.includes(marker))
    failures.push(`Participant dispute route marker missing: ${marker}`);
}
const bookingService = read('src/modules/bookings/bookings.service.ts');
for (const marker of [
  'this.disputes.verifyEvidence',
  'activeBookingKey',
  'clientRequestKey',
  'disputeEvidenceRequest.updateMany',
]) {
  if (!bookingService.includes(marker))
    failures.push(`Participant evidence-flow marker missing: ${marker}`);
}

if (routes.has('GET /api/admin/customers/bookings')) {
  failures.push(
    'Semantic duplicate admin-wide booking route remains: GET /api/admin/customers/bookings',
  );
}

const financeSettingsMigration = read(
  'prisma/migrations/20260810173000_add_finance_platform_settings/migration.sql',
);
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
  if (!financeSettingsMigration.includes(marker))
    failures.push(`Finance/settings migration marker missing: ${marker}`);
}
if (
  /INSERT\s+INTO\s+"(?:PaymentTransactions|TaskerWithdrawals|CustomerWalletLedger|TaskerWalletLedger|DisputeResolutions)"/i.test(
    financeSettingsMigration,
  )
) {
  failures.push('Finance/settings migration must not seed operational financial records');
}

const adminFinanceController = read(
  'src/modules/admin-finance/controllers/admin-finance.controller.ts',
);
for (const marker of [
  "@Controller('admin/finance')",
  "@Permissions('finance.read')",
  "@Permissions('finance.manage')",
  'reports.read is required for finance CSV exports',
  'No provider transfer is fabricated',
]) {
  if (!adminFinanceController.includes(marker))
    failures.push(`Admin finance marker missing: ${marker}`);
}

const platformSettingsController = read(
  'src/modules/platform-settings/platform-settings.controller.ts',
);
for (const marker of [
  "@Controller('admin/platform-settings')",
  "@Permissions('settings.read')",
  "@Permissions('settings.manage')",
  'Referral programs are disabled by default',
]) {
  if (!platformSettingsController.includes(marker))
    failures.push(`Platform settings marker missing: ${marker}`);
}

const platformSettingsService = read('src/modules/platform-settings/platform-settings.service.ts');
for (const marker of [
  'calculatePricingCharges',
  'assertBookingRules',
  'serviceRadiusPolicy',
  'referralPolicy',
  'referralRewardEngineAvailable: true',
  'Multi-currency settlement is not enabled',
]) {
  if (!platformSettingsService.includes(marker))
    failures.push(`Platform settings runtime marker missing: ${marker}`);
}

const servicesSupportMigration = read(
  'prisma/migrations/20260810190000_add_services_support_center/migration.sql',
);
for (const marker of [
  'ADD COLUMN IF NOT EXISTS "isActive"',
  'ADD COLUMN IF NOT EXISTS "sortOrder"',
  'CREATE TABLE IF NOT EXISTS "SupportTickets"',
  'CREATE TABLE IF NOT EXISTS "SupportTicketMessages"',
  'SupportTickets_userId_fkey',
  'SupportTicketMessages_ticketId_fkey',
]) {
  if (!servicesSupportMigration.includes(marker))
    failures.push(`Service/support migration marker missing: ${marker}`);
}
if (/INSERT\s+INTO\s+"(?:SupportTickets|SupportTicketMessages)"/i.test(servicesSupportMigration)) {
  failures.push('Service/support migration must not seed fake operational support records');
}

const supportController = read('src/modules/support/support.controller.ts');
for (const marker of [
  "@Controller('support/tickets')",
  'channel=ticket creates an asynchronous case',
  'folder=support-attachments',
  'No satisfaction percentage is fabricated',
]) {
  if (!supportController.includes(marker))
    failures.push(`Support participant marker missing: ${marker}`);
}

const adminSupportController = read('src/modules/support/admin-support.controller.ts');
for (const marker of [
  "@Controller('admin/support')",
  "@Permissions('support.read')",
  "@Permissions('support.manage')",
  'Financial refunds/payout settlement are deliberately not executed here',
  'reports.read is required for Support Center CSV exports',
]) {
  if (!adminSupportController.includes(marker))
    failures.push(`Admin Support Center marker missing: ${marker}`);
}

const adminServicesController = read(
  'src/modules/admin-services/controllers/admin-services.controller.ts',
);
for (const marker of [
  "@Controller('admin/services')",
  "@Permissions('services.read')",
  'view=catalog',
  'view=pricing',
  '/api/admin/platform-settings',
  'settings.read is required for the Service Management pricing view',
]) {
  if (!adminServicesController.includes(marker))
    failures.push(`Admin Service Management marker missing: ${marker}`);
}

const serviceCode = read('src/modules/services/services.service.ts');
for (const marker of [
  'service_category_permanently_deleted',
  'service_option_permanently_deleted',
  'isActive: true',
]) {
  if (!serviceCode.includes(marker))
    failures.push(`Service catalogue runtime marker missing: ${marker}`);
}

const uploadFolderEnum = read('src/modules/uploads/dto/upload-folder.enum.ts');
if (!uploadFolderEnum.includes("SupportAttachment = 'support-attachments'")) {
  failures.push('Support attachment Cloudinary folder is not registered');
}
const bookingRuntime = read('src/modules/bookings/bookings.service.ts');
if (!bookingRuntime.includes('where: { slug: serviceSlug, isActive: true }')) {
  failures.push('Booking quote must reject inactive service categories');
}
for (const marker of [
  'standardMinTaskPrice',
  'goldMinTaskPrice',
  'platinumMinTaskPrice',
  'diamondMinTaskPrice',
]) {
  if (!platformSettingsService.includes(marker))
    failures.push(`Tier minimum-price runtime marker missing: ${marker}`);
}

const realtimeMigration = read(
  'prisma/migrations/20260810193000_add_realtime_outbox/migration.sql',
);
for (const marker of [
  'CREATE TABLE "RealtimeOutboxEvents"',
  'realtime_outbox_pending_idx',
  'realtime_outbox_room_created_idx',
]) {
  if (!realtimeMigration.includes(marker))
    failures.push(`Realtime outbox migration marker missing: ${marker}`);
}
if (/INSERT\s+INTO/i.test(realtimeMigration))
  failures.push('Realtime migration must not seed fake events');

const realtimeGateway = read('src/modules/realtime/realtime.gateway.ts');
for (const marker of [
  '@WebSocketGateway',
  "@SubscribeMessage('booking:subscribe')",
  "@SubscribeMessage('conversation:typing')",
  "@SubscribeMessage('support:typing')",
  'findActiveById',
]) {
  if (!realtimeGateway.includes(marker))
    failures.push(`Realtime gateway marker missing: ${marker}`);
}
const notificationsService = read('src/modules/notifications/notifications.service.ts');
const conversationsService = read('src/modules/conversations/conversations.service.ts');
for (const marker of ['notification:created', 'notification:read', 'notifications:read_all']) {
  if (!notificationsService.includes(marker))
    failures.push(`Realtime notification marker missing: ${marker}`);
}
for (const marker of ['conversation:message', 'conversation:read']) {
  if (!conversationsService.includes(marker))
    failures.push(`Realtime conversation marker missing: ${marker}`);
}
const productionChatMigration = read(
  'prisma/migrations/20260818130000_complete_production_chat_system/migration.sql',
);
for (const marker of [
  'conversationLastMessageAt',
  'task_messages_sender_client_message_unique',
  'support_tickets_user_client_request_unique',
  'support_ticket_messages_sender_client_message_unique',
  'support_ticket_messages_audience_unread_idx',
]) {
  if (!productionChatMigration.includes(marker)) {
    failures.push(`Production-chat migration marker missing: ${marker}`);
  }
}
if (/\b(DROP|TRUNCATE|DELETE\s+FROM)\b/i.test(productionChatMigration)) {
  failures.push('Production-chat migration contains a destructive data statement');
}
const referralMigration = read(
  'prisma/migrations/20260818140000_complete_referral_reward_system/migration.sql',
);
for (const marker of [
  'CREATE TABLE "Referrals"',
  'CREATE TABLE "ReferralRewards"',
  'Referrals_distinct_users_check',
  'ReferralRewards_amounts_check',
  'referral_rewards_release_queue_idx',
]) {
  if (!referralMigration.includes(marker)) {
    failures.push(`Referral migration marker missing: ${marker}`);
  }
}
if (/\b(DROP|TRUNCATE|DELETE\s+FROM)\b/i.test(referralMigration)) {
  failures.push('Referral migration contains a destructive data statement');
}
const referralsService = read('src/modules/referrals/services/referrals.service.ts');
for (const marker of [
  'reserveCustomerDiscount',
  'qualifyPaidBooking',
  'handleBookingRefund',
  'releaseMatureRewards',
  'REFERRAL_WALLET_ENTRY_KIND.Reversal',
]) {
  if (!referralsService.includes(marker))
    failures.push(`Referral runtime marker missing: ${marker}`);
}
const productionChatSupportController = read('src/modules/support/support.controller.ts');
const productionChatAdminSupportController = read(
  'src/modules/support/admin-support.controller.ts',
);
const supportService = read('src/modules/support/support.service.ts');
for (const marker of ["@Get('capabilities')", "@Get('unread-count')", "@Post(':id/read')"]) {
  if (!productionChatSupportController.includes(marker)) {
    failures.push(`Participant support-chat marker missing: ${marker}`);
  }
}
if (!productionChatAdminSupportController.includes("@Post(':id/read')")) {
  failures.push('Admin support read-receipt route is missing');
}
for (const marker of [
  'verifySupportAttachments',
  'CLIENT_REQUEST_ID_REUSED',
  'CLIENT_MESSAGE_ID_REUSED',
  'markSupportMessagesRead',
]) {
  if (!supportService.includes(marker)) failures.push(`Support-chat marker missing: ${marker}`);
}
const reviewsService = read('src/modules/reviews/reviews.service.ts');
if (!reviewsService.includes("type: 'review_received'"))
  failures.push('Review creation must create a persisted notification');
if (
  !realtimeGateway.includes(
    'if (participant) await client.join(realtimeRoom.conversation(bookingId));',
  )
) {
  failures.push('Booking participants must join the private conversation room explicitly');
}
const adminBookingsRuntime = read('src/modules/admin-dashboard/services/admin-bookings.service.ts');
if (!adminBookingsRuntime.includes("'booking:updated'"))
  failures.push('Admin booking cancellation must publish a booking realtime event');
const reviewMigration = read(
  'prisma/migrations/20260810194500_add_review_moderation/migration.sql',
);
for (const marker of [
  'moderationStatus',
  'Reviews_moderatedById_fkey',
  'reviews.read',
  'reviews.manage',
]) {
  if (!reviewMigration.includes(marker))
    failures.push(`Review moderation migration marker missing: ${marker}`);
}
for (const marker of ["key: 'reviews.read'", "key: 'reviews.manage'"]) {
  if (!permissionCatalog.includes(marker)) failures.push(`Review RBAC marker missing: ${marker}`);
}
for (const deprecatedRoute of [
  'GET /api/services/get-services',
  'POST /api/services/add-service',
  'GET /api/bookings/:bookingId/complaints',
  'POST /api/bookings/:bookingId/complaints',
  'POST /api/bookings/:bookingId/complaints/:complaintId/evidence',
]) {
  if (routes.has(deprecatedRoute))
    failures.push(`Deprecated semantic API route remains: ${deprecatedRoute}`);
}

if (failures.length > 0) {
  console.error(`Static verification failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Static verification passed. ${routes.size} unique API routes found.`);
