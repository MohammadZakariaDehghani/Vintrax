-- A vehicle's history timeline, and the date on the report behind it.
--
-- Hand-written for the same reason the earlier vehicle migrations are:
-- `Vehicle."searchVector"` is a generated column Prisma cannot express, so it is
-- absent from schema.prisma and `prisma migrate dev` plans to drop it.
--
-- Backwards-compatible with the currently deployed API: the new column is
-- nullable and the new table is unreferenced by existing code, so rolling back
-- to the previous image leaves a schema the old code still runs against.

-- The date printed on the document, as distinct from when it was uploaded. A
-- history report dated eight months ago says something different about a vehicle
-- than one pulled this morning, and only the dealer knows which it is.
ALTER TABLE "VehicleDocument" ADD COLUMN "issuedOn" DATE;

CREATE TYPE "VehicleHistoryEventKind" AS ENUM (
  'REGISTERED',
  'SOLD',
  'SERVICE',
  'CLAIM',
  'NO_CLAIMS',
  'INSPECTION',
  'SAFETY_CERTIFIED',
  'RECALL',
  'OTHER'
);

-- Entered by the seller from the report they hold. Vintrax does not retrieve
-- anything from CARFAX; the uploaded report is the evidence and lives in
-- "VehicleDocument".
CREATE TABLE "VehicleHistoryEvent" (
  "id"         UUID NOT NULL,
  "vehicleId"  UUID NOT NULL,
  "kind"       "VehicleHistoryEventKind" NOT NULL,
  "occurredOn" DATE,
  "label"      TEXT NOT NULL,
  "detail"     TEXT,
  "position"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VehicleHistoryEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VehicleHistoryEvent_vehicleId_position_idx"
  ON "VehicleHistoryEvent" ("vehicleId", "position");

-- Cascade: a deleted vehicle's timeline has nothing left to describe.
ALTER TABLE "VehicleHistoryEvent"
  ADD CONSTRAINT "VehicleHistoryEvent_vehicleId_fkey"
  FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
