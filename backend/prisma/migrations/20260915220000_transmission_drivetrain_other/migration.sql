-- "Other" as a real transmission and drivetrain.
--
-- Both enumerations were incomplete rather than merely inconvenient: a
-- battery-electric car has a single-speed reduction gear and none of the four
-- transmissions listed, and drivetrains exist that are none of FWD, RWD, AWD or
-- 4WD. Dealership inventory feeds say "Other" for exactly these, and the CSV
-- importer records that value rather than guessing a plausible one.
--
-- Additive only. Nothing is renamed or removed, so the previously deployed API
-- runs unchanged against this schema — it simply never writes the new value.

ALTER TYPE "Transmission" ADD VALUE IF NOT EXISTS 'OTHER';
ALTER TYPE "Drivetrain" ADD VALUE IF NOT EXISTS 'OTHER';
