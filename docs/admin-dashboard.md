# Administrator Dashboard API — v3.8.0

This release implements the first administrator-dashboard slice from the supplied Super Admin designs. The designs are treated as product direction; the API remains driven by the existing Latache domain model and authorization rules.

## Access model

All `/api/admin/*` endpoints require an active `admin` or `super_admin` session.

- `super_admin` bypasses permission-key checks.
- `admin` access is determined by the effective RBAC permissions already returned by `GET /api/rbac/me`.
- Existing RBAC endpoints remain the canonical Admin Management API. A duplicate `/api/admin/admins/*` resource was deliberately not created.
- Role creation and role-permission mutation remain super-admin-only because those operations can change the authorization boundary itself.

## Platform dashboard and analytics

| Method | Route | Permission(s) | Purpose |
|---|---|---|---|
| GET | `/api/admin/dashboard/overview` | `analytics.read` | Platform totals, booking status, recent bookings and revenue trend |
| GET | `/api/admin/dashboard/revenue` | `finance.read` | Paid-booking gross revenue, platform fees, Tasker earnings, tips and donations |
| GET | `/api/admin/dashboard/users` | `analytics.read` | Customer growth and retention |
| GET | `/api/admin/dashboard/taskers` | `analytics.read` | Tasker growth, onboarding and completion metrics |
| GET | `/api/admin/dashboard/bookings` | `analytics.read` | Booking status/service analytics |
| GET | `/api/admin/dashboard/activity` | `analytics.read` | Persisted registration, booking, payment, withdrawal and admin-audit activity |

Date-based endpoints support preset ranges and UTC custom ranges. No chart series is synthesized when data is absent; empty periods return empty arrays or zero values.


### Elite Tasker Program

The former aggregate `/api/admin/dashboard/elite-taskers` route is superseded in v3.8 by the cohesive `/api/admin/elite-taskers/*` program resource. This prevents the same Elite population from being exposed through two admin API families. Use `elite.read` / `elite.manage` and see `docs/elite-tasker-program.md`.

### Financial definitions

- Revenue is based only on bookings whose persisted payment status is `paid`.
- Platform fees come from `Bookings.platformFeeAmount`.
- Tasker earnings come from settled Tasker wallet ledger entries where relevant.
- Paid withdrawals come from actual withdrawal records.
- Stripe/provider payment success is never inferred from a design state.

## Customer Management

| Method | Route | Permission(s) |
|---|---|---|
| GET | `/api/admin/customers` | `customers.read` |
| GET | `/api/admin/customers/bookings` | `customers.read`, `bookings.read` |
| GET | `/api/admin/customers/payments` | `customers.read`, `finance.read` |
| GET | `/api/admin/customers/reports` | `customers.read`, `reports.read` |
| GET | `/api/admin/customers/:id` | `customers.read` |
| GET | `/api/admin/customers/:id/bookings` | `customers.read`, `bookings.read` |
| GET | `/api/admin/customers/:id/payments` | `customers.read`, `finance.read` |
| PATCH | `/api/admin/customers/:id/status` | `customers.manage` |

Customer moderation actions are `suspend`, `reactivate`, and `ban`. `ban` maps to Latache's existing `deactivated` lifecycle state instead of introducing a second overlapping status. Suspension and ban revoke active sessions. Reactivating a deactivated/banned customer is restricted to the super admin.

The payment-history filter separates transaction `status` from transaction `kind`. Refunds are filtered with `kind=refund`, because a successful refund is still a transaction whose persisted status is `succeeded`.

## Tasker Management

| Method | Route | Permission(s) |
|---|---|---|
| GET | `/api/admin/taskers` | `taskers.read` |
| GET | `/api/admin/taskers/pending-verification` | `taskers.read` |
| GET | `/api/admin/taskers/performance` | `analytics.read` |
| GET | `/api/admin/taskers/earnings` | `taskers.read`, `finance.read` |
| GET | `/api/admin/taskers/:id` | `taskers.read` |
| POST | `/api/admin/taskers/:id/verification` | `taskers.manage` |
| PATCH | `/api/admin/taskers/:id/status` | `taskers.manage` |

The pending-verification queue includes both `submitted` and `pending_review` onboarding states while the account is `pending_approval`.

Tasker approval is blocked unless Latache can verify from its own database that:

- email verification passed;
- an identity-document payload and ID type are present;
- at least one service is configured;
- at least one availability slot is configured;
- service-area latitude, longitude and radius are configured.

Background-check and insurance-verification values are returned as `null` until real providers are connected. They are never shown as passed or failed based on dummy data.

Rejection requires a structured reason code plus free-text reason. Approval/rejection, suspension, reactivation and ban are written to the immutable admin audit log.

## Existing Admin Management / RBAC

Admin-management designs are served by the existing RBAC/Auth resources instead of a duplicate dashboard controller:

| Method | Route | Access |
|---|---|---|
| POST | `/api/auth/admins/register` | `admins.create`; delegated creation cannot exceed caller permissions |
| GET | `/api/rbac/admins` | `admins.read` |
| GET | `/api/rbac/admins/:id` | `admins.read` |
| PATCH | `/api/rbac/admins/:id` | `admins.update` |
| PATCH | `/api/rbac/admins/:id/access` | `admins.update`; no privilege escalation |
| PATCH | `/api/rbac/admins/:id/status` | `admins.suspend` or `admins.delete`, depending on target status |
| DELETE | `/api/rbac/admins/:id` | `admins.delete` |
| GET | `/api/rbac/permissions` | `roles.read` |
| GET | `/api/rbac/roles` | `roles.read` |
| GET | `/api/rbac/roles/:id` | `roles.read` |
| POST/PATCH/PUT/DELETE | `/api/rbac/roles...` | canonical super admin only |

Administrator email changes are intentionally excluded from generic profile editing because changing a login identifier should be implemented through a separately verified auth flow.

## Administrative audit trail

Migration `20260808090000_add_admin_dashboard_foundation` creates only one new table: `AdminAuditLogs`.

It stores actor, optional target user, action, entity, reason, metadata and timestamp. It does not duplicate Customer, Tasker, booking, payment or wallet state. This gives the activity feed and moderation screens a reliable source for administrator decisions while keeping business data in their existing tables.

## Future dashboard screens

Additional designs should extend these resources where the underlying domain is the same. New endpoint families should only be introduced for genuinely new concepts such as dispute-resolution workflow, provider verification integrations, promotions, exports/jobs, or deeper finance reconciliation.
