# API compatibility and intentional changes

The NestJS application keeps all 22 legacy route paths and the global `/api` prefix. Successful response structures remain compatible except for the previously non-functional service-creation endpoint.

## Intentional corrections

- `POST /api/services/add-service` now works, returns the created service, and requires a verified administrator from the current database.
- `GET /api/auth/verify-pass-token` returns HTTP `200` for a valid token instead of the legacy erroneous `401`.
- Password-reset tokens are incompatible with old links because they now prove purpose, user, email, active reset code, JWT expiry, and database expiry. Users holding an old link must request a new one.
- Local signup supports only `customer` and `tasker`. Public administrator signup is blocked.
- Non-local/social signup is rejected until provider tokens can be verified server-side; the legacy validation/controller behavior contradicted itself and did not verify a provider assertion.
- Access tokens are database-aware: the referenced user must still exist and be verified.
- Query-string access tokens are disabled by default. Temporary compatibility can be enabled with `ALLOW_QUERY_TOKEN_COMPATIBILITY=true`.
- Refresh-token creation/revocation is atomic; reuse of a revoked token revokes all active sessions for that user.
- Public tasker availability excludes booked, today, and past slots because booking itself requires a date strictly after today.
- Re-onboarding no longer deletes booked, booking-referenced, today, or historical availability rows.
- API errors use a consistent Nest response envelope containing `statusCode`, `message`, `timestamp`, and `path`; successful response objects retain legacy fields.
- Validation now rejects unknown body/query fields and invalid calendar dates/times rather than passing them into business logic.

## Known business-rule ambiguity retained

Any non-null tasker `onboardingStatus` is still treated as listable/bookable. The repository does not include a complete approval workflow, so the migration does not guess a stricter rule.
