-- CreateTable
CREATE TABLE "TaskerPlatformSettlements" (
    "id" VARCHAR(40) NOT NULL,
    "taskerId" INTEGER NOT NULL,
    "method" VARCHAR(32) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "appliedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "overpaymentAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL,
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "providerReference" VARCHAR(255),
    "externalReference" VARCHAR(255),
    "note" VARCHAR(1000),
    "adminNote" VARCHAR(1000),
    "failureReason" VARCHAR(1000),
    "createdById" INTEGER NOT NULL,
    "reviewedById" INTEGER,
    "reviewedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskerPlatformSettlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskerPlatformSettlements_providerReference_key" ON "TaskerPlatformSettlements"("providerReference");

-- CreateIndex
CREATE INDEX "tasker_platform_settlements_tasker_created_idx" ON "TaskerPlatformSettlements"("taskerId", "createdAt");

-- CreateIndex
CREATE INDEX "tasker_platform_settlements_status_created_idx" ON "TaskerPlatformSettlements"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "tasker_platform_settlements_tasker_idempotency_unique" ON "TaskerPlatformSettlements"("taskerId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "TaskerPlatformSettlements" ADD CONSTRAINT "TaskerPlatformSettlements_taskerId_fkey" FOREIGN KEY ("taskerId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

