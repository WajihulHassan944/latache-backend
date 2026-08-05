# Verification

The repository provides these checks:

```bash
npm run verify:static
npm run prisma:validate
npm run build
npm run lint
npm test -- --runInBand
npm run test:cov -- --runInBand
npm run test:e2e -- --runInBand
npm audit --omit=dev
```

`verify:static` validates the Prisma/Nodemailer dependency policy, six-table schema baseline, TypeScript source policy, required files, global `/api` prefix, four controller prefixes, and all 22 legacy routes.

The booking e2e suite uses a real PostgreSQL database and requires exactly one success and one conflict when two requests target one availability slot.

The packaging process also verifies ZIP CRC, extracts the archive into a clean directory, compares every extracted file hash to the source tree, and rejects empty or excluded artifacts such as `.env`, `node_modules`, `dist`, generated clients, coverage, and Git metadata.
