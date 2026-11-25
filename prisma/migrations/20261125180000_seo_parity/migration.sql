ALTER TABLE "SeoSettings"
  ADD COLUMN "googleSiteVerification" VARCHAR(255),
  ADD COLUMN "bingSiteVerification" VARCHAR(255),
  ADD COLUMN "googleAnalyticsId" VARCHAR(64),
  ADD COLUMN "metaPixelId" VARCHAR(64),
  ADD COLUMN "llmsSummary" VARCHAR(4000),
  ADD COLUMN "indexNowEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "SeoRedirects"
  ADD COLUMN "hits" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastHitAt" TIMESTAMPTZ(6);

CREATE TABLE "SeoNotFoundHits" (
  "id" VARCHAR(40) NOT NULL,
  "path" VARCHAR(500) NOT NULL,
  "hits" INTEGER NOT NULL DEFAULT 1,
  "lastReferrer" VARCHAR(1000),
  "lastSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SeoNotFoundHits_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "seo_not_found_path_key" ON "SeoNotFoundHits"("path");
CREATE INDEX "seo_not_found_resolved_hits_idx" ON "SeoNotFoundHits"("resolved", "hits");

CREATE TABLE "SeoBacklinks" (
  "id" VARCHAR(40) NOT NULL,
  "sourceUrl" VARCHAR(1000) NOT NULL,
  "targetPath" VARCHAR(500) NOT NULL DEFAULT '/',
  "anchorText" VARCHAR(255),
  "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
  "isDofollow" BOOLEAN NOT NULL DEFAULT true,
  "notes" VARCHAR(1000),
  "lastCheckedAt" TIMESTAMPTZ(6),
  "updatedById" INTEGER,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SeoBacklinks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "seo_backlinks_status_created_idx" ON "SeoBacklinks"("status", "createdAt");
