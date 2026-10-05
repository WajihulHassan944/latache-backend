-- CreateTable
CREATE TABLE "SeoKeywords" (
  "id" VARCHAR(40) NOT NULL,
  "pageId" VARCHAR(40) NOT NULL,
  "term" VARCHAR(100) NOT NULL,
  "priority" VARCHAR(16) NOT NULL DEFAULT 'medium',
  "status" VARCHAR(16) NOT NULL DEFAULT 'active',
  "updatedById" INTEGER,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SeoKeywords_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "seo_keywords_page_term_unique" ON "SeoKeywords"("pageId", "term");

-- CreateIndex
CREATE INDEX "seo_keywords_page_status_idx" ON "SeoKeywords"("pageId", "status");

-- AddForeignKey
ALTER TABLE "SeoKeywords" ADD CONSTRAINT "SeoKeywords_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "SeoPages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
