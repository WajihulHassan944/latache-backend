-- DataFix: Resync administrators whose stored permissions drifted from their
-- RBAC role. A prior migration updated RbacRoles.permissions directly via
-- raw SQL (adding seo.read/seo.manage to super_admin and content_admin)
-- without going through the application's role-permission-update path,
-- which is the only place that keeps every role-inheriting administrator's
-- Users.permissions in sync. This repeats that same sync for any
-- administrator currently left stale by that gap.
UPDATE "Users" AS u
SET "permissions" = r."permissions"
FROM "RbacRoles" AS r
WHERE u."rbacRoleId" = r."id"
  AND u."inheritsRolePermissions" = true
  AND u."role" IN ('admin', 'super_admin')
  AND u."deletedAt" IS NULL
  AND u."permissions" IS DISTINCT FROM r."permissions";
