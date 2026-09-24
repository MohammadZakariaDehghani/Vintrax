-- CreateEnum
CREATE TYPE "ArticleKind" AS ENUM ('POST', 'PAGE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FooterLinkIcon" ADD VALUE 'TIKTOK';
ALTER TYPE "FooterLinkIcon" ADD VALUE 'APPLE';
ALTER TYPE "FooterLinkIcon" ADD VALUE 'ANDROID';

-- DropIndex
DROP INDEX "Article_status_publishedAt_idx";

-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "kind" "ArticleKind" NOT NULL DEFAULT 'POST',
ALTER COLUMN "heroImageUrl" DROP NOT NULL;

-- AlterTable
ALTER TABLE "FooterLink" ADD COLUMN     "imageUrl" TEXT;

-- AlterTable
ALTER TABLE "FooterSection" ADD COLUMN     "column" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "SiteSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "footerCopyright" TEXT NOT NULL DEFAULT '',
    "footerNote" TEXT,
    "contactIntro" TEXT,
    "contactAddress" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "contactHours" TEXT,
    "contactMapImageUrl" TEXT,
    "contactRecipient" TEXT,
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactMessage" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactMessage_createdAt_idx" ON "ContactMessage"("createdAt");

-- CreateIndex
CREATE INDEX "Article_kind_status_publishedAt_idx" ON "Article"("kind", "status", "publishedAt");

-- AddForeignKey
ALTER TABLE "SiteSettings" ADD CONSTRAINT "SiteSettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Content. Every statement below is guarded so an administrator's own edits
-- are never overwritten: a seeded link is only repointed while it still has
-- the value this project seeded it with.
-- ---------------------------------------------------------------------------

-- Columns: the four seeded sections take one column each, left to right.
UPDATE "FooterSection" SET "column" = LEAST("position" + 1, 4);

-- The site settings row, with the copyright lines the footer used to hard-code.
INSERT INTO "SiteSettings" ("id", "footerCopyright", "footerNote", "contactIntro", "contactEmail", "updatedAt")
VALUES (
    1,
    'Vintrax.',
    'All rights reserved. All other trademarks are the property of their respective owners.',
    'Questions about a listing, an auction or your account? Send us a message and we will get back to you.',
    'support@vintrax.ca',
    CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;

-- "About us" as a page of its own, reachable from the footer.
INSERT INTO "Article" ("id", "slug", "title", "subtitle", "body", "kind", "status", "publishedAt", "updatedAt")
SELECT
    '6f1f5b4e-0a51-4a0e-9d8e-3a1d2b7c9e10',
    'about-us',
    'About us',
    'A Canadian marketplace for buying, selling and bidding on vehicles.',
    E'Vintrax brings dealers, private sellers and buyers together in one place: dealer inventory, private listings and live auctions, with independent inspection reports on the vehicles that have them.\n\nAn administrator can rewrite this page and add a photograph from Admin → Pages.',
    'PAGE',
    'PUBLISHED',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Article" WHERE "slug" = 'about-us');

-- The seeded "About Vintrax" link pointed at the home page for want of a page.
UPDATE "FooterLink" SET "href" = '/pages/about-us', "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = '35587d0e-63c7-4296-8c5e-1eb37b0a347d' AND "href" = '/';

-- A "Customer Support" section under "Partners", with the Contact page in it.
-- The seeded "Contact us" mailto under "About us" moves there, repointed.
INSERT INTO "FooterSection" ("id", "title", "position", "column", "updatedAt")
SELECT
    'e3b7c2a4-5d6f-4e81-9a0b-1c2d3e4f5a6b',
    'Customer Support',
    COALESCE((SELECT MAX("position") FROM "FooterSection"), -1) + 1,
    3,
    CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "FooterSection" WHERE lower("title") = 'customer support');

UPDATE "FooterLink"
SET "sectionId" = 'e3b7c2a4-5d6f-4e81-9a0b-1c2d3e4f5a6b', "href" = '/contact', "position" = 0, "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = '8c0de92b-7756-4b25-aca6-e00089a41444'
  AND "href" = 'mailto:support@vintrax.ca'
  AND EXISTS (SELECT 1 FROM "FooterSection" WHERE "id" = 'e3b7c2a4-5d6f-4e81-9a0b-1c2d3e4f5a6b');

INSERT INTO "FooterLink" ("id", "sectionId", "label", "href", "position", "updatedAt")
SELECT 'f4c8d3b5-6e7a-4f92-8b1c-2d3e4f5a6b7c', 'e3b7c2a4-5d6f-4e81-9a0b-1c2d3e4f5a6b', 'Contact us', '/contact', 0, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "FooterSection" WHERE "id" = 'e3b7c2a4-5d6f-4e81-9a0b-1c2d3e4f5a6b')
  AND NOT EXISTS (SELECT 1 FROM "FooterLink" WHERE "sectionId" = 'e3b7c2a4-5d6f-4e81-9a0b-1c2d3e4f5a6b');
