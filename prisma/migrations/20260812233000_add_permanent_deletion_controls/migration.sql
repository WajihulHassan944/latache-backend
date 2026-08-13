-- Durable, auditable object-storage cleanup for irreversible resource deletion.
CREATE TABLE "ObjectStorageDeletionTasks" (
  "id" VARCHAR(40) NOT NULL,
  "provider" VARCHAR(32) NOT NULL DEFAULT 'cloudinary',
  "publicId" VARCHAR(500) NOT NULL,
  "resourceType" VARCHAR(16) NOT NULL DEFAULT 'image',
  "status" VARCHAR(24) NOT NULL DEFAULT 'pending',
  "entityType" VARCHAR(64) NOT NULL,
  "entityId" VARCHAR(120) NOT NULL,
  "requestedById" INTEGER,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMPTZ(6),
  "lockToken" VARCHAR(64),
  "lastError" VARCHAR(1000),
  "completedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ObjectStorageDeletionTasks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "storage_deletion_provider_public_resource_unique"
  ON "ObjectStorageDeletionTasks"("provider", "publicId", "resourceType");
CREATE INDEX "storage_deletion_pending_idx"
  ON "ObjectStorageDeletionTasks"("status", "nextAttemptAt", "createdAt");
CREATE INDEX "storage_deletion_entity_idx"
  ON "ObjectStorageDeletionTasks"("entityType", "entityId");

-- Super Admin receives the new destructive permissions. Other administrators
-- must be granted them explicitly through the existing RBAC management API.
UPDATE "RbacRoles"
SET "permissions" = ARRAY(
  SELECT DISTINCT permission
  FROM unnest("permissions" || ARRAY['customers.delete','taskers.delete']::VARCHAR(100)[]) permission
)
WHERE "code" = 'super_admin';

UPDATE "Users" AS users
SET "permissions" = roles."permissions"
FROM "RbacRoles" AS roles
WHERE users."rbacRoleId" = roles."id"
  AND users."role" = 'super_admin';
