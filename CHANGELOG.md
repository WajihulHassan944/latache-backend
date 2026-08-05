# 3.3.2

- Fixed `JwtIdentityGuard` dependency resolution when used by imported feature modules such as `UploadsModule`.
- Exported `AuthSessionsRepository` from `AuthModule` so route-scoped guard resolution can access the active-session store.
- Added unit and static regression checks for the complete reusable auth guard dependency graph.

# 3.3.1

- Fixed TypeScript declaration generation for upload controller methods by exporting upload response contracts and declaring controller/service return types explicitly.
- No API, Prisma schema, migration, or environment-variable changes.

# Changelog

## 3.2.0 - Canonical auth API only

- Removed every legacy auth route and compatibility alias.
- Removed legacy signup consent fields and signed password-reset link/JWT flow.
- Added authenticated email verification through an active registration session.
- Added database-backed access-session validation for every bearer request.
- Standardized OTP request values as six-digit strings while retaining integer storage.
- Required exactly three expertise services for the tasker signup design.
- Moved logout-all to `POST /auth/sessions/logout-all`.
- Expanded Swagger descriptions, request examples, role requirements and failure responses.
- Updated the super-admin seed to apply `latache.superadmin@yopmail.com` / `Admin@12345` on every seed unless overridden.
- Removed all standalone HTML files and retained escaped TypeScript email templates only.
- Kept pending-verification registration sessions refreshable so an expired access token cannot strand the email-verification flow.
- Aligned verification and logout-all HTTP status codes with their Swagger 200 responses.

## 3.1.0 - Auth domain foundation

- Split registration, login/token, password, profile and session responsibilities.
- Added role-specific customer, tasker and super-admin-controlled admin registration.
- Added account status, permission, OTP-attempt, session metadata and consent fields.
