import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // A local fallback lets `npm install` generate the client before `.env` exists.
    // Runtime environment validation still requires DATABASE_URL outside unit tests.
    url:
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5432/latache?schema=public',
  },
});
