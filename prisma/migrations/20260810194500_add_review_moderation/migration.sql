ALTER TABLE "Reviews"
  ADD COLUMN "moderationStatus" VARCHAR(32) NOT NULL DEFAULT 'visible',
  ADD COLUMN "moderationReason" VARCHAR(1000),
  ADD COLUMN "moderatedAt" TIMESTAMPTZ(6),
  ADD COLUMN "moderatedById" INTEGER;

ALTER TABLE "Reviews"
  ADD CONSTRAINT "Reviews_moderatedById_fkey"
  FOREIGN KEY ("moderatedById") REFERENCES "Users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "reviews_moderation_created_idx"
  ON "Reviews"("moderationStatus", "createdAt");
CREATE INDEX "reviews_moderator_moderated_idx"
  ON "Reviews"("moderatedById", "moderatedAt");

UPDATE "RbacRoles"
SET "permissions" = ARRAY(
  SELECT DISTINCT permission
  FROM unnest("permissions" || ARRAY['reviews.read','reviews.manage']::VARCHAR(100)[]) AS permission
)
WHERE "code" IN ('content_admin', 'operations_admin');
