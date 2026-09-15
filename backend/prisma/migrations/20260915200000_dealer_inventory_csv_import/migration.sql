-- Dealer inventory CSV import.
--
-- Hand-written rather than generated, for the same reason the search-vector
-- migration is: `Vehicle."searchVector"` is a generated column Prisma cannot
-- express, so it is absent from schema.prisma and `prisma migrate dev` plans to
-- drop it. Writing the SQL keeps the diff to what actually changed.
--
-- Both additions are backwards-compatible with the currently deployed API: the
-- new column is nullable and the new table is unreferenced by existing code, so
-- rolling back to the previous image leaves a schema the old code still runs
-- against.

-- The seller's own stock number. Nullable, because every vehicle listed before
-- this migration has none and most private sellers never will.
ALTER TABLE "Vehicle" ADD COLUMN "stockNumber" TEXT;

-- Unique per seller, not globally: two dealerships both numbering a car "A1042"
-- is normal, and a global constraint would stop the second one listing it.
-- Postgres does not treat NULLs as equal, so the many rows without a stock
-- number do not collide with each other.
CREATE UNIQUE INDEX "Vehicle_sellerId_stockNumber_key"
  ON "Vehicle" ("sellerId", "stockNumber");

-- Backs the importer's match lookup, which is always scoped to one seller.
CREATE INDEX "Vehicle_sellerId_vin_idx" ON "Vehicle" ("sellerId", "vin");

CREATE TYPE "InventoryImportStatus" AS ENUM (
  'VALIDATED',
  'COMPLETED',
  'COMPLETED_WITH_ERRORS',
  'FAILED'
);

-- One row per confirmed import. A preview writes nothing.
CREATE TABLE "InventoryImport" (
  "id"             UUID NOT NULL,
  "sellerId"       UUID NOT NULL,
  "initiatedById"  UUID,
  "filename"       TEXT NOT NULL,
  "schemaVersion"  INTEGER NOT NULL,
  "fileHash"       TEXT NOT NULL,
  "status"         "InventoryImportStatus" NOT NULL,
  "totalRows"      INTEGER NOT NULL DEFAULT 0,
  "createdCount"   INTEGER NOT NULL DEFAULT 0,
  "updatedCount"   INTEGER NOT NULL DEFAULT 0,
  "unchangedCount" INTEGER NOT NULL DEFAULT 0,
  "errorCount"     INTEGER NOT NULL DEFAULT 0,
  "rows"           JSONB,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"    TIMESTAMP(3),

  CONSTRAINT "InventoryImport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InventoryImport_sellerId_createdAt_idx"
  ON "InventoryImport" ("sellerId", "createdAt");

-- The seller's history goes with the seller. The initiator is set null instead,
-- so deleting an administrator does not erase the record of what they did.
ALTER TABLE "InventoryImport"
  ADD CONSTRAINT "InventoryImport_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InventoryImport"
  ADD CONSTRAINT "InventoryImport_initiatedById_fkey"
  FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
