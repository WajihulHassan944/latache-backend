CREATE TABLE "SeoSettings" (
  "id" VARCHAR(40) NOT NULL DEFAULT 'global',
  "siteName" VARCHAR(255),
  "defaultTitle" VARCHAR(255),
  "defaultDescription" VARCHAR(1000),
  "defaultCanonicalBaseUrl" VARCHAR(500),
  "defaultOgImageUrl" VARCHAR(1000),
  "defaultOgImageAlt" VARCHAR(255),
  "twitterCard" VARCHAR(32) NOT NULL DEFAULT 'summary_large_image',
  "twitterHandle" VARCHAR(100),
  "defaultRobotsIndex" BOOLEAN NOT NULL DEFAULT true,
  "defaultRobotsFollow" BOOLEAN NOT NULL DEFAULT true,
  "organizationSchema" JSONB NOT NULL DEFAULT '{}',
  "defaultStructuredData" JSONB NOT NULL DEFAULT '{}',
  "robotsRules" JSONB NOT NULL DEFAULT '["Disallow: /api/","Allow: /api/seo/"]',
  "sitemapEnabled" BOOLEAN NOT NULL DEFAULT true,
  "includeServices" BOOLEAN NOT NULL DEFAULT true,
  "includePublicTaskers" BOOLEAN NOT NULL DEFAULT false,
  "servicePathTemplate" VARCHAR(255) NOT NULL DEFAULT '/services/{slug}',
  "taskerPathTemplate" VARCHAR(255) NOT NULL DEFAULT '/taskers/{id}',
  "updatedById" INTEGER,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SeoSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeoPages" (
  "id" VARCHAR(40) NOT NULL,
  "path" VARCHAR(500) NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "title" VARCHAR(255),
  "description" VARCHAR(1000),
  "canonicalUrl" VARCHAR(1000),
  "robotsIndex" BOOLEAN NOT NULL DEFAULT true,
  "robotsFollow" BOOLEAN NOT NULL DEFAULT true,
  "ogTitle" VARCHAR(255),
  "ogDescription" VARCHAR(1000),
  "ogImageUrl" VARCHAR(1000),
  "ogImageAlt" VARCHAR(255),
  "twitterCard" VARCHAR(32),
  "twitterTitle" VARCHAR(255),
  "twitterDescription" VARCHAR(1000),
  "twitterImageUrl" VARCHAR(1000),
  "keywords" VARCHAR(100)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(100)[],
  "structuredData" JSONB NOT NULL DEFAULT '{}',
  "alternates" JSONB NOT NULL DEFAULT '{}',
  "priority" DECIMAL(3,2),
  "changeFrequency" VARCHAR(16),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "updatedById" INTEGER,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SeoPages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "seo_pages_path_locale_unique" ON "SeoPages"("path", "locale");
CREATE INDEX "seo_pages_path_active_idx" ON "SeoPages"("path", "isActive");
CREATE INDEX "seo_pages_locale_active_idx" ON "SeoPages"("locale", "isActive");

CREATE TABLE "SeoRedirects" (
  "id" VARCHAR(40) NOT NULL,
  "fromPath" VARCHAR(500) NOT NULL,
  "toPath" VARCHAR(1000) NOT NULL,
  "statusCode" INTEGER NOT NULL DEFAULT 301,
  "preserveQuery" BOOLEAN NOT NULL DEFAULT true,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "reason" VARCHAR(500),
  "updatedById" INTEGER,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SeoRedirects_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "seo_redirects_from_path_key" ON "SeoRedirects"("fromPath");
CREATE INDEX "seo_redirects_active_from_idx" ON "SeoRedirects"("isActive", "fromPath");

CREATE TABLE "SeoSitemapEntries" (
  "id" VARCHAR(40) NOT NULL,
  "path" VARCHAR(1000) NOT NULL,
  "locale" VARCHAR(10),
  "priority" DECIMAL(3,2),
  "changeFrequency" VARCHAR(16),
  "lastModifiedAt" TIMESTAMPTZ(6),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "updatedById" INTEGER,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SeoSitemapEntries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "seo_sitemap_entries_path_key" ON "SeoSitemapEntries"("path");
CREATE INDEX "seo_sitemap_entries_active_updated_idx" ON "SeoSitemapEntries"("isActive", "updatedAt");

INSERT INTO "SeoSettings" ("id", "siteName", "defaultTitle", "defaultDescription")
VALUES ('global', 'Latache', 'Latache', 'Find trusted local taskers and services with Latache.')
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "RbacRoles" ("id", "code", "name", "description", "permissions", "isSystem", "isActive")
VALUES ('role_content_admin', 'content_admin', 'Content Administrator', 'Content, SEO, service catalogue and review management.', ARRAY['content.read','content.manage','seo.read','seo.manage','services.read','services.manage','reviews.read','reviews.manage']::VARCHAR(100)[], true, true)
ON CONFLICT ("code") DO UPDATE SET "permissions" = EXCLUDED."permissions", "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "RbacRoles"
SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['seo.read','seo.manage']::VARCHAR(100)[])), "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'super_admin';
