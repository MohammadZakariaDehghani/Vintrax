-- A footer link called "Contact us" opens the Contact page, not the visitor's
-- email app. The 20260924 migration repointed the seeded link only when its
-- own "Customer Support" section had been created; where an administrator had
-- already made one, the old mailto was left behind. "Email us" and other
-- deliberate email links are untouched.
UPDATE "FooterLink"
SET "href" = '/contact', "updatedAt" = CURRENT_TIMESTAMP
WHERE lower(btrim("label")) IN ('contact us', 'contact')
  AND "href" ILIKE 'mailto:%';
