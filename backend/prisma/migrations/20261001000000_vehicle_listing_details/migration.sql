-- The dealer "Add a vehicle" flow: condition, features, video and reference prices.
CREATE TYPE "VehicleAvailability" AS ENUM ('IMMEDIATELY', 'WITHIN_A_WEEK', 'WITHIN_A_MONTH', 'ON_ORDER');

ALTER TABLE "Vehicle"
  ADD COLUMN "horsepower" INTEGER,
  ADD COLUMN "manufacturerColour" TEXT,
  ADD COLUMN "curbWeightLbs" INTEGER,
  ADD COLUMN "isDamaged" BOOLEAN,
  ADD COLUMN "ownerCount" INTEGER,
  ADD COLUMN "availability" "VehicleAvailability",
  ADD COLUMN "extendedWarranty" BOOLEAN,
  ADD COLUMN "videoUrl" TEXT,
  ADD COLUMN "salePriceCad" INTEGER,
  ADD COLUMN "msrpCad" INTEGER,
  ADD COLUMN "invoicePriceCad" INTEGER,
  ADD COLUMN "retailPriceCad" INTEGER,
  ADD COLUMN "wholesalePriceCad" INTEGER;
