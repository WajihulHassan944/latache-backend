# Latache Backend — NestJS, Prisma and Nodemailer

Latache backend implemented with NestJS 11, strict TypeScript, Prisma/PostgreSQL and Nodemailer SMTP. Version 3.2 focuses on the authentication domain: role-specific registration, OTP verification and recovery, active-session enforcement, super-admin-controlled administrator creation, RBAC, and complete Swagger documentation.

## Requirements

- Node.js 22.12+
- npm 10+
- PostgreSQL 14+ or Neon PostgreSQL
- SMTP credentials, or Mailpit for local development

## Install and run

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:seed
npm run start:dev
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
npm install
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:seed
npm run start:dev
```

Endpoints:

- API: `http://localhost:8080/api`
- Swagger UI: `http://localhost:8080/api/docs`
- OpenAPI JSON: `http://localhost:8080/api/docs-json`
- Health: `GET http://localhost:8080/api/health`

Swagger is enabled when `SWAGGER_ENABLED=true`.

## Required environment configuration

```env
DATABASE_URL=postgresql://latache:latache@localhost:5432/latache?schema=public
JWT_SECRET=<random-secret-at-least-32-characters>
JWT_SECRET_ADMIN=<different-random-secret-at-least-32-characters>
CORS_ORIGINS=http://localhost:3000

SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=Latache <no-reply@latache.local>

OTP_EXPIRES_IN_MINUTES=5
PASSWORD_RESET_OTP_EXPIRES_IN_MINUTES=15
```

Use `SMTP_SECURE=true` for implicit TLS on port 465. Use `SMTP_SECURE=false` for port 587 so Nodemailer can negotiate STARTTLS.

## Neon PostgreSQL

Keep Neon credentials only in `.env` or the deployment secret manager:

```env
DATABASE_URL=postgresql://neondb_owner:YOUR_PASSWORD@YOUR_NEON_HOST/neondb?sslmode=require
```

For a pooled runtime connection, set the direct migration connection separately:

```env
DATABASE_URL=postgresql://USER:PASSWORD@YOUR_POOLER_HOST/neondb?sslmode=require
DIRECT_URL=postgresql://USER:PASSWORD@YOUR_DIRECT_HOST/neondb?sslmode=require
```

`prisma.config.ts` prefers `DIRECT_URL` for CLI migrations and otherwise uses `DATABASE_URL`.

## Gmail SMTP

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-account@gmail.com
SMTP_PASSWORD=your-google-app-password
SMTP_FROM=Latache <your-account@gmail.com>
SMTP_VERIFY_ON_BOOTSTRAP=true
```

Use a Google App Password rather than the normal Gmail password.

## Existing Latache database

Never run `prisma migrate reset` on an existing database. Take a verified backup first.

When the old schema already exists but the Prisma baseline has not been recorded:

```bash
npm run prisma:generate
npx prisma migrate resolve --applied 20260805000000_baseline
npm run prisma:migrate:status
npm run prisma:migrate:deploy
npm run prisma:seed
npm run start:dev
```

The additive `20260805002000_revamp_auth_module` migration adds auth governance, OTP-attempt, consent, session metadata and administrator fields without recreating existing domain tables.

## Canonical auth API

Only the following auth routes are exposed:

| Method | Route | Access |
|---|---|---|
| POST | `/api/auth/customers/register` | Public |
| POST | `/api/auth/taskers/register` | Public |
| POST | `/api/auth/admins/register` | Super admin |
| POST | `/api/auth/login` | Public |
| POST | `/api/auth/refresh` | Public with refresh token |
| POST | `/api/auth/verify-email` | Registration bearer session |
| POST | `/api/auth/resend-verification-email` | Public |
| POST | `/api/auth/forgot-password` | Public |
| POST | `/api/auth/verify-reset-otp` | Public |
| POST | `/api/auth/reset-password` | Public |
| PATCH | `/api/auth/change-password` | Verified bearer session |
| GET | `/api/auth/me` | Verified bearer session |
| PATCH | `/api/auth/me` | Verified bearer session |
| GET | `/api/auth/sessions` | Verified bearer session |
| DELETE | `/api/auth/sessions/:id` | Verified bearer session |
| POST | `/api/auth/logout` | Verified bearer session |
| POST | `/api/auth/sessions/logout-all` | Verified bearer session |

Old aliases such as `sign-up`, `refresh-token`, `verify-otp`, `resend-otp`, `verify-pass-token`, `verify-forgot-password`, `get-loggedin-user`, `verify-token`, and `logout-all` are intentionally not registered.

## Role model

- `super_admin`: seeded canonical platform owner with all administrator permissions.
- `admin`: created only by the super admin and assigned an administrator role/permission set.
- `customer`: standard booking account.
- `tasker`: seven-step application account; email verification moves it to pending approval.

See `docs/auth-module.md` for request fields, states, permissions, sessions and security behavior.

## Super-admin seed

Running `npm run prisma:seed` upserts and resets the canonical account to:

```text
Email:    latache.superadmin@yopmail.com
Password: Admin@12345
```

The values can be overridden with `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD`. Because the seed deliberately reapplies the password, use a secure environment override in staging/production and do not run the seed as part of every application restart.

## Docker development stack

```bash
docker compose --env-file .env up --build
```

Services:

- PostgreSQL: `localhost:5432`
- Mailpit SMTP: `localhost:1025`
- Mailpit inbox: `http://localhost:8025`
- API: `http://localhost:8080/api`

## Verification

```bash
npm run verify:static
npm run prisma:validate
npm run build
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

The generated Prisma client, `node_modules`, `.env`, `dist`, and coverage output are intentionally excluded from release archives.
