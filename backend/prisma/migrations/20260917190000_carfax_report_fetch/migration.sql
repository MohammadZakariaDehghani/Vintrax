-- Reading the accident record out of a dealer's CARFAX report.
--
-- Hand-written for the same reason the other vehicle migrations are:
-- `Vehicle."searchVector"` is a generated column Prisma cannot express, so it is
-- absent from schema.prisma and `prisma migrate dev` plans to drop it.
--
-- Backwards-compatible: one new enum, one column with a default on an existing
-- table, one nullable column, none of them referenced by the currently deployed
-- API. Rolling back to the previous image leaves a schema the old code still
-- runs against, which matters because `rollback.sh` cannot undo a migration.

-- Where a timeline entry came from. Defaulted to SELLER so every existing row
-- keeps its meaning: those entries were typed by a dealer, and that is what
-- SELLER records. CARFAX-sourced rows are replaced wholesale on each re-read.
CREATE TYPE "VehicleHistorySource" AS ENUM ('SELLER', 'CARFAX');

ALTER TABLE "VehicleHistoryEvent"
  ADD COLUMN "source" "VehicleHistorySource" NOT NULL DEFAULT 'SELLER';

-- Fetching a report is not the same act as publishing what it says. The dealer
-- reads what came back, with the report open, and ticks the box. Defaulting to
-- false means a vehicle that predates this shows nothing new until someone
-- decides it should.
ALTER TABLE "Vehicle" ADD COLUMN "carfaxHistoryApproved" BOOLEAN NOT NULL DEFAULT false;

-- When the report was last read, so nobody has to guess how stale the reading is.
ALTER TABLE "Vehicle" ADD COLUMN "carfaxFetchedAt" TIMESTAMP(3);
