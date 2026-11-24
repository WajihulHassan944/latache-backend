-- CreateTable
CREATE TABLE "ContactEnquiry" (
    "id" VARCHAR(40) NOT NULL,
    "reference" VARCHAR(20) NOT NULL,
    "fullName" VARCHAR(160) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(40),
    "topic" VARCHAR(24) NOT NULL,
    "locale" VARCHAR(8) NOT NULL DEFAULT 'en',
    "status" VARCHAR(16) NOT NULL DEFAULT 'new',
    "assignedAdminId" INTEGER,
    "consentAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstResponseAt" TIMESTAMPTZ(6),
    "resolvedAt" TIMESTAMPTZ(6),
    "lastActivityAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastInboundAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ContactEnquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactMessage" (
    "id" VARCHAR(40) NOT NULL,
    "enquiryId" VARCHAR(40) NOT NULL,
    "direction" VARCHAR(10) NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAlert" (
    "id" VARCHAR(40) NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "severity" VARCHAR(10) NOT NULL DEFAULT 'info',
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(500),
    "link" VARCHAR(200),
    "entityType" VARCHAR(40),
    "entityId" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAlertRead" (
    "alertId" VARCHAR(40) NOT NULL,
    "userId" INTEGER NOT NULL,
    "readAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAlertRead_pkey" PRIMARY KEY ("alertId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContactEnquiry_reference_key" ON "ContactEnquiry"("reference");

-- CreateIndex
CREATE INDEX "contact_enquiry_status_activity_idx" ON "ContactEnquiry"("status", "lastActivityAt");

-- CreateIndex
CREATE INDEX "contact_enquiry_email_idx" ON "ContactEnquiry"("email");

-- CreateIndex
CREATE INDEX "contact_enquiry_assignee_idx" ON "ContactEnquiry"("assignedAdminId", "status");

-- CreateIndex
CREATE INDEX "contact_message_enquiry_idx" ON "ContactMessage"("enquiryId", "createdAt");

-- CreateIndex
CREATE INDEX "admin_alert_created_idx" ON "AdminAlert"("createdAt");

-- CreateIndex
CREATE INDEX "admin_alert_type_idx" ON "AdminAlert"("type", "createdAt");

-- CreateIndex
CREATE INDEX "admin_alert_read_user_idx" ON "AdminAlertRead"("userId");

-- AddForeignKey
ALTER TABLE "ContactMessage" ADD CONSTRAINT "ContactMessage_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "ContactEnquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAlertRead" ADD CONSTRAINT "AdminAlertRead_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "AdminAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

