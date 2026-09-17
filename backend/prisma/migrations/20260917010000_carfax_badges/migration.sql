-- The two badges a CARFAX Canada report prints, and the report's accident and
-- damage record as timeline entries.
--
-- Hand-written for the same reason the other vehicle migrations are:
-- `Vehicle."searchVector"` is a generated column Prisma cannot express, so it is
-- absent from schema.prisma and `prisma migrate dev` plans to drop it.
--
-- Backwards-compatible: two nullable columns and two new enum values, none of
-- them referenced by the currently deployed API. Rolling back to the previous
-- image leaves a schema the old code still runs against, which matters because
-- `rollback.sh` cannot undo a migration.

-- Nullable, and left NULL for every existing row. "Not stated" and "the report
-- says no" are different claims, and defaulting to false would have Vintrax
-- answer for thousands of sellers who were never asked. Neither column may be
-- set without `carfaxUrl`; that rule lives in the service, which is the only
-- place that can see the merged result of an update.
ALTER TABLE "Vehicle" ADD COLUMN "carfaxOneOwner" BOOLEAN;
ALTER TABLE "Vehicle" ADD COLUMN "carfaxLowKilometres" BOOLEAN;

-- A report's "Accident / Damage Record" is its own section, separate from an
-- insurance claim, and a buyer cares which one they are reading. `NO_ACCIDENTS`
-- is the stated absence: a report that says "no accidents reported" is a fact,
-- where an empty timeline only means the seller typed nothing.
--
-- Positioned to match the order the enum is declared in TypeScript. Adding a
-- value is transactional on PostgreSQL 12 and later, and nothing here uses the
-- new values in the same transaction, which is the case that is still refused.
ALTER TYPE "VehicleHistoryEventKind" ADD VALUE IF NOT EXISTS 'ACCIDENT_DAMAGE' BEFORE 'CLAIM';
ALTER TYPE "VehicleHistoryEventKind" ADD VALUE IF NOT EXISTS 'NO_ACCIDENTS' BEFORE 'NO_CLAIMS';
