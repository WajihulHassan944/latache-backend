-- CreateTable
CREATE TABLE "RescheduleProposals" (
    "id" VARCHAR(40) NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "proposedById" INTEGER NOT NULL,
    "proposedByRole" VARCHAR(24) NOT NULL DEFAULT 'tasker',
    "proposedDate" DATE NOT NULL,
    "proposedTime" VARCHAR(255) NOT NULL,
    "note" VARCHAR(500),
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "respondedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RescheduleProposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reschedule_proposals_booking_status_idx" ON "RescheduleProposals"("bookingId", "status");

-- CreateIndex
CREATE INDEX "reschedule_proposals_proposed_by_idx" ON "RescheduleProposals"("proposedById");

-- AddForeignKey
ALTER TABLE "RescheduleProposals" ADD CONSTRAINT "RescheduleProposals_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RescheduleProposals" ADD CONSTRAINT "RescheduleProposals_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
