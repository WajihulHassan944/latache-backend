-- Dispute lifecycle hardening. Additive only: no existing complaint/evidence/finance history is deleted.

ALTER TABLE "Users"
  ADD COLUMN "disputeStrikePoints" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "disciplinaryState" VARCHAR(32) NOT NULL DEFAULT 'clear',
  ADD COLUMN "lastDisciplinaryActionAt" TIMESTAMPTZ(6);

CREATE INDEX "users_discipline_state_points_idx"
  ON "Users"("disciplinaryState", "disputeStrikePoints");

ALTER TABLE "TaskComplaints"
  ADD COLUMN "clientRequestKey" VARCHAR(180),
  ADD COLUMN "activeBookingKey" VARCHAR(64),
  ADD COLUMN "filingDeadlineAt" TIMESTAMPTZ(6),
  ADD COLUMN "slaDueAt" TIMESTAMPTZ(6),
  ADD COLUMN "slaBreachedAt" TIMESTAMPTZ(6),
  ADD COLUMN "withdrawnAt" TIMESTAMPTZ(6),
  ADD COLUMN "withdrawnById" INTEGER,
  ADD COLUMN "appealCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "TaskComplaints"
  ADD CONSTRAINT "TaskComplaints_withdrawnById_fkey"
  FOREIGN KEY ("withdrawnById") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "TaskComplaints_activeBookingKey_key"
  ON "TaskComplaints"("activeBookingKey");
CREATE UNIQUE INDEX "task_complaints_filer_client_request_unique"
  ON "TaskComplaints"("filedById", "clientRequestKey");
CREATE INDEX "task_complaints_status_sla_due_idx"
  ON "TaskComplaints"("status", "slaDueAt");

ALTER TABLE "DisputeEvidenceRequests"
  ADD COLUMN "reminderSentAt" TIMESTAMPTZ(6),
  ADD COLUMN "overdueAt" TIMESTAMPTZ(6),
  ADD COLUMN "expiredAt" TIMESTAMPTZ(6);

CREATE INDEX "dispute_evidence_requests_status_due_idx"
  ON "DisputeEvidenceRequests"("status", "dueAt");

ALTER TABLE "DisputeResolutions"
  ADD COLUMN "proposedAt" TIMESTAMPTZ(6),
  ADD COLUMN "proposalResponseDueAt" TIMESTAMPTZ(6);

