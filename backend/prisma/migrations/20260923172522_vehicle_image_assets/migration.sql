-- CreateEnum
CREATE TYPE "ImageProcessingStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED');

-- "Vehicle"."searchVector" and its trigram indexes are maintained by raw SQL
-- (Prisma has no tsvector type), so `migrate diff` always proposes dropping
-- them. Removed by hand, as in every migration since they were added.

-- AlterTable
ALTER TABLE "VehicleImage" ADD COLUMN     "assetId" UUID;

-- CreateTable
CREATE TABLE "VehicleImageAsset" (
    "id" UUID NOT NULL,
    "status" "ImageProcessingStatus" NOT NULL DEFAULT 'PROCESSING',
    "error" TEXT,
    "url" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "widths" INTEGER[],
    "formats" TEXT[],
    "width" INTEGER,
    "height" INTEGER,
    "originalKey" TEXT,
    "originalContentType" TEXT,
    "originalWidth" INTEGER,
    "originalHeight" INTEGER,
    "originalSizeBytes" INTEGER,
    "legacyUrl" TEXT,
    "uploadedById" UUID,
    "processingMs" INTEGER,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleImageAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VehicleImageAsset_url_key" ON "VehicleImageAsset"("url");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleImageAsset_legacyUrl_key" ON "VehicleImageAsset"("legacyUrl");

-- CreateIndex
CREATE INDEX "VehicleImageAsset_uploadedById_idx" ON "VehicleImageAsset"("uploadedById");

-- CreateIndex
CREATE INDEX "VehicleImage_assetId_idx" ON "VehicleImage"("assetId");

-- AddForeignKey
ALTER TABLE "VehicleImage" ADD CONSTRAINT "VehicleImage_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "VehicleImageAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleImageAsset" ADD CONSTRAINT "VehicleImageAsset_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

