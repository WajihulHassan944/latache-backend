-- CreateTable
CREATE TABLE "BookingExtensionRequests" (
    "id" VARCHAR(40) NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "requestedById" INTEGER NOT NULL,
    "requestedByRole" VARCHAR(24) NOT NULL DEFAULT 'tasker',
    "minutes" INTEGER NOT NULL,
    "note" VARCHAR(500),
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "respondedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingExtensionRequests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "booking_extension_requests_booking_status_idx" ON "BookingExtensionRequests"("bookingId", "status");

-- CreateIndex
CREATE INDEX "booking_extension_requests_requested_by_idx" ON "BookingExtensionRequests"("requestedById");

-- AddForeignKey
ALTER TABLE "BookingExtensionRequests" ADD CONSTRAINT "BookingExtensionRequests_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingExtensionRequests" ADD CONSTRAINT "BookingExtensionRequests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
