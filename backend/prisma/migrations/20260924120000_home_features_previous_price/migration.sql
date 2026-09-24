-- CreateEnum
CREATE TYPE "HomeFeatureButtonPlacement" AS ENUM ('TEXT_LEFT', 'TEXT_CENTER', 'TEXT_RIGHT', 'ON_IMAGE');

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "previousPriceCad" INTEGER;

-- CreateTable
CREATE TABLE "HomeFeature" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "imageUrl" TEXT,
    "imageAlt" TEXT,
    "buttonLabel" TEXT,
    "buttonUrl" TEXT,
    "buttonPlacement" "HomeFeatureButtonPlacement" NOT NULL DEFAULT 'TEXT_LEFT',
    "position" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeFeature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HomeFeature_enabled_position_idx" ON "HomeFeature"("enabled", "position");

-- AddForeignKey
ALTER TABLE "HomeFeature" ADD CONSTRAINT "HomeFeature_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

