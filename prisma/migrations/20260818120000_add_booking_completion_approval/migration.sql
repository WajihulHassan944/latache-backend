ALTER TABLE "Bookings"
  ADD COLUMN "completionSubmittedAt" TIMESTAMPTZ(6),
  ADD COLUMN "completionApprovalDueAt" TIMESTAMPTZ(6),
  ADD COLUMN "completionApprovedAt" TIMESTAMPTZ(6),
  ADD COLUMN "completionApprovedByRole" VARCHAR(32),
  ADD COLUMN "completionAutoApprovedAt" TIMESTAMPTZ(6);

CREATE INDEX "bookings_completion_approval_due_idx"
  ON "Bookings"("status", "completionApprovalDueAt", "id");
