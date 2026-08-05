# Security fixes

- OTP, reset-token, and password-comparison values are not logged.
- Refresh tokens are cryptographically random, hashed before storage, rotated under a PostgreSQL row lock, and globally revoked when a revoked token is reused.
- Password-reset tokens use a dedicated secret and are bound to purpose, user, email, active reset code, JWT expiry, and database expiry.
- A successful password reset consumes reset state and revokes every active session.
- Public administrator signup and unverifiable social signup are blocked.
- Access/admin guards reload the current verified database user instead of trusting claims alone.
- Service creation requires a database-confirmed administrator and serializes duplicate-slug checks with a PostgreSQL advisory transaction lock.
- Tasker/geospatial SQL parameters are bound through Prisma SQL templates; sort expressions are allowlisted.
- Booking uses row locking, conditional slot claiming, and database uniqueness to prevent double booking.
- Re-onboarding preserves booked, referenced, present-day, and historical availability rows.
- Nodemailer sends are awaited, SMTP failures are mapped to controlled service errors, and all HTML substitutions are escaped.
- Helmet, exact CORS origins, throttling, request limits, DTO whitelisting, environment validation, and a non-root Docker user are enabled.
