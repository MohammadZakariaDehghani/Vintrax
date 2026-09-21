-- Repurposes the dead `carfaxHistoryApproved` column (never written by any
-- code path since the manual read-report feature was removed) as the
-- dealer's independent toggle for whether the accident timeline is shown on
-- the public listing. A rename rather than drop-and-add: the column already
-- means "cleared for display", it was just never wired to anything.
ALTER TABLE "Vehicle" RENAME COLUMN "carfaxHistoryApproved" TO "showVehicleHistory";

-- The dealer-facing reason the last CARFAX extraction attempt failed, or
-- null when the last attempt succeeded or none has run yet.
ALTER TABLE "Vehicle" ADD COLUMN "carfaxFetchError" TEXT;
