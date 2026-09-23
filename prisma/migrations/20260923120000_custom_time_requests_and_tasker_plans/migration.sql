-- AlterTable
ALTER TABLE "UserAvailabilities" ADD COLUMN     "isCustom" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CustomTimeRequests" (
    "id" VARCHAR(40) NOT NULL,
    "customerId" INTEGER NOT NULL,
    "taskerId" INTEGER NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "serviceSlug" VARCHAR(120) NOT NULL,
    "requestedDate" DATE NOT NULL,
    "requestedTime" VARCHAR(5) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "respondedAt" TIMESTAMPTZ(6),
    "fulfilledAt" TIMESTAMPTZ(6),
    "bookingId" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomTimeRequests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskerSubscriptions" (
    "id" VARCHAR(40) NOT NULL,
    "taskerId" INTEGER NOT NULL,
    "planId" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "priceAmount" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "paymentMethod" VARCHAR(16) NOT NULL,
    "stripePaymentMethodId" VARCHAR(255),
    "paymentReference" VARCHAR(255),
    "purchasedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMPTZ(6),
    "currentPeriodEnd" TIMESTAMPTZ(6),
    "graceUntil" TIMESTAMPTZ(6),
    "renewalFailureReason" VARCHAR(500),
    "lastBonusPaidAt" TIMESTAMPTZ(6),
    "reviewedById" INTEGER,
    "reviewedAt" TIMESTAMPTZ(6),
    "adminNote" VARCHAR(1000),
    "endedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskerSubscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomTimeRequests_bookingId_key" ON "CustomTimeRequests"("bookingId");

-- CreateIndex
CREATE INDEX "custom_time_requests_status_expires_idx" ON "CustomTimeRequests"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "custom_time_requests_pair_status_idx" ON "CustomTimeRequests"("customerId", "taskerId", "status");

-- CreateIndex
CREATE INDEX "custom_time_requests_tasker_status_idx" ON "CustomTimeRequests"("taskerId", "status");

-- CreateIndex
CREATE INDEX "tasker_subscriptions_tasker_status_idx" ON "TaskerSubscriptions"("taskerId", "status");

-- CreateIndex
CREATE INDEX "tasker_subscriptions_status_period_idx" ON "TaskerSubscriptions"("status", "currentPeriodEnd");

-- AddForeignKey
ALTER TABLE "CustomTimeRequests" ADD CONSTRAINT "CustomTimeRequests_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomTimeRequests" ADD CONSTRAINT "CustomTimeRequests_taskerId_fkey" FOREIGN KEY ("taskerId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomTimeRequests" ADD CONSTRAINT "CustomTimeRequests_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskerSubscriptions" ADD CONSTRAINT "TaskerSubscriptions_taskerId_fkey" FOREIGN KEY ("taskerId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- At most one pending custom-time request per (customer, tasker) pair. The
-- service layer checks this under a row lock too; this is the race backstop.
CREATE UNIQUE INDEX "custom_time_requests_one_pending_per_pair"
  ON "CustomTimeRequests"("customerId", "taskerId")
  WHERE "status" = 'pending';

-- At most one pending-or-active paid plan per tasker.
CREATE UNIQUE INDEX "tasker_subscriptions_one_open_per_tasker"
  ON "TaskerSubscriptions"("taskerId")
  WHERE "status" IN ('pending', 'active');
