-- Account settings and the Marketplace-style messenger (decision D-063).
-- Additive only: two nullable User columns, two nullable Conversation columns.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "username" TEXT;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "buyerArchivedAt" TIMESTAMP(3),
ADD COLUMN     "sellerArchivedAt" TIMESTAMP(3);

-- Every existing account gets a handle, as new ones do at sign-up: the first
-- name's letters and digits (at most 12), then 8 hex characters of the id —
-- the same shape `defaultUsername()` produces, so the two never look different.
UPDATE "User"
SET "username" = left(lower(regexp_replace("firstName", '[^A-Za-z0-9]', '', 'g')), 12)
              || substr(replace("id"::text, '-', ''), 1, 8)
WHERE "username" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
