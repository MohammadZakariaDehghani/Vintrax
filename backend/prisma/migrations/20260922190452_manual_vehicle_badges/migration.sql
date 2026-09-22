/*
  Warnings:

  - You are about to drop the column `carfaxFetchError` on the `Vehicle` table. All the data in the column will be lost.
  - You are about to drop the column `carfaxFetchedAt` on the `Vehicle` table. All the data in the column will be lost.
  - You are about to drop the column `carfaxLowKilometres` on the `Vehicle` table. All the data in the column will be lost.
  - You are about to drop the column `carfaxOneOwner` on the `Vehicle` table. All the data in the column will be lost.
  - You are about to drop the column `showVehicleHistory` on the `Vehicle` table. All the data in the column will be lost.
  - You are about to drop the column `source` on the `VehicleHistoryEvent` table. All the data in the column will be lost.

*/
-- Issue #67 reverts the automatic CARFAX extraction (D-047) to five badges
-- the dealer sets directly, and collapses VehicleHistoryEvent to
-- dealer-authored only. `prisma migrate dev`'s generated diff also proposed
-- dropping `Vehicle.searchVector` and its two trigram indexes: that column is
-- deliberately unmodeled in schema.prisma (Prisma has no native tsvector
-- type), created in migration 20260812170000_vehicle_search_vector and kept
-- in sync by several migrations since — unrelated to this change and left
-- alone here, edited out of the auto-generated statements below.

-- AlterTable: add the new badge columns first, still alongside the old
-- extraction-era columns, so the backfill below can read one and write the
-- other in the same migration.
ALTER TABLE "Vehicle"
ADD COLUMN     "badgeCarfax" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "badgeLowKilometres" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "badgeNoAccident" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "badgeOneOwner" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "badgeReport" BOOLEAN NOT NULL DEFAULT false;

-- Carry forward what the extraction era actually found on any vehicle it ran
-- against in production, rather than silently discarding it: a report that
-- was read is exactly the kind of evidence the dealer would tick the new
-- checkbox for. Only a `true` reading (never a `false`/unset one, which the
-- old nullable columns also used for "not stated") sets the new badge, and a
-- link/report having existed at all (`carfaxUrl` set) is now also read as
-- the dealer wanting the CARFAX badge itself shown.
UPDATE "Vehicle" SET "badgeOneOwner" = TRUE WHERE "carfaxOneOwner" = TRUE;
UPDATE "Vehicle" SET "badgeLowKilometres" = TRUE WHERE "carfaxLowKilometres" = TRUE;
UPDATE "Vehicle" SET "badgeCarfax" = TRUE WHERE "carfaxUrl" IS NOT NULL AND "carfaxUrl" != '';

ALTER TABLE "Vehicle" DROP COLUMN "carfaxFetchError",
DROP COLUMN "carfaxFetchedAt",
DROP COLUMN "carfaxLowKilometres",
DROP COLUMN "carfaxOneOwner",
DROP COLUMN "showVehicleHistory";

-- AlterTable
ALTER TABLE "VehicleHistoryEvent" DROP COLUMN "source";

-- DropEnum
DROP TYPE "VehicleHistorySource";
