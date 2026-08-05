# Architecture

## Stack

NestJS 11 runs on the Express adapter with strict TypeScript. Prisma 7 owns data access through the PostgreSQL driver adapter, and Nodemailer owns SMTP delivery. The generated Prisma client is written to `src/generated/prisma` during installation/build and is not committed.

## Modules

- `AuthModule`: local signup, OTP verification, login, access tokens, rotating refresh sessions, logout, and password reset.
- `UsersModule`: centralized Prisma user lookup and mutation behavior.
- `MailModule`: typed Nodemailer SMTP transport, connection verification, plaintext alternatives, and escaped HTML templates.
- `ServicesModule`: service pagination/search and administrator-only creation.
- `TaskersModule`: onboarding, per-service pricing, availability, geospatial discovery, and profiles.
- `BookingsModule`: transactional slot reservation and booking queries.
- `HealthModule`: Prisma-backed PostgreSQL readiness.

## Persistence

`prisma/schema.prisma` maps the existing `Users`, `Services`, `RefreshTokens`, `UserServices`, `UserAvailabilities`, and `Bookings` tables. JSONB, PostgreSQL arrays, decimals, date-only fields, constraints, and operational indexes are represented explicitly. No automatic schema synchronization is enabled.

PostgreSQL-specific discovery remains isolated in `TaskersRepository` and uses Prisma SQL templates with parameterized values. Only allowlisted order expressions are emitted as raw SQL.

## Transaction boundaries

- Refresh rotation locks the stored token before inserting its replacement and revoking the presented token.
- Password reset locks the user, changes the password, consumes reset state, and revokes active sessions atomically.
- Tasker onboarding locks the tasker and availability rows, preserves booking-linked/history rows, and replaces only safe future slots.
- Booking locks eligible availability rows, conditionally claims one slot, and creates the booking in the same transaction.

## HTTP bootstrap

The API uses `/api`, Helmet, exact-origin CORS, body-size limits, global DTO transformation and whitelisting, throttling, a consistent exception filter, Swagger, and graceful shutdown hooks.
