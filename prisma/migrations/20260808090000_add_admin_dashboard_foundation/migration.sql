CREATE TABLE "AdminAuditLogs" (
  "id" VARCHAR(40) NOT NULL,
  "actorId" INTEGER,
  "targetUserId" INTEGER,
  "action" VARCHAR(80) NOT NULL,
  "entityType" VARCHAR(64) NOT NULL,
  "entityId" VARCHAR(64),
  "reason" VARCHAR(1000),
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminAuditLogs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AdminAuditLogs"
  ADD CONSTRAINT "AdminAuditLogs_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "Users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdminAuditLogs"
  ADD CONSTRAINT "AdminAuditLogs_targetUserId_fkey"
  FOREIGN KEY ("targetUserId") REFERENCES "Users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "admin_audit_actor_created_idx"
  ON "AdminAuditLogs"("actorId", "createdAt");

CREATE INDEX "admin_audit_target_created_idx"
  ON "AdminAuditLogs"("targetUserId", "createdAt");

CREATE INDEX "admin_audit_entity_created_idx"
  ON "AdminAuditLogs"("entityType", "entityId", "createdAt");

CREATE INDEX "admin_audit_action_created_idx"
  ON "AdminAuditLogs"("action", "createdAt");
