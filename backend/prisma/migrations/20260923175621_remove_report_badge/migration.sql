-- Issue #76: the "Report" vehicle badge is removed. It had no meaning of its
-- own — the CARFAX badge and the report link already say a report exists —
-- so the flag is dropped rather than migrated into another badge.
--
-- "Vehicle"."searchVector" and its trigram indexes are maintained by raw SQL
-- (Prisma has no tsvector type), so `migrate diff` always proposes dropping
-- them. Removed by hand, as in every migration since they were added.

-- AlterTable
ALTER TABLE "Vehicle" DROP COLUMN "badgeReport";
