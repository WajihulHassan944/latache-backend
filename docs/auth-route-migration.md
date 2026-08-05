# Frontend auth route migration

The auth module is intentionally breaking away from the original Express route names. Update clients as follows:

| Removed | Canonical replacement |
|---|---|
| `POST /api/auth/sign-up` | `POST /api/auth/customers/register` or `POST /api/auth/taskers/register` |
| `POST /api/auth/refresh-token` | `POST /api/auth/refresh` |
| `POST /api/auth/verify-otp` | `POST /api/auth/verify-email` with registration bearer token |
| `POST /api/auth/resend-otp` | `POST /api/auth/resend-verification-email` |
| `GET /api/auth/get-loggedin-user` | `GET /api/auth/me` |
| `GET /api/auth/verify-token` | `GET /api/auth/me` validates the bearer session and returns the profile |
| `GET /api/auth/verify-pass-token` | Removed; password recovery is OTP-only |
| `POST /api/auth/verify-forgot-password` | `POST /api/auth/reset-password` |
| `POST /api/auth/logout-all` | `POST /api/auth/sessions/logout-all` |

There are no compatibility aliases in the controller or Swagger document.
