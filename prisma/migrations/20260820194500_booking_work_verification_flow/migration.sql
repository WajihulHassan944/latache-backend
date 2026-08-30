ALTER TABLE "Bookings"
  ADD COLUMN IF NOT EXISTS "workVerificationRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "frontDoorVerifiedAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "startWorkOtpHash" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "startWorkOtpExpiresAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "startWorkOtpAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "startWorkVerifiedAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "completionProofAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "completionOtpHash" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "completionOtpExpiresAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "completionOtpAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "completionVerifiedAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "completionVerifiedByRole" VARCHAR(32);

CREATE TABLE IF NOT EXISTS "BookingWorkProofs" (
  "id" VARCHAR(40) NOT NULL,
  "bookingId" INTEGER NOT NULL,
  "taskerId" INTEGER NOT NULL,
  "kind" VARCHAR(32) NOT NULL,
  "publicId" VARCHAR(500) NOT NULL,
  "secureUrl" TEXT NOT NULL,
  "resourceType" VARCHAR(16) NOT NULL DEFAULT 'image',
  "bytes" INTEGER NOT NULL,
  "mimeType" VARCHAR(120) NOT NULL,
  "capturedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BookingWorkProofs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BookingWorkProofs_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "Bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "BookingWorkProofs_publicId_key"
  ON "BookingWorkProofs"("publicId");
CREATE UNIQUE INDEX IF NOT EXISTS "BookingWorkProofs_booking_kind_unique"
  ON "BookingWorkProofs"("bookingId", "kind");
CREATE INDEX IF NOT EXISTS "booking_work_proofs_booking_created_idx"
  ON "BookingWorkProofs"("bookingId", "createdAt");
CREATE INDEX IF NOT EXISTS "booking_work_proofs_tasker_created_idx"
  ON "BookingWorkProofs"("taskerId", "createdAt");
