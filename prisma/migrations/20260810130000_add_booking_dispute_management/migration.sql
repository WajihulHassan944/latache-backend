-- Booking and dispute management foundation for permission-aware administrators.
-- Additive only: existing bookings, complaints, payment transactions, and audit history remain intact.

ALTER TABLE "TaskComplaints"
  ADD COLUMN "priority" VARCHAR(16) NOT NULL DEFAULT 'normal',
  ADD COLUMN "assignedAdminId" INTEGER,
  ADD COLUMN "evidenceReviewStatus" VARCHAR(32) NOT NULL DEFAULT 'not_required',
  ADD COLUMN "evidenceReviewedAt" TIMESTAMPTZ(6),
  ADD COLUMN "evidenceReviewNotes" TEXT,
  ADD COLUMN "awaitingResponseFrom" VARCHAR(32),
  ADD COLUMN "responseDueAt" TIMESTAMPTZ(6),
  ADD COLUMN "escalatedAt" TIMESTAMPTZ(6),
  ADD COLUMN "escalationReason" VARCHAR(1000),
  ADD COLUMN "resolvedAt" TIMESTAMPTZ(6),
  ADD COLUMN "resolvedById" INTEGER,
  ADD COLUMN "resolutionType" VARCHAR(48),
  ADD COLUMN "resolutionSummary" TEXT,
  ADD COLUMN "resolutionAmount" DECIMAL(14,2),
  ADD COLUMN "resolutionCurrency" VARCHAR(3);

ALTER TABLE "TaskComplaints"
  ADD CONSTRAINT "TaskComplaints_assignedAdminId_fkey"
  FOREIGN KEY ("assignedAdminId") REFERENCES "Users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TaskComplaints"
  ADD CONSTRAINT "TaskComplaints_resolvedById_fkey"
  FOREIGN KEY ("resolvedById") REFERENCES "Users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "task_complaints_status_priority_created_idx"
  ON "TaskComplaints"("status", "priority", "createdAt");
CREATE INDEX "task_complaints_assignee_status_updated_idx"
  ON "TaskComplaints"("assignedAdminId", "status", "updatedAt");
CREATE INDEX "task_complaints_evidence_review_idx"
  ON "TaskComplaints"("evidenceReviewStatus", "updatedAt");

CREATE TABLE "DisputeEvidence" (
  "id" VARCHAR(40) NOT NULL,
  "complaintId" VARCHAR(40) NOT NULL,
  "uploadedById" INTEGER,
  "uploadedByRole" VARCHAR(32) NOT NULL,
  "source" VARCHAR(48) NOT NULL DEFAULT 'requested_evidence',
  "name" VARCHAR(255) NOT NULL,
  "publicId" VARCHAR(500),
  "secureUrl" VARCHAR(2048) NOT NULL,
  "resourceType" VARCHAR(32),
  "bytes" INTEGER,
  "mimeType" VARCHAR(120),
  "reviewedAt" TIMESTAMPTZ(6),
  "reviewedById" INTEGER,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DisputeEvidence_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "DisputeEvidence"
  ADD CONSTRAINT "DisputeEvidence_complaintId_fkey"
  FOREIGN KEY ("complaintId") REFERENCES "TaskComplaints"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DisputeEvidence"
  ADD CONSTRAINT "DisputeEvidence_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "Users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DisputeEvidence"
  ADD CONSTRAINT "DisputeEvidence_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "Users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "dispute_evidence_complaint_created_idx"
  ON "DisputeEvidence"("complaintId", "createdAt");
CREATE INDEX "dispute_evidence_reviewed_created_idx"
  ON "DisputeEvidence"("reviewedAt", "createdAt");

CREATE TABLE "DisputeEvidenceRequests" (
  "id" VARCHAR(40) NOT NULL,
  "complaintId" VARCHAR(40) NOT NULL,
  "createdById" INTEGER NOT NULL,
  "requestedFrom" VARCHAR(32) NOT NULL,
  "message" VARCHAR(1000) NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
  "dueAt" TIMESTAMPTZ(6),
  "fulfilledAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DisputeEvidenceRequests_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "DisputeEvidenceRequests"
  ADD CONSTRAINT "DisputeEvidenceRequests_complaintId_fkey"
  FOREIGN KEY ("complaintId") REFERENCES "TaskComplaints"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DisputeEvidenceRequests"
  ADD CONSTRAINT "DisputeEvidenceRequests_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "Users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "dispute_evidence_requests_complaint_status_idx"
  ON "DisputeEvidenceRequests"("complaintId", "status", "createdAt");
CREATE INDEX "dispute_evidence_requests_creator_created_idx"
  ON "DisputeEvidenceRequests"("createdById", "createdAt");

CREATE TABLE "DisputeResolutions" (
  "id" VARCHAR(40) NOT NULL,
  "complaintId" VARCHAR(40) NOT NULL,
  "actorId" INTEGER NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'draft',
  "actionType" VARCHAR(48) NOT NULL,
  "refundAmount" DECIMAL(14,2),
  "currency" VARCHAR(3),
  "warningTarget" VARCHAR(32),
  "notifyParties" BOOLEAN NOT NULL DEFAULT true,
  "summary" TEXT NOT NULL,
  "refundTransactionId" VARCHAR(40),
  "providerRefundId" VARCHAR(255),
  "providerRefundStatus" VARCHAR(48),
  "failureReason" VARCHAR(1000),
  "appliedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DisputeResolutions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "DisputeResolutions"
  ADD CONSTRAINT "DisputeResolutions_complaintId_fkey"
  FOREIGN KEY ("complaintId") REFERENCES "TaskComplaints"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DisputeResolutions"
  ADD CONSTRAINT "DisputeResolutions_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "Users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "DisputeResolutions_refundTransactionId_key"
  ON "DisputeResolutions"("refundTransactionId");
CREATE INDEX "dispute_resolutions_complaint_status_created_idx"
  ON "DisputeResolutions"("complaintId", "status", "createdAt");
CREATE INDEX "dispute_resolutions_actor_created_idx"
  ON "DisputeResolutions"("actorId", "createdAt");
CREATE INDEX "dispute_resolutions_action_applied_idx"
  ON "DisputeResolutions"("actionType", "appliedAt");

-- Existing complaint attachment JSON remains the compatibility source for historical complaints.
-- New evidence submissions are normalized into DisputeEvidence; no synthetic evidence is backfilled.
