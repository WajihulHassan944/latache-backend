-- Additive multilingual foundation. Canonical columns remain as the final fallback
-- and to preserve compatibility with existing bookings and integrations.
ALTER TABLE "Users" ADD COLUMN "preferredLanguage" VARCHAR(10);

ALTER TABLE "TaskNotifications"
  ADD COLUMN "templateKey" VARCHAR(100),
  ADD COLUMN "templateParams" JSONB,
  ADD COLUMN "renderedLocale" VARCHAR(10);

CREATE TABLE "ServiceTranslations" (
  "id" VARCHAR(40) NOT NULL,
  "serviceId" INTEGER NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "description" TEXT,
  "normalizedName" VARCHAR(255) NOT NULL,
  "normalizedDescription" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ServiceTranslations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ServiceTranslations_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Services"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ServiceOptionTranslations" (
  "id" VARCHAR(40) NOT NULL,
  "serviceOptionId" INTEGER NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "description" VARCHAR(500),
  "normalizedName" VARCHAR(255) NOT NULL,
  "normalizedDescription" VARCHAR(500),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ServiceOptionTranslations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ServiceOptionTranslations_serviceOptionId_fkey" FOREIGN KEY ("serviceOptionId") REFERENCES "ServiceOptions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "EliteTierTranslations" (
  "id" VARCHAR(40) NOT NULL,
  "tierId" VARCHAR(40) NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "description" VARCHAR(500),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EliteTierTranslations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EliteTierTranslations_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "EliteTiers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "EliteBenefitTranslations" (
  "id" VARCHAR(40) NOT NULL,
  "benefitId" VARCHAR(40) NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(500),
  "displayValue" VARCHAR(120),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EliteBenefitTranslations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EliteBenefitTranslations_benefitId_fkey" FOREIGN KEY ("benefitId") REFERENCES "EliteBenefits"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "EliteBadgeTranslations" (
  "id" VARCHAR(40) NOT NULL,
  "badgeId" VARCHAR(40) NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(500),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EliteBadgeTranslations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EliteBadgeTranslations_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "EliteBadges"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "service_translations_service_locale_unique" ON "ServiceTranslations"("serviceId", "locale");
CREATE INDEX "service_translations_locale_name_idx" ON "ServiceTranslations"("locale", "normalizedName");
CREATE UNIQUE INDEX "service_option_translations_option_locale_unique" ON "ServiceOptionTranslations"("serviceOptionId", "locale");
CREATE INDEX "service_option_translations_locale_name_idx" ON "ServiceOptionTranslations"("locale", "normalizedName");
CREATE UNIQUE INDEX "elite_tier_translations_tier_locale_unique" ON "EliteTierTranslations"("tierId", "locale");
CREATE INDEX "elite_tier_translations_locale_name_idx" ON "EliteTierTranslations"("locale", "name");
CREATE UNIQUE INDEX "elite_benefit_translations_benefit_locale_unique" ON "EliteBenefitTranslations"("benefitId", "locale");
CREATE INDEX "elite_benefit_translations_locale_name_idx" ON "EliteBenefitTranslations"("locale", "name");
CREATE UNIQUE INDEX "elite_badge_translations_badge_locale_unique" ON "EliteBadgeTranslations"("badgeId", "locale");
CREATE INDEX "elite_badge_translations_locale_name_idx" ON "EliteBadgeTranslations"("locale", "name");

-- Existing customer-facing content is canonical English. No Arabic content is fabricated.
INSERT INTO "ServiceTranslations" ("id", "serviceId", "locale", "name", "description", "normalizedName", "normalizedDescription")
SELECT 'st_' || substr(md5('service:' || "id"::text), 1, 25), "id", 'en', "name", "description", lower("name"), lower("description")
FROM "Services" WHERE "name" IS NOT NULL
ON CONFLICT ("serviceId", "locale") DO NOTHING;

INSERT INTO "ServiceOptionTranslations" ("id", "serviceOptionId", "locale", "name", "description", "normalizedName", "normalizedDescription")
SELECT 'so_' || substr(md5('service-option:' || "id"::text), 1, 25), "id", 'en', "name", "description", lower("name"), lower("description")
FROM "ServiceOptions"
ON CONFLICT ("serviceOptionId", "locale") DO NOTHING;

INSERT INTO "EliteTierTranslations" ("id", "tierId", "locale", "name", "description")
SELECT 'et_' || substr(md5('elite-tier:' || "id"), 1, 25), "id", 'en', "name", "description" FROM "EliteTiers"
ON CONFLICT ("tierId", "locale") DO NOTHING;

INSERT INTO "EliteBenefitTranslations" ("id", "benefitId", "locale", "name", "description", "displayValue")
SELECT 'eb_' || substr(md5('elite-benefit:' || "id"), 1, 25), "id", 'en', "name", "description", "displayValue" FROM "EliteBenefits"
ON CONFLICT ("benefitId", "locale") DO NOTHING;

INSERT INTO "EliteBadgeTranslations" ("id", "badgeId", "locale", "name", "description")
SELECT 'eg_' || substr(md5('elite-badge:' || "id"), 1, 25), "id", 'en', "name", "description" FROM "EliteBadges"
ON CONFLICT ("badgeId", "locale") DO NOTHING;
