-- Database-backed RBAC roles. Existing Users.adminRole and Users.permissions
-- remain as denormalized compatibility/effective-access snapshots.

CREATE TABLE IF NOT EXISTS "RbacRoles" (
  "id" VARCHAR(40) NOT NULL,
  "code" VARCHAR(64) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "description" VARCHAR(500),
  "permissions" VARCHAR(100)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(100)[],
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "deletedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RbacRoles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RbacRoles_code_key"
  ON "RbacRoles"("code");
CREATE INDEX IF NOT EXISTS "rbac_roles_active_system_idx"
  ON "RbacRoles"("isActive", "isSystem");

INSERT INTO "RbacRoles" (
  "id", "code", "name", "description", "permissions", "isSystem", "isActive"
) VALUES
  (
    'role_super_admin',
    'super_admin',
    'Super Administrator',
    'Canonical platform owner with immutable full access.',
    ARRAY[
      'admins.read','admins.create','admins.update','admins.suspend','admins.delete',
      'roles.read','roles.manage','customers.read','customers.manage',
      'taskers.read','taskers.manage','bookings.read','bookings.manage',
      'services.read','services.manage','finance.read','finance.manage','reports.read',
      'support.read','support.manage','content.read','content.manage','analytics.read'
    ]::VARCHAR(100)[],
    true,
    true
  ),
  (
    'role_finance_admin',
    'finance_admin',
    'Finance Administrator',
    'Financial operations, reconciliation, and reporting access.',
    ARRAY['finance.read','finance.manage','reports.read']::VARCHAR(100)[],
    true,
    true
  ),
  (
    'role_support_admin',
    'support_admin',
    'Support Administrator',
    'Customer, tasker, booking, and support case visibility.',
    ARRAY['support.read','support.manage','customers.read','taskers.read','bookings.read']::VARCHAR(100)[],
    true,
    true
  ),
  (
    'role_content_admin',
    'content_admin',
    'Content Administrator',
    'Content and service catalogue management.',
    ARRAY['content.read','content.manage','services.read']::VARCHAR(100)[],
    true,
    true
  ),
  (
    'role_operations_admin',
    'operations_admin',
    'Operations Administrator',
    'Day-to-day customer, tasker, booking, and service operations.',
    ARRAY[
      'customers.read','customers.manage','taskers.read','taskers.manage',
      'bookings.read','bookings.manage','services.read','services.manage'
    ]::VARCHAR(100)[],
    true,
    true
  ),
  (
    'role_analytics_admin',
    'analytics_admin',
    'Analytics Administrator',
    'Analytics, reporting, and finance read access.',
    ARRAY['analytics.read','reports.read','finance.read']::VARCHAR(100)[],
    true,
    true
  ),
  (
    'role_custom_admin',
    'custom_admin',
    'Custom Administrator',
    'Compatibility role for administrator-specific permission overrides.',
    ARRAY[]::VARCHAR(100)[],
    true,
    true
  )
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "isSystem" = true,
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;

ALTER TABLE "Users"
  ADD COLUMN IF NOT EXISTS "rbacRoleId" VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "inheritsRolePermissions" BOOLEAN NOT NULL DEFAULT true;

UPDATE "Users" AS users
SET "rbacRoleId" = roles."id"
FROM "RbacRoles" AS roles
WHERE users."adminRole" = roles."code"
  AND users."rbacRoleId" IS NULL;

UPDATE "Users"
SET "inheritsRolePermissions" = false
WHERE "adminRole" = 'custom_admin'
  AND COALESCE(array_length("permissions", 1), 0) > 0;

CREATE INDEX IF NOT EXISTS "users_rbac_role_idx"
  ON "Users"("rbacRoleId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Users_rbacRoleId_fkey'
  ) THEN
    ALTER TABLE "Users"
      ADD CONSTRAINT "Users_rbacRoleId_fkey"
      FOREIGN KEY ("rbacRoleId")
      REFERENCES "RbacRoles"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END
$$;
