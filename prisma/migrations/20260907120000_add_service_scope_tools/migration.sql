-- AlterTable
ALTER TABLE "Services" ADD COLUMN     "scope" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "tools" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "ServiceTranslations" ADD COLUMN     "scope" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "tools" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
