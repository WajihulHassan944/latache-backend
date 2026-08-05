# Migration decisions

- NestJS with strict TypeScript replaces the CommonJS Express runtime.
- Prisma ORM replaces Sequelize and `@nestjs/sequelize`.
- PostgreSQL remains the database; table and column names are mapped exactly.
- Prisma 7 uses `prisma.config.ts`, the `prisma-client` generator, CommonJS output for the Nest build, and `@prisma/adapter-pg`.
- A single baseline migration represents the final historical schema. Fresh databases apply it. Existing databases mark it applied only after schema comparison and backup verification.
- Nodemailer SMTP replaces the Resend SDK. SMTP configuration is provider-neutral and supports authenticated providers or unauthenticated local relays such as Mailpit.
- Route paths, successful response fields, public string IDs, pagination defaults, role values, pricing behavior, and timezone defaults remain compatible.
- Prisma migrations are the only supported schema mutation mechanism. `prisma migrate reset` is prohibited for existing or production databases.
- Generated Prisma files, dependencies, build output, environment files, and credentials are excluded from the distributed archive.
