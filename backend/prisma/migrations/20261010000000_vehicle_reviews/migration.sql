-- Vehicle reviews and comments (issue #106, D-067). Additive only: new enums,
-- three tables, indexes, a rating CHECK and partial unique indexes.

-- CreateEnum
CREATE TYPE "VehicleReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'HIDDEN', 'DELETED');

-- CreateEnum
CREATE TYPE "VehicleReviewReportReason" AS ENUM ('SPAM', 'OFFENSIVE', 'HARASSMENT', 'FAKE_REVIEW', 'INCORRECT_INFORMATION', 'PERSONAL_INFORMATION', 'OTHER');

-- CreateEnum
CREATE TYPE "VehicleReviewRejectionReason" AS ENUM ('SPAM', 'INAPPROPRIATE', 'IRRELEVANT', 'DUPLICATE', 'PERSONAL_INFORMATION', 'OTHER');

-- CreateEnum
CREATE TYPE "VehicleReviewAction" AS ENUM ('SUBMITTED', 'EDITED', 'APPROVED', 'REJECTED', 'HIDDEN', 'RESTORED', 'DELETED', 'REPORTS_RESOLVED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'REVIEW_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'REVIEW_REJECTED';

-- CreateTable
CREATE TABLE "VehicleReview" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "userId" UUID,
    "displayName" VARCHAR(40) NOT NULL,
    "rating" SMALLINT NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" CHAR(64) NOT NULL,
    "status" "VehicleReviewStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedPurchase" BOOLEAN NOT NULL DEFAULT false,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ipHash" CHAR(64),
    "userAgentHash" CHAR(64),
    "reportCount" INTEGER NOT NULL DEFAULT 0,
    "openReportCount" INTEGER NOT NULL DEFAULT 0,
    "flaggedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" "VehicleReviewRejectionReason",
    "rejectionNote" VARCHAR(500),
    "hiddenAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "moderatedById" UUID,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleReviewReport" (
    "id" UUID NOT NULL,
    "reviewId" UUID NOT NULL,
    "userId" UUID,
    "reporterHash" CHAR(64) NOT NULL,
    "reason" "VehicleReviewReportReason" NOT NULL,
    "details" VARCHAR(500),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleReviewReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleReviewModerationLog" (
    "id" UUID NOT NULL,
    "reviewId" UUID NOT NULL,
    "actorId" UUID,
    "action" "VehicleReviewAction" NOT NULL,
    "previousStatus" "VehicleReviewStatus",
    "newStatus" "VehicleReviewStatus" NOT NULL,
    "reason" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleReviewModerationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VehicleReview_vehicleId_status_createdAt_idx" ON "VehicleReview"("vehicleId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "VehicleReview_vehicleId_status_rating_idx" ON "VehicleReview"("vehicleId", "status", "rating");

-- CreateIndex
CREATE INDEX "VehicleReview_status_createdAt_idx" ON "VehicleReview"("status", "createdAt");

-- CreateIndex
CREATE INDEX "VehicleReview_userId_vehicleId_idx" ON "VehicleReview"("userId", "vehicleId");

-- CreateIndex
CREATE INDEX "VehicleReview_ipHash_createdAt_idx" ON "VehicleReview"("ipHash", "createdAt");

-- CreateIndex
CREATE INDEX "VehicleReview_vehicleId_contentHash_idx" ON "VehicleReview"("vehicleId", "contentHash");

-- CreateIndex
CREATE INDEX "VehicleReview_flaggedAt_idx" ON "VehicleReview"("flaggedAt");

-- CreateIndex
CREATE INDEX "VehicleReviewReport_reviewId_resolvedAt_idx" ON "VehicleReviewReport"("reviewId", "resolvedAt");

-- CreateIndex
CREATE INDEX "VehicleReviewReport_reporterHash_createdAt_idx" ON "VehicleReviewReport"("reporterHash", "createdAt");

-- CreateIndex
CREATE INDEX "VehicleReviewModerationLog_reviewId_createdAt_idx" ON "VehicleReviewModerationLog"("reviewId", "createdAt");

-- AddForeignKey
ALTER TABLE "VehicleReview" ADD CONSTRAINT "VehicleReview_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleReview" ADD CONSTRAINT "VehicleReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleReview" ADD CONSTRAINT "VehicleReview_moderatedById_fkey" FOREIGN KEY ("moderatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleReviewReport" ADD CONSTRAINT "VehicleReviewReport_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "VehicleReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleReviewReport" ADD CONSTRAINT "VehicleReviewReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleReviewModerationLog" ADD CONSTRAINT "VehicleReviewModerationLog_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "VehicleReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleReviewModerationLog" ADD CONSTRAINT "VehicleReviewModerationLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A rating is a whole number of stars.
ALTER TABLE "VehicleReview" ADD CONSTRAINT "VehicleReview_rating_check" CHECK ("rating" BETWEEN 1 AND 5);

-- One live review per signed-in author per vehicle. A deleted one does not
-- count, so the author may write again; anonymous reviews have no author.
CREATE UNIQUE INDEX "VehicleReview_one_per_author"
  ON "VehicleReview" ("vehicleId", "userId")
  WHERE "userId" IS NOT NULL AND "status" <> 'DELETED';

-- One report per account, or per address for anonymous visitors, per review.
CREATE UNIQUE INDEX "VehicleReviewReport_one_per_user"
  ON "VehicleReviewReport" ("reviewId", "userId")
  WHERE "userId" IS NOT NULL;
CREATE UNIQUE INDEX "VehicleReviewReport_one_per_anonymous"
  ON "VehicleReviewReport" ("reviewId", "reporterHash")
  WHERE "userId" IS NULL;
