# Legacy API contract inventory

This inventory describes the active Express application that was migrated. The NestJS implementation preserves the global `/api` prefix, all 22 method/path combinations, successful response field names, PostgreSQL schema identity, and the documented compatibility defaults.

## Authentication and sessions

| Method and route | Request | Success | Main side effects |
|---|---|---:|---|
| `GET /api/auth/get-loggedin-user` | Bearer access token | `200` `{ user, message }` | Loads the current database user and removes sensitive fields. |
| `POST /api/auth/sign-up` | `{ firstName, lastName, email, password, authType, role, zipCode, phoneNumber?, device? }` | `201` `{ message }` | Creates an unverified local user, hashes the password, stores an expiring OTP, sends verification email. |
| `POST /api/auth/verify-otp` | `{ email, otp }` | `200` `{ message }` | Consumes the active OTP and marks the user verified. |
| `POST /api/auth/resend-otp` | `{ email, device? }` | `201` `{ message }` | Replaces the OTP/expiry and sends a new verification email. |
| `GET /api/auth/verify-token` | Bearer access token | `200` `{ message }` | Validates the token and current verified database user. |
| `GET /api/auth/verify-pass-token` | Bearer password-reset token | `200` `{ message }` | Validates signature, purpose, user, email, reset code, JWT expiry, and database expiry. |
| `POST /api/auth/login` | `{ email, password, device? }` | `200` `{ accessToken, refreshToken, message, user }` | Verifies credentials and creates a hashed database-backed refresh session. |
| `POST /api/auth/refresh-token` | `{ refreshToken }` | `200` `{ accessToken, refreshToken, message }` | Rotates the refresh token in one locked transaction. |
| `POST /api/auth/logout` | Bearer access token + `{ refreshToken }` | `200` `{ message }` | Idempotently revokes the matching session when owned by the current user. |
| `POST /api/auth/logout-all` | Bearer access token | `200` `{ message }` | Revokes every active refresh session for the current user. |
| `POST /api/auth/forgot-password` | `{ email }` | `200` `{ message }` | Creates an active reset request, signs a reset token, and sends the reset URL. |
| `POST /api/auth/verify-forgot-password` | `{ email, password, conPassword, token }` | `200` `{ message }` | Validates and consumes the reset request, hashes the new password, and revokes all sessions. |

## Services

| Method and route | Request | Success | Main side effects |
|---|---|---:|---|
| `GET /api/services/get-services` | Query: `page?`, `limit?`, `search?`, `category?` | `200` paginated object | Reads `Services`; `category` remains accepted but ignored because no category column exists. |
| `POST /api/services/add-service` | Administrator bearer token + `{ name, description, slug, icon }` | `200` created service | Creates one service after administrator/database-user verification. |

## Taskers

| Method and route | Request | Success | Main side effects |
|---|---|---:|---|
| `POST /api/taskers/onboarding` | Bearer token + services, experience, bio, availability, identity, service area | `200` `{ taskerId, status, submittedAt }` | Transactionally updates tasker profile, service rates, and safe future availability. |
| `GET /api/taskers` | Query filters for service, coordinates/radius, elite flag, price, sort, pagination | `200` paginated object | Parameterized PostgreSQL search and representative-service pricing. |
| `GET /api/taskers/:id/availability` | Numeric tasker ID | `200` `{ taskerId, timezone, days }` | Returns future, unbooked slots in 24-hour and AM/PM forms. |
| `GET /api/taskers/:id` | Numeric tasker ID; optional `serviceSlug` | `200` tasker detail | Returns selected service pricing or the tasker's cheapest service. |

## Bookings

| Method and route | Request | Success | Main side effects |
|---|---|---:|---|
| `POST /api/bookings/book-tasker` | Customer bearer token + tasker, service, location, date/time, booking details | `201` booking object | Locks and conditionally claims one slot, resolves server-side rate, creates booking atomically. |
| `GET /api/bookings/upcoming` | Bearer token; `page?`, `limit?` | `200` paginated object | Lists viewer-relative bookings dated today or later, ascending. |
| `GET /api/bookings/completed` | Bearer token; `page?`, `limit?` | `200` paginated object | Lists viewer-relative bookings before today, descending. |
| `GET /api/bookings/next` | Bearer token | `200` booking + `dayTitle` | Returns the earliest upcoming booking. |

## Compatibility defaults

- Services pagination: limit `10`, maximum `100`.
- Taskers pagination: limit `9`, maximum `100`.
- Bookings pagination: limit `10`, maximum `100`.
- Tasker search radius: `20` km.
- Availability timezone: `Africa/Casablanca`.
- Refresh session lifetime: `30` days.
- OTP lifetime: `5` minutes.
- Roles: `customer`, `tasker`, `admin`.
- Onboarding status written by the API: `pending_review`.
- Any non-null onboarding status remains listable/bookable because the source contains no complete approval workflow.

## PostgreSQL schema

The migration preserves these exact tables: `Users`, `Services`, `RefreshTokens`, `UserServices`, `UserAvailabilities`, and `Bookings`. It preserves the `UserServices(userId, serviceId)` unique constraint, `Bookings.availabilityId` uniqueness, foreign keys, JSONB fields, PostgreSQL arrays, and table/column identity through the Prisma baseline.

## Environment inventory

Normalized variables are documented in `.env.example`: runtime/URLs, PostgreSQL, JWT/reset/session controls, CORS, body limit, timezone, Swagger, proxy behavior, and provider-neutral Nodemailer SMTP settings.
