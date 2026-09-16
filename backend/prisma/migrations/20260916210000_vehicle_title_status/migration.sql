-- The brand on a vehicle's title.
--
-- Hand-written for the same reason the other vehicle migrations are:
-- `Vehicle."searchVector"` is a generated column Prisma cannot express, so it is
-- absent from schema.prisma and `prisma migrate dev` plans to drop it.
--
-- Backwards-compatible: the column is nullable and unreferenced by the
-- currently deployed API, so rolling back to the previous image leaves a schema
-- the old code still runs against.

CREATE TYPE "TitleStatus" AS ENUM ('CLEAN', 'REBUILT', 'SALVAGE');

-- Nullable and left NULL for every existing row. Backfilling these to 'CLEAN'
-- would be the database asserting something about thousands of vehicles that
-- nobody checked; "not stated" is the truth and is what the listing shows.
ALTER TABLE "Vehicle" ADD COLUMN "titleStatus" "TitleStatus";

-- A seller's link to the vehicle's CARFAX report. Validated against the real
-- CARFAX hosts by the application before it is stored: the badge this sits
-- behind carries a third party's name, and an unchecked link would let a seller
-- put that name on a link to anywhere.
ALTER TABLE "Vehicle" ADD COLUMN "carfaxUrl" TEXT;
