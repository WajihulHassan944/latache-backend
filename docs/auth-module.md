# Latache authentication module 3.4

The auth bounded context follows the supplied Gift App reference where it improves separation of concerns, while keeping Latache-specific signup fields and roles. Registration, login/token rotation, OTP/password operations, profile access, and session management are separate services behind a thin controller facade.

## Roles and administrator governance

- `super_admin`: one canonical platform owner; can create administrators and bypasses individual permission checks.
- `admin`: platform administrator with an `adminRole`, permission list, creator, status, and temporary-password flag.
- `customer`: standard Latache customer.
- `tasker`: service provider applicant.

Administrator roles are stored in the `RbacRoles` table. Seeded system roles include `finance_admin`, `support_admin`, `content_admin`, `operations_admin`, `analytics_admin`, and `custom_admin`; super admins can also create reusable custom roles through `/api/rbac/roles`. The server-owned permission catalogue is exposed through `/api/rbac/permissions`.

`@Roles(...)` and `@Permissions(...)` evaluate the current user loaded from PostgreSQL, not only claims embedded in the JWT. See `docs/rbac.md` for role management, permission inheritance, overrides, and admin access APIs.

## Customer registration

`POST /api/auth/customers/register`

Required fields match the customer signup design:

- `firstName`
- `lastName`
- `email`
- `phoneCountryCode`
- `phoneNumber`
- `password`
- `zipCode`
- `acceptedTermsAndPrivacyPolicy: true`
- optional `device`

The response contains an unverified user plus an access/refresh token pair. The access token is usable only for email verification until the database user becomes verified.

## Tasker registration

`POST /api/auth/taskers/register`

One atomic request represents all seven tasker screens:

1. Account identity, phone, password, ZIP code and consent.
2. Exactly three unique service IDs and years of experience.
3. Professional story (`aboutMe`).
4. Hourly rate.
5. One or more non-overlapping future availability slots.
6. Government ID and optional electricity-bill/residency-permit document URLs.
7. Service-area label, latitude, longitude, radius, city and area.

The user, service rates, availability and session are committed in one Prisma transaction. The tasker starts as `pending_verification`; successful OTP verification changes the account to `pending_approval` while preserving `onboardingStatus=submitted`.

## Administrator creation

`POST /api/auth/admins/register`

This endpoint requires `admins.create` (the canonical super admin bypasses permission checks). `adminRole` must be an active RBAC role code. Omitting `permissions` inherits the role; providing permissions creates a validated least-privilege subset. A delegated admin cannot create an administrator with any effective permission the caller does not already hold. It creates an active, verified admin with a temporary password and emails the credentials through Nodemailer. Another super administrator cannot be created through the API.

## Login and token model

- `POST /api/auth/login`
- `POST /api/auth/refresh`

Login is role-aware through optional `expectedRole`, blocks unverified/suspended/deactivated accounts, records `lastLoginAt`, and creates an opaque refresh-token session.

Refresh tokens are random opaque values. Only SHA-256 hashes are stored. Rotation runs in a locked Prisma transaction. Reuse of a revoked refresh token revokes all active sessions for that user. A pending-verification registration session may refresh so the user can still complete email verification after the short-lived access token expires; normal protected routes remain blocked until verification succeeds.

Every bearer request validates:

1. JWT signature and expiry.
2. Numeric user and session identifiers.
3. Current user existence/status from PostgreSQL.
4. Current refresh-token session existence, revocation and expiry.
5. Email verification for normal protected resources.

`JwtIdentityGuard` intentionally allows an unverified registration token only for `POST /auth/verify-email`. `JwtAuthGuard` adds the verified-email requirement.

## Email verification

- `POST /api/auth/verify-email` requires the registration bearer token and `{ "otp": "123456" }`.
- `POST /api/auth/resend-verification-email` accepts email and optional device metadata.

Only the latest OTP is valid. New OTPs are stored as keyed SHA-256 hashes; plaintext codes exist only in the outbound email and request. OTP expiry and failed-attempt counts are stored in PostgreSQL. A new OTP resets the attempt count. The additive migration temporarily accepts an already-issued legacy integer code until it expires, while every new issuance clears that legacy field. The public resend response is intentionally identical for missing, verified, and eligible users to reduce account enumeration.

## Password recovery

- `POST /api/auth/forgot-password`
- `POST /api/auth/verify-reset-otp`
- `POST /api/auth/reset-password`
- `PATCH /api/auth/change-password`

Password recovery is OTP-only and stores newly issued reset codes as keyed hashes. There is no password-reset JWT or signed-link compatibility route. A successful reset clears the code/hash state and revokes all sessions. An authenticated password change verifies the current password and also revokes all sessions.

## Profile and sessions

- `GET /api/auth/me`
- `PATCH /api/auth/me`
- `GET /api/auth/sessions`
- `DELETE /api/auth/sessions/:id`
- `POST /api/auth/logout`
- `POST /api/auth/sessions/logout-all`

Profile updates are restricted to safe self-service fields. Role, permissions, account status and email cannot be modified by the profile endpoint.

## Removed route surface

The revamp intentionally does not register the old auth aliases:

- `POST /auth/sign-up`
- `POST /auth/refresh-token`
- `POST /auth/verify-otp`
- `POST /auth/resend-otp`
- `GET /auth/verify-pass-token`
- `POST /auth/verify-forgot-password`
- `GET /auth/get-loggedin-user`
- `GET /auth/verify-token`
- `POST /auth/logout-all`

Frontend clients must use the canonical routes documented by Swagger.

## Swagger

With `SWAGGER_ENABLED=true`:

- UI: `http://localhost:8080/api/docs`
- JSON: `http://localhost:8080/api/docs-json`

The `01 Auth` section includes endpoint purpose, access rules, request DTO examples, success examples and key failure responses.

## Super-admin seed

`npm run prisma:seed` upserts exactly one canonical super administrator and applies the configured seed password:

```text
latache.superadmin@yopmail.com
Admin@12345
```

These are development-only defaults. Staging/production seed runs require client-owned `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD`, reject the values above, and require a password of at least 12 characters. A new production Super Admin must change the seeded password. Re-running the seed does not reset an existing production password unless `SUPERADMIN_ROTATE_PASSWORD_ON_SEED=true` is deliberately set for that one deployment and then removed.

Use literal JSON in Swagger or frontend requests:

```json
{
  "email": "latache.superadmin@yopmail.com",
  "password": "Admin@12345",
  "expectedRole": "super_admin",
  "device": "Super-admin dashboard"
}
```

Do not paste Markdown link notation such as `[address](mailto:address)` and do not add backslashes before `@` or `_`. The API origin from `APP_BASE_URL` is automatically accepted for same-origin Swagger requests; browser frontends on a different origin must still be listed in `CORS_ORIGINS`.