CREATE TABLE "DisputeParticipantActions" (
  "id" VARCHAR(40) NOT NULL,
  "complaintId" VARCHAR(40) NOT NULL,
  "userId" INTEGER NOT NULL,
  "resolutionId" VARCHAR(40),
  "action" VARCHAR(48) NOT NULL,
  "message" VARCHAR(5000),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DisputeParticipantActions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DisputeParticipantActions_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "TaskComplaints"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DisputeParticipantActions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DisputeParticipantActions_resolutionId_fkey" FOREIGN KEY ("resolutionId") REFERENCES "DisputeResolutions"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "dispute_participant_actions_complaint_created_idx" ON "DisputeParticipantActions"("complaintId", "createdAt");
CREATE INDEX "dispute_participant_actions_user_created_idx" ON "DisputeParticipantActions"("userId", "createdAt");
CREATE INDEX "dispute_participant_actions_resolution_action_idx" ON "DisputeParticipantActions"("resolutionId", "action", "createdAt");

CREATE TABLE "DisputeComments" (
  "id" VARCHAR(40) NOT NULL,
  "complaintId" VARCHAR(40) NOT NULL,
  "authorId" INTEGER NOT NULL,
  "authorRole" VARCHAR(32) NOT NULL,
  "body" VARCHAR(5000) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DisputeComments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DisputeComments_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "TaskComplaints"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DisputeComments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "dispute_comments_complaint_created_idx" ON "DisputeComments"("complaintId", "createdAt");
CREATE INDEX "dispute_comments_author_created_idx" ON "DisputeComments"("authorId", "createdAt");

CREATE TABLE "DisputeSatisfactionSurveys" (
  "id" VARCHAR(40) NOT NULL,
  "complaintId" VARCHAR(40) NOT NULL,
  "userId" INTEGER NOT NULL,
  "rating" INTEGER NOT NULL,
  "comment" VARCHAR(2000),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DisputeSatisfactionSurveys_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DisputeSatisfactionSurveys_rating_check" CHECK ("rating" BETWEEN 1 AND 5),
  CONSTRAINT "DisputeSatisfactionSurveys_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "TaskComplaints"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DisputeSatisfactionSurveys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "dispute_satisfaction_complaint_user_unique" ON "DisputeSatisfactionSurveys"("complaintId", "userId");
CREATE INDEX "dispute_satisfaction_rating_created_idx" ON "DisputeSatisfactionSurveys"("rating", "createdAt");

CREATE TABLE "DisputeDeliveries" (
  "id" VARCHAR(40) NOT NULL,
  "complaintId" VARCHAR(40) NOT NULL,
  "recipientId" INTEGER NOT NULL,
  "channel" VARCHAR(32) NOT NULL,
  "eventType" VARCHAR(80) NOT NULL,
  "subject" VARCHAR(255),
  "body" VARCHAR(5000) NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
  "idempotencyKey" VARCHAR(220) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMPTZ(6),
  "sentAt" TIMESTAMPTZ(6),
  "failureReason" VARCHAR(1000),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DisputeDeliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DisputeDeliveries_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "TaskComplaints"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DisputeDeliveries_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DisputeDeliveries_idempotencyKey_key" ON "DisputeDeliveries"("idempotencyKey");
CREATE INDEX "dispute_deliveries_status_channel_created_idx" ON "DisputeDeliveries"("status", "channel", "createdAt");
CREATE INDEX "dispute_deliveries_complaint_created_idx" ON "DisputeDeliveries"("complaintId", "createdAt");

CREATE TABLE "DisputeCashRefunds" (
  "id" VARCHAR(40) NOT NULL,
  "complaintId" VARCHAR(40) NOT NULL,
  "resolutionId" VARCHAR(40) NOT NULL,
  "customerId" INTEGER NOT NULL,
  "taskerId" INTEGER NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "status" VARCHAR(48) NOT NULL DEFAULT 'pending_manual_transfer',
  "manualTransferReference" VARCHAR(255),
  "confirmationNotes" VARCHAR(2000),
  "confirmedById" INTEGER,
  "confirmedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DisputeCashRefunds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DisputeCashRefunds_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "TaskComplaints"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DisputeCashRefunds_resolutionId_fkey" FOREIGN KEY ("resolutionId") REFERENCES "DisputeResolutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DisputeCashRefunds_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DisputeCashRefunds_resolutionId_key" ON "DisputeCashRefunds"("resolutionId");
CREATE INDEX "dispute_cash_refunds_complaint_status_idx" ON "DisputeCashRefunds"("complaintId", "status", "createdAt");
CREATE INDEX "dispute_cash_refunds_tasker_status_idx" ON "DisputeCashRefunds"("taskerId", "status", "createdAt");

CREATE TABLE "DisciplinaryActions" (
  "id" VARCHAR(40) NOT NULL,
  "complaintId" VARCHAR(40),
  "userId" INTEGER NOT NULL,
  "actorId" INTEGER,
  "kind" VARCHAR(48) NOT NULL,
  "points" INTEGER NOT NULL DEFAULT 0,
  "stateBefore" VARCHAR(32) NOT NULL,
  "stateAfter" VARCHAR(32) NOT NULL,
  "reason" VARCHAR(2000) NOT NULL,
  "idempotencyKey" VARCHAR(220) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DisciplinaryActions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DisciplinaryActions_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "TaskComplaints"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "DisciplinaryActions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DisciplinaryActions_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DisciplinaryActions_idempotencyKey_key" ON "DisciplinaryActions"("idempotencyKey");
CREATE INDEX "disciplinary_actions_user_created_idx" ON "DisciplinaryActions"("userId", "createdAt");
CREATE INDEX "disciplinary_actions_complaint_created_idx" ON "DisciplinaryActions"("complaintId", "createdAt");

CREATE TABLE "StripeChargebacks" (
  "id" VARCHAR(255) NOT NULL,
  "bookingId" INTEGER,
  "chargeId" VARCHAR(255),
  "paymentIntentId" VARCHAR(255),
  "status" VARCHAR(48) NOT NULL,
  "reason" VARCHAR(120),
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "evidenceDueBy" TIMESTAMPTZ(6),
  "isChargeRefundable" BOOLEAN,
  "balanceTransactionId" VARCHAR(255),
  "latestStripeEventType" VARCHAR(120) NOT NULL,
  "openedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StripeChargebacks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StripeChargebacks_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "stripe_chargebacks_booking_status_idx" ON "StripeChargebacks"("bookingId", "status", "updatedAt");
CREATE INDEX "stripe_chargebacks_status_due_idx" ON "StripeChargebacks"("status", "evidenceDueBy");
