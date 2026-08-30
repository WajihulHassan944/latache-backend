CREATE TABLE "ContentPages" (
  "id" VARCHAR(40) NOT NULL,
  "slug" VARCHAR(120) NOT NULL,
  "pageType" VARCHAR(64) NOT NULL DEFAULT 'standard',
  "status" VARCHAR(32) NOT NULL DEFAULT 'draft',
  "isPublished" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "title" VARCHAR(255),
  "description" TEXT,
  "seoTitle" VARCHAR(255),
  "seoDescription" VARCHAR(1000),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "publishedAt" TIMESTAMPTZ(6),
  "updatedById" INTEGER,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentPages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "content_pages_slug_key" ON "ContentPages"("slug");
CREATE INDEX "content_pages_publish_idx" ON "ContentPages"("status", "isPublished", "updatedAt");
CREATE INDEX "content_pages_updated_idx" ON "ContentPages"("updatedAt", "id");

CREATE TABLE "ContentPageTranslations" (
  "id" VARCHAR(40) NOT NULL,
  "pageId" VARCHAR(40) NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "title" VARCHAR(255),
  "description" TEXT,
  "seoTitle" VARCHAR(255),
  "seoDescription" VARCHAR(1000),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentPageTranslations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "content_page_translations_page_locale_unique" ON "ContentPageTranslations"("pageId", "locale");
CREATE INDEX "content_page_translations_locale_idx" ON "ContentPageTranslations"("locale");
ALTER TABLE "ContentPageTranslations" ADD CONSTRAINT "ContentPageTranslations_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "ContentPages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ContentBlocks" (
  "id" VARCHAR(40) NOT NULL,
  "pageId" VARCHAR(40) NOT NULL,
  "key" VARCHAR(120) NOT NULL,
  "type" VARCHAR(64) NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentBlocks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "content_blocks_page_key_unique" ON "ContentBlocks"("pageId", "key");
CREATE INDEX "content_blocks_page_active_sort_idx" ON "ContentBlocks"("pageId", "isActive", "sortOrder");
ALTER TABLE "ContentBlocks" ADD CONSTRAINT "ContentBlocks_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "ContentPages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ContentBlockTranslations" (
  "id" VARCHAR(40) NOT NULL,
  "blockId" VARCHAR(40) NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "title" VARCHAR(255),
  "subtitle" VARCHAR(500),
  "body" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentBlockTranslations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "content_block_translations_block_locale_unique" ON "ContentBlockTranslations"("blockId", "locale");
CREATE INDEX "content_block_translations_locale_idx" ON "ContentBlockTranslations"("locale");
ALTER TABLE "ContentBlockTranslations" ADD CONSTRAINT "ContentBlockTranslations_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "ContentBlocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "user_availabilities_discovery_date_idx" ON "UserAvailabilities"("date", "isBooked", "userId");

-- Create editable page shells for the current public information architecture.
-- They remain drafts so existing frontend-static content is not replaced until an administrator publishes managed content.
INSERT INTO "ContentPages" ("id", "slug", "pageType", "status", "isPublished", "title") VALUES
  ('content_home', 'home', 'homepage', 'draft', false, 'Home'),
  ('content_about', 'about', 'information', 'draft', false, 'About'),
  ('content_privacy', 'privacy-policy', 'legal', 'draft', false, 'Privacy Policy'),
  ('content_terms', 'terms-of-service', 'legal', 'draft', false, 'Terms of Service')
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "ContentBlocks" ("id", "pageId", "key", "type", "sortOrder", "isActive") VALUES
  ('block_home_hero', 'content_home', 'hero', 'hero', 10, true),
  ('block_home_services', 'content_home', 'services', 'service_grid', 20, true),
  ('block_home_recommended', 'content_home', 'recommended_jobs', 'tasker_or_job_carousel', 30, true),
  ('block_home_how_it_works', 'content_home', 'how_it_works', 'steps', 40, true),
  ('block_home_popular', 'content_home', 'popular_projects', 'project_grid', 50, true),
  ('block_home_testimonials', 'content_home', 'testimonials', 'testimonial_grid', 60, true),
  ('block_home_social', 'content_home', 'social_links', 'social_links', 70, true)
ON CONFLICT ("pageId", "key") DO NOTHING;

INSERT INTO "ContentBlocks" ("id", "pageId", "key", "type", "sortOrder", "isActive") VALUES
  ('block_about_content', 'content_about', 'content', 'rich_content', 10, true),
  ('block_privacy_content', 'content_privacy', 'policy', 'rich_content', 10, true),
  ('block_terms_content', 'content_terms', 'terms', 'rich_content', 10, true)
ON CONFLICT ("pageId", "key") DO NOTHING;
