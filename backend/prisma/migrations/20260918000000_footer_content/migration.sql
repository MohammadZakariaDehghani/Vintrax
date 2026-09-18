-- The site footer (issue #43): an ordered list of sections, each holding an
-- ordered list of links, replacing the hardcoded "Marketplace / Sell /
-- Platform" nav that used to live in `SiteFooter`. An administrator now edits
-- this from /admin/footer, following the same shape as BodyTypeImage and
-- Article: a plain table, a `content:manage`-gated write, and a cached public
-- read.
--
-- Two tables rather than one JSON column: `position` on each is how ordering
-- survives a round trip without the client having to renumber siblings, and a
-- real foreign key means a section can never be deleted out from under links
-- that still reference it.

CREATE TYPE "FooterLinkIcon" AS ENUM ('FACEBOOK', 'INSTAGRAM', 'TWITTER', 'YOUTUBE', 'LINKEDIN', 'EMAIL', 'PHONE');

-- CreateTable
CREATE TABLE "FooterSection" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FooterSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FooterLink" (
    "id" UUID NOT NULL,
    "sectionId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "icon" "FooterLinkIcon",
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FooterLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FooterSection_position_idx" ON "FooterSection"("position");

-- CreateIndex
CREATE INDEX "FooterLink_sectionId_position_idx" ON "FooterLink"("sectionId", "position");

-- AddForeignKey
ALTER TABLE "FooterSection" ADD CONSTRAINT "FooterSection_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FooterLink" ADD CONSTRAINT "FooterLink_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "FooterSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Default content, so the footer never renders empty between this deploy and
-- an administrator's first edit through /admin/footer. Every destination here
-- either already exists in the app or is a mailto:/social placeholder an
-- administrator is expected to point at the real thing.
INSERT INTO "FooterSection" ("id", "title", "position", "updatedAt") VALUES
    ('bd960165-bbcd-445e-92a2-34d54ea9fc23', 'About us', 0, CURRENT_TIMESTAMP),
    ('52160b5a-6fa1-4f90-aaae-93350b8cca50', 'Resources', 1, CURRENT_TIMESTAMP),
    ('974d61e0-55c2-4a00-ab71-7da0ad054321', 'Partners', 2, CURRENT_TIMESTAMP),
    ('35798996-4ef4-4cff-bcc9-990e9bc314f8', 'Stay in touch', 3, CURRENT_TIMESTAMP);

INSERT INTO "FooterLink" ("id", "sectionId", "label", "href", "icon", "position", "updatedAt") VALUES
    ('35587d0e-63c7-4296-8c5e-1eb37b0a347d', 'bd960165-bbcd-445e-92a2-34d54ea9fc23', 'About Vintrax', '/', NULL, 0, CURRENT_TIMESTAMP),
    ('b7aa06b1-346f-4271-a5b0-bf2eda4c3848', 'bd960165-bbcd-445e-92a2-34d54ea9fc23', 'Careers', '/', NULL, 1, CURRENT_TIMESTAMP),
    ('8c0de92b-7756-4b25-aca6-e00089a41444', 'bd960165-bbcd-445e-92a2-34d54ea9fc23', 'Contact us', 'mailto:support@vintrax.ca', NULL, 2, CURRENT_TIMESTAMP),

    ('a7795ff1-dd1e-40b7-b246-ffe7e6cd3d33', '52160b5a-6fa1-4f90-aaae-93350b8cca50', 'Blog', '/blog', NULL, 0, CURRENT_TIMESTAMP),
    ('1315de37-8334-46c0-b4b6-f3ec9c28003e', '52160b5a-6fa1-4f90-aaae-93350b8cca50', 'Browse inventory', '/vehicles', NULL, 1, CURRENT_TIMESTAMP),
    ('6a6458d8-9d3e-432b-b470-71473269e85c', '52160b5a-6fa1-4f90-aaae-93350b8cca50', 'Live auctions', '/auctions', NULL, 2, CURRENT_TIMESTAMP),

    ('19f77f87-2e78-48e3-96ac-b9b55e243018', '974d61e0-55c2-4a00-ab71-7da0ad054321', 'Sell your vehicle', '/register?role=SELLER', NULL, 0, CURRENT_TIMESTAMP),
    ('1f9066de-4088-4545-bfae-cf8b1f801312', '974d61e0-55c2-4a00-ab71-7da0ad054321', 'Dealer registration', '/register?role=DEALER', NULL, 1, CURRENT_TIMESTAMP),
    ('dff08db3-669d-4b6f-b109-c24e2659074e', '974d61e0-55c2-4a00-ab71-7da0ad054321', 'Dealer portal', '/dealer/dashboard', NULL, 2, CURRENT_TIMESTAMP),

    ('7f78e6ec-407c-40b6-ae16-2f53ae48ef65', '35798996-4ef4-4cff-bcc9-990e9bc314f8', 'Facebook', 'https://facebook.com/vintrax', 'FACEBOOK', 0, CURRENT_TIMESTAMP),
    ('c0ad8461-a46a-47ca-8058-9fd4d6c6e646', '35798996-4ef4-4cff-bcc9-990e9bc314f8', 'Instagram', 'https://instagram.com/vintrax', 'INSTAGRAM', 1, CURRENT_TIMESTAMP),
    ('7c7c2d33-0412-4390-b3d7-5ceaabb02ff4', '35798996-4ef4-4cff-bcc9-990e9bc314f8', 'Email us', 'mailto:support@vintrax.ca', 'EMAIL', 2, CURRENT_TIMESTAMP);
