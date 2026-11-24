-- CreateTable
CREATE TABLE "JobPostings" (
    "id" VARCHAR(40) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "department" VARCHAR(80) NOT NULL,
    "city" VARCHAR(80) NOT NULL,
    "workMode" VARCHAR(16) NOT NULL DEFAULT 'onsite',
    "employmentType" VARCHAR(24) NOT NULL DEFAULT 'full_time',
    "seniority" VARCHAR(16) NOT NULL DEFAULT 'mid',
    "summary" VARCHAR(500) NOT NULL,
    "responsibilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requirements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "niceToHave" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "benefits" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "salaryMin" DECIMAL(12,2),
    "salaryMax" DECIMAL(12,2),
    "salaryCurrency" VARCHAR(3) NOT NULL DEFAULT 'MAD',
    "showSalary" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(16) NOT NULL DEFAULT 'draft',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMPTZ(6),
    "closedAt" TIMESTAMPTZ(6),
    "createdById" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobPostings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobApplications" (
    "id" VARCHAR(40) NOT NULL,
    "reference" VARCHAR(20) NOT NULL,
    "jobId" VARCHAR(40),
    "fullName" VARCHAR(160) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(40) NOT NULL,
    "city" VARCHAR(80) NOT NULL,
    "linkedinUrl" VARCHAR(300),
    "portfolioUrl" VARCHAR(300),
    "coverNote" TEXT NOT NULL,
    "source" VARCHAR(40),
    "locale" VARCHAR(10),
    "cvPublicId" VARCHAR(300) NOT NULL,
    "cvFileName" VARCHAR(200) NOT NULL,
    "cvMimeType" VARCHAR(100) NOT NULL,
    "cvBytes" INTEGER NOT NULL,
    "consentAt" TIMESTAMPTZ(6) NOT NULL,
    "stage" VARCHAR(16) NOT NULL DEFAULT 'new',
    "rating" INTEGER,
    "stageChangedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hiredAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobApplications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationNotes" (
    "id" VARCHAR(40) NOT NULL,
    "applicationId" VARCHAR(40) NOT NULL,
    "authorId" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationNotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobPostings_slug_key" ON "JobPostings"("slug");

-- CreateIndex
CREATE INDEX "job_postings_status_published_idx" ON "JobPostings"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "job_postings_department_status_idx" ON "JobPostings"("department", "status");

-- CreateIndex
CREATE UNIQUE INDEX "JobApplications_reference_key" ON "JobApplications"("reference");

-- CreateIndex
CREATE INDEX "job_applications_job_stage_idx" ON "JobApplications"("jobId", "stage");

-- CreateIndex
CREATE INDEX "job_applications_stage_created_idx" ON "JobApplications"("stage", "createdAt");

-- CreateIndex
CREATE INDEX "job_applications_email_job_idx" ON "JobApplications"("email", "jobId");

-- CreateIndex
CREATE INDEX "application_notes_application_created_idx" ON "ApplicationNotes"("applicationId", "createdAt");

-- AddForeignKey
ALTER TABLE "JobApplications" ADD CONSTRAINT "JobApplications_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobPostings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationNotes" ADD CONSTRAINT "ApplicationNotes_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationNotes" ADD CONSTRAINT "ApplicationNotes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

