# Latache Backend — NestJS + Prisma + Nodemailer

Production-oriented migration of the Latache Express backend to NestJS 11, strict TypeScript, Prisma ORM, PostgreSQL, and Nodemailer SMTP. The project preserves all 22 legacy `/api` routes and the existing six-table PostgreSQL model while retaining the authentication, tasker, service, and booking corrections made during the NestJS migration.

## Requirements

- Node.js 22.12+
- npm 10+
- PostgreSQL 14+
- SMTP credentials, or Mailpit for local development

## Fresh database: run locally

```bash
npm install
cp .env.example .env
# Edit .env before starting the API.
npm run prisma:migrate:deploy
npm run prisma:seed
npm run start:dev
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Endpoints:

- API: `http://localhost:8080/api`
- Swagger: `http://localhost:8080/api/docs` when enabled
- Health: `GET http://localhost:8080/api/health`

The important environment variables are:

```env
DATABASE_URL=postgresql://latache:latache@localhost:5432/latache?schema=public
JWT_SECRET=<independent-secret-at-least-32-characters>
JWT_SECRET_ADMIN=<different-secret-at-least-32-characters>
PASSWORD_RESET_JWT_SECRET=<third-secret-at-least-32-characters>
FRONTEND_BASE_URL=http://localhost:3000
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=Latache <no-reply@latache.local>
```

Use `SMTP_SECURE=true` for implicit TLS on port 465. Use `SMTP_SECURE=false` for port 587 so Nodemailer can upgrade with STARTTLS when the server supports it.

## Existing Sequelize-managed Latache database

Do not run `prisma migrate reset`. First take and verify a backup. Compare the existing schema with `prisma/migrations/20260805000000_baseline/migration.sql`, then baseline it:

```bash
npm install
cp .env.example .env
# Configure DATABASE_URL for the existing database.
npm run prisma:generate
npx prisma migrate resolve --applied 20260805000000_baseline
npm run prisma:migrate:status
npm run prisma:migrate:deploy
npm run start:dev
```

Do not run `npm run prisma:seed` when the existing `Services` table already contains the catalogue. The old `SequelizeMeta` table may remain temporarily; Prisma uses `_prisma_migrations` and does not depend on it.

## Docker development stack

Create `.env`, replace all JWT/reset placeholders, then run:

```bash
docker compose --env-file .env up --build
```

Services:

- PostgreSQL: `localhost:5432`
- Mailpit SMTP: `localhost:1025`
- Mailpit inbox: `http://localhost:8025`
- API: `http://localhost:8080/api`

The API container applies pending Prisma migrations before booting. Seed a fresh Docker database once:

```bash
docker compose --env-file .env run --rm api npm run prisma:seed
```

## Production

```bash
npm ci
npm run prisma:generate
npm run build
npm run prisma:migrate:deploy
npm run start:prod
```

Run migrations as a controlled release step, use independent secrets, set exact CORS origins, use a verified SMTP sender, keep query-string token compatibility disabled, and back up the database before every schema release.

## Commands

```bash
npm run prisma:generate
npm run prisma:validate
npm run prisma:migrate:dev
npm run prisma:migrate:deploy
npm run prisma:migrate:status
npm run prisma:seed
npm run prisma:studio
npm run start:dev
npm run build
npm run lint
npm test
npm run test:cov
npm run test:e2e
npm run verify:static
npm run verify
```

The e2e concurrency test requires a dedicated migrated PostgreSQL test database and verifies that two simultaneous requests cannot book the same availability slot.

## Architecture

- `AuthModule`: OTP, access/refresh tokens, logout, and secure password reset
- `UsersModule`: Prisma-based user persistence
- `MailModule`: pooled Nodemailer SMTP transport and escaped HTML templates
- `ServicesModule`: paginated catalogue and administrator-only creation
- `TaskersModule`: onboarding, pricing, availability, profiles, and geospatial search
- `BookingsModule`: locked slot claims and viewer-relative booking lists
- `HealthModule`: Prisma-backed database readiness

Prisma schema synchronization is not used. All schema changes are migration-driven. The generated Prisma client is intentionally excluded from the archive and is created by `npm install`/`npm run prisma:generate`.

See `docs/` for API compatibility, migration decisions, security fixes, and verification details.
