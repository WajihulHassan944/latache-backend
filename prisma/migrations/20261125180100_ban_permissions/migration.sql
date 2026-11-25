-- Dedicated ban permissions. Everyone who could ban before (customers.manage /
-- taskers.manage) keeps that ability so nothing silently changes; super admin can
-- now revoke it per role/admin.
UPDATE "RbacRoles"
SET "permissions" = array_append("permissions", 'customers.ban')
WHERE 'customers.manage' = ANY("permissions") AND NOT ('customers.ban' = ANY("permissions"));
UPDATE "RbacRoles"
SET "permissions" = array_append("permissions", 'taskers.ban')
WHERE 'taskers.manage' = ANY("permissions") AND NOT ('taskers.ban' = ANY("permissions"));

UPDATE "Users"
SET "permissions" = array_append("permissions", 'customers.ban')
WHERE "role" = 'admin' AND "deletedAt" IS NULL
  AND 'customers.manage' = ANY("permissions") AND NOT ('customers.ban' = ANY("permissions"));
UPDATE "Users"
SET "permissions" = array_append("permissions", 'taskers.ban')
WHERE "role" = 'admin' AND "deletedAt" IS NULL
  AND 'taskers.manage' = ANY("permissions") AND NOT ('taskers.ban' = ANY("permissions"));
