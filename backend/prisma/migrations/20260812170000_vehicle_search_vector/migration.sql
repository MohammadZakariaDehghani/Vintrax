-- Full-text search support for vehicles.
--
-- Prisma cannot express generated columns, so this migration is hand-written.
-- The weights control ranking: a match on the title or make/model outranks a
-- match buried in the description.
--
--   A  title, make, model
--   B  trim, exterior colour
--   C  description
--
-- `features` is deliberately excluded: array_to_string is STABLE rather than
-- IMMUTABLE, so PostgreSQL rejects it inside a generated column. Feature
-- matching is handled as a structured filter instead.

ALTER TABLE "Vehicle"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("make", '') || ' ' || coalesce("model", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("trim", '') || ' ' || coalesce("exteriorColour", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'C')
  ) STORED;

CREATE INDEX "Vehicle_searchVector_idx" ON "Vehicle" USING GIN ("searchVector");

-- Trigram indexes so misspellings and partial words still find something when
-- the full-text query returns nothing.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Vehicle_make_trgm_idx" ON "Vehicle" USING GIN ("make" gin_trgm_ops);
CREATE INDEX "Vehicle_model_trgm_idx" ON "Vehicle" USING GIN ("model" gin_trgm_ops);
