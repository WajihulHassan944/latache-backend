# Verification checks

`npm run verify:static` validates:

- Prisma, PostgreSQL and Nodemailer dependency policy.
- Six mapped domain tables and required auth-expansion migration.
- TypeScript-only runtime/source policy.
- Absence of standalone HTML templates.
- Canonical auth controller routes and explicit absence of every removed alias.
- Role-specific signup DTOs, exactly three tasker services, active-session bearer checks and super-admin seed defaults.
- Global `/api` prefix and the unaffected services, taskers and bookings route surface.

Dependency-aware checks:

```bash
npm run prisma:validate
npm run build
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

The booking concurrency e2e suite needs a dedicated migrated PostgreSQL test database.
