-- Dealer cost management (VehicleCost) and where a vehicle came from
-- (Vehicle.source).
--
-- Written by hand from `prisma migrate diff`, less the statements that diff
-- always proposes for the search index Prisma does not model (the trigram
-- indexes and the generated searchVector column), which must stay.

-- CreateEnum
CREATE TYPE "VehicleSource" AS ENUM ('MANUAL', 'CSV_IMPORT');

-- CreateEnum
CREATE TYPE "VehicleCostCategory" AS ENUM ('PURCHASE', 'AUCTION_FEE', 'TRANSPORTATION', 'INSPECTION', 'MECHANICAL_REPAIR', 'BODY_REPAIR', 'DETAILING', 'PARTS', 'TIRES', 'CERTIFICATION', 'LICENSING', 'OTHER');

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "source" "VehicleSource" NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "VehicleCost" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "category" "VehicleCostCategory" NOT NULL,
    "description" TEXT,
    "amountCents" INTEGER NOT NULL,
    "incurredOn" DATE NOT NULL,
    "vendor" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "recordedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VehicleCost_vehicleId_incurredOn_idx" ON "VehicleCost"("vehicleId", "incurredOn");

-- CreateIndex
CREATE INDEX "VehicleCost_vehicleId_category_idx" ON "VehicleCost"("vehicleId", "category");

-- CreateIndex
CREATE INDEX "VehicleCost_createdAt_idx" ON "VehicleCost"("createdAt");

-- CreateIndex
CREATE INDEX "Vehicle_sellerId_updatedAt_idx" ON "Vehicle"("sellerId", "updatedAt");

-- CreateIndex
CREATE INDEX "Vehicle_sellerId_source_idx" ON "Vehicle"("sellerId", "source");

-- AddForeignKey
ALTER TABLE "VehicleCost" ADD CONSTRAINT "VehicleCost_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleCost" ADD CONSTRAINT "VehicleCost_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A cost is money spent; a zero or negative one is a data-entry mistake.
ALTER TABLE "VehicleCost" ADD CONSTRAINT "VehicleCost_amountCents_positive" CHECK ("amountCents" > 0);

-- Vehicles the CSV importer created before this column existed. Each confirmed
-- import stored its per-row outcomes, including the id of every vehicle a CREATE
-- row wrote, so the history is exact rather than guessed.
UPDATE "Vehicle" AS v
SET "source" = 'CSV_IMPORT'
FROM "InventoryImport" AS i,
     jsonb_array_elements(CASE WHEN jsonb_typeof(i."rows") = 'array' THEN i."rows" ELSE '[]'::jsonb END) AS r
WHERE r->>'action' = 'CREATE'
  AND r->>'vehicleId' = v."id"::text
  AND v."sellerId" = i."sellerId";
