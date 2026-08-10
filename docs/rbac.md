# Latache RBAC model

Version 3.4 introduces a database-backed administrator role model. The permission catalogue remains server-owned because a permission key is valid only when a backend capability and guard implement it.

## Data model

`RbacRoles` stores reusable administrator roles:

- stable `code`
- display `name` and description
- permission-key array
- system/custom classification
- active and soft-delete state

`Users.rbacRoleId` links an administrator to a role. Existing `Users.adminRole` and `Users.permissions` remain as denormalized effective-access snapshots for API compatibility and fast authorization. `Users.inheritsRolePermissions` distinguishes administrators who follow the role from administrators with an explicit least-privilege subset.

When a role permission set changes, all assigned administrators with `inheritsRolePermissions=true` are synchronized in the same Prisma transaction. Explicit overrides remain administrator-specific, but any permission removed from the parent role is removed from those overrides in the same transaction.

## Permission catalogue

`GET /api/rbac/permissions` returns grouped metadata and a flat key list. Keys cannot be created through an API. Add a new key only when the corresponding guarded backend capability is implemented, tested, documented, and added to `src/modules/rbac/constants/permission-catalog.ts`.

## Role APIs

| Method | Route | Access |
|---|---|---|
| GET | `/api/rbac/me` | Any verified admin/super admin |
| GET | `/api/rbac/permissions` | Super admin or admin with `roles.read` |
| GET | `/api/rbac/roles` | Super admin or admin with `roles.read` |
| GET | `/api/rbac/roles/:id` | Super admin or admin with `roles.read` |
| POST | `/api/rbac/roles` | Super admin |
| PATCH | `/api/rbac/roles/:id` | Super admin |
| PUT | `/api/rbac/roles/:id/permissions` | Super admin |
| DELETE | `/api/rbac/roles/:id` | Super admin |

Role codes are immutable. The canonical `super_admin` role cannot be modified. System roles cannot be deleted or deactivated. Custom roles cannot be deactivated or deleted while administrators are assigned.

## Administrator access APIs

| Method | Route | Access |
|---|---|---|
| GET | `/api/rbac/admins` | Super admin or admin with `admins.read` |
| GET | `/api/rbac/admins/:id` | Super admin or admin with `admins.read` |
| PATCH | `/api/rbac/admins/:id` | Super admin or admin with `admins.update`; non-escalating |
| PATCH | `/api/rbac/admins/:id/access` | Super admin or admin with `admins.update`; non-escalating |
| PATCH | `/api/rbac/admins/:id/status` | `admins.suspend` or `admins.delete`, depending on state |
| DELETE | `/api/rbac/admins/:id` | Super admin or admin with `admins.delete` |

The current caller cannot modify their own assignment/status through these management routes, and the canonical super-admin account is immutable. Delegated administrators can manage only targets whose effective permissions are a subset of their own access.

## Administrator creation

`POST /api/auth/admins/register` resolves `adminRole` against the active `RbacRoles.code` values.

Inherit the complete role:

```json
{
  "firstName": "Priya",
  "lastName": "Nair",
  "email": "priya@latache.com",
  "password": "Temporary@12345",
  "adminRole": "finance_admin"
}
```

Use a validated least-privilege subset:

```json
{
  "firstName": "Omar",
  "lastName": "Khan",
  "email": "omar@latache.com",
  "password": "Temporary@12345",
  "adminRole": "finance_admin",
  "permissions": ["finance.read", "reports.read"]
}
```

Every override must be a subset of the selected role. The compatibility `custom_admin` system role may use any catalogue permission as an explicit override; new reusable custom roles should normally be created instead.

## Applying the migration

```bash
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:seed
npm run build
```

Migration `20260805003000_add_rbac_model` creates `RbacRoles`, adds the user relation/inheritance flag, seeds system roles, and backfills existing administrators by `adminRole` code. Do not run `prisma migrate reset` against an existing database.

## Session invalidation

Suspending or deactivating an administrator revokes all active refresh-token sessions in the same transaction. The request guard also re-checks the current database account status on every request.
