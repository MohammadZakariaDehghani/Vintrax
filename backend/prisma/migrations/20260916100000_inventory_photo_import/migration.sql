-- Photos imported from a dealer feed.
--
-- Hand-written for the same reason the earlier inventory migration is:
-- `Vehicle."searchVector"` is a generated column Prisma cannot express, so it is
-- absent from schema.prisma and `prisma migrate dev` plans to drop it.
--
-- Backwards-compatible with the currently deployed API. Every column added is
-- nullable or defaulted, and nothing existing is dropped or narrowed, so rolling
-- back to the previous image leaves a schema the old code still runs against.

-- Where an imported photo came from, and the feed's own last-modified stamp for
-- it. Together they are the identity of an imported photo: unchanged means the
-- next import reuses what is already stored instead of downloading it again.
--
-- Both are NULL for a photo uploaded through the web application, which is what
-- tells the importer which rows it owns and may replace.
ALTER TABLE "VehicleImage" ADD COLUMN "sourceUrl" TEXT;
ALTER TABLE "VehicleImage" ADD COLUMN "sourceUpdatedAt" TIMESTAMP(3);

-- Backs the reconciliation lookup, which is always "this vehicle's photo from
-- that address".
CREATE INDEX "VehicleImage_vehicleId_sourceUrl_idx"
  ON "VehicleImage" ("vehicleId", "sourceUrl");

CREATE TYPE "InventoryPhotoStatus" AS ENUM (
  'NOT_REQUESTED',
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'COMPLETED_WITH_ERRORS',
  'FAILED'
);

-- Photo progress for one import run. The vehicles are written and returned
-- before any photo is fetched, so these advance after the import row already
-- reads COMPLETED.
ALTER TABLE "InventoryImport"
  ADD COLUMN "photoStatus"      "InventoryPhotoStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
  ADD COLUMN "photosExpected"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "photosFetched"    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "photosReused"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "photosFailed"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "photoErrors"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "photosFinishedAt" TIMESTAMP(3);
