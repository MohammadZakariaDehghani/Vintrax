-- "Contact us" belongs under "About us" and opens the Contact page. The
-- separate "Customer Support" section, which held nothing but a second
-- "Contact us", goes.
--
-- Written against whatever the footer holds, not the seeded ids: on a live
-- site an administrator may have added their own "Contact us" under "About us",
-- pointed at an email address, and that is the link visitors were clicking.

-- 1. Every "Contact us" link opens the Contact page, whatever it pointed at.
UPDATE "FooterLink"
SET "href" = '/contact', "updatedAt" = CURRENT_TIMESTAMP
WHERE lower(btrim("label")) IN ('contact us', 'contact')
  AND "href" <> '/contact';

-- 2. Anything in "Customer Support" moves to the end of "About us", except a
--    "Contact us" when "About us" already has one (it would be a duplicate).
WITH about AS (
  SELECT "id" FROM "FooterSection"
  WHERE lower(btrim("title")) = 'about us'
  ORDER BY "position"
  LIMIT 1
),
support AS (
  SELECT "id" FROM "FooterSection" WHERE lower(btrim("title")) = 'customer support'
),
moving AS (
  SELECT l."id", ROW_NUMBER() OVER (ORDER BY l."position", l."label") AS n
  FROM "FooterLink" l
  WHERE l."sectionId" IN (SELECT "id" FROM support)
    AND NOT (
      lower(btrim(l."label")) IN ('contact us', 'contact')
      AND EXISTS (
        SELECT 1 FROM "FooterLink" a
        WHERE a."sectionId" = (SELECT "id" FROM about)
          AND lower(btrim(a."label")) IN ('contact us', 'contact')
      )
    )
)
UPDATE "FooterLink" l
SET "sectionId" = (SELECT "id" FROM about),
    "position" = COALESCE(
      (SELECT MAX(x."position") FROM "FooterLink" x WHERE x."sectionId" = (SELECT "id" FROM about)),
      -1
    ) + m.n,
    "updatedAt" = CURRENT_TIMESTAMP
FROM moving m
WHERE l."id" = m."id"
  AND EXISTS (SELECT 1 FROM about);

-- 3. "About us" without any "Contact us" (none existed anywhere) gets one.
INSERT INTO "FooterLink" ("id", "sectionId", "label", "href", "position", "updatedAt")
SELECT
  '9d2e4f60-7a8b-4c1d-9e0f-1a2b3c4d5e6f',
  s."id",
  'Contact us',
  '/contact',
  COALESCE((SELECT MAX(x."position") FROM "FooterLink" x WHERE x."sectionId" = s."id"), -1) + 1,
  CURRENT_TIMESTAMP
FROM (
  SELECT "id" FROM "FooterSection"
  WHERE lower(btrim("title")) = 'about us'
  ORDER BY "position"
  LIMIT 1
) s
WHERE NOT EXISTS (
  SELECT 1 FROM "FooterLink" a
  WHERE a."sectionId" = s."id" AND lower(btrim(a."label")) IN ('contact us', 'contact')
);

-- 4. The section itself. Only once "About us" exists to take its links, so a
--    footer without one keeps its contact link rather than losing it.
DELETE FROM "FooterSection"
WHERE lower(btrim("title")) = 'customer support'
  AND EXISTS (SELECT 1 FROM "FooterSection" WHERE lower(btrim("title")) = 'about us');
