-- The media system (documentation/media-system.md): a media library, a home
-- page hero, and a picture-or-video "presentation" on blog posts, home
-- features and home boxes. Every change adds a nullable column or a column
-- with a default, so existing rows keep working unchanged: content with no
-- `media` falls back to the photo or video it was saved with.

-- CreateEnum
CREATE TYPE "HomeFeatureLayout" AS ENUM ('SPLIT', 'FULL_BLEED');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('IMAGE', 'VIDEO');

-- CreateEnum
CREATE TYPE "HomeHeroHeight" AS ENUM ('MEDIUM', 'LARGE', 'FULL');

-- CreateEnum
CREATE TYPE "HomeHeroAlign" AS ENUM ('LEFT', 'CENTER');

-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "homeOrder" INTEGER,
ADD COLUMN     "media" JSONB;

-- AlterTable
ALTER TABLE "HomeFeature" ADD COLUMN     "layout" "HomeFeatureLayout" NOT NULL DEFAULT 'SPLIT',
ADD COLUMN     "media" JSONB,
ADD COLUMN     "subtitle" TEXT;

-- AlterTable
ALTER TABLE "PromoTile" ADD COLUMN     "body" TEXT,
ADD COLUMN     "ctaLabel" TEXT,
ADD COLUMN     "media" JSONB,
ADD COLUMN     "title" TEXT;

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" UUID NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "label" TEXT NOT NULL,
    "alt" TEXT,
    "url" TEXT NOT NULL,
    "posterUrl" TEXT,
    "smallUrl" TEXT,
    "baseUrl" TEXT,
    "widths" INTEGER[],
    "formats" TEXT[],
    "width" INTEGER,
    "height" INTEGER,
    "durationSeconds" DOUBLE PRECISION,
    "sizeBytes" INTEGER NOT NULL,
    "contentType" TEXT NOT NULL,
    "storageKeys" TEXT[],
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeHero" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "primaryCtaLabel" TEXT,
    "primaryCtaUrl" TEXT,
    "secondaryCtaLabel" TEXT,
    "secondaryCtaUrl" TEXT,
    "overlayOpacity" INTEGER NOT NULL DEFAULT 40,
    "align" "HomeHeroAlign" NOT NULL DEFAULT 'LEFT',
    "height" "HomeHeroHeight" NOT NULL DEFAULT 'LARGE',
    "media" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeHero_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_url_key" ON "MediaAsset"("url");

-- CreateIndex
CREATE INDEX "MediaAsset_kind_createdAt_idx" ON "MediaAsset"("kind", "createdAt");

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeHero" ADD CONSTRAINT "HomeHero_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
