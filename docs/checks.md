# Verification checks

`npm run verify:static` validates:

- Additive multilingual migration, locale-row models, canonical resource reuse, and absence of language-specific columns.
- Unified profile preference, localized catalogue, template-backed notification, email, and platform-content surfaces.

- Prisma, PostgreSQL and Nodemailer dependency policy.
- Six mapped domain tables and required auth-expansion migration.
- TypeScript-only runtime/source policy.
- Absence of standalone HTML templates.
- Canonical auth controller routes and explicit absence of every removed alias.
- Role-specific signup DTOs, exactly three tasker services, active-session bearer checks and super-admin seed defaults.
- Global `/api` prefix and the unaffected services, taskers and bookings route surface.
- Tasker dashboard route inventory and Tasker-only guards.
- Additive Tasker dashboard migration/table markers and payout-PIN persistence.
- No seeded/demo financial values in the Tasker migration or seed.
- Wallet settlement is internal-only, idempotent, wallet-locked and does not run from task completion.
- Withdrawal idempotency is scoped per Tasker and manual mode never reports provider success.

Dependency-aware checks:

```bash
npm run prisma:validate
npm run build
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

The booking concurrency e2e suite needs a dedicated migrated PostgreSQL test database.
