/**
 * Upload folders served without authentication.
 *
 * Photographs of a car for sale are public by intent — they are the listing.
 * `documents/` is deliberately not here, and nothing should be added without
 * asking whether every anonymous visitor may read it. Nor is
 * `vehicle-originals/`: the untouched uploads the image pipeline keeps for
 * reprocessing still carry the camera's EXIF, GPS position included.
 *
 * The operator uploads the site draws — body-type icons, post photographs,
 * make and partner logos, footer icons, and site images such as the Contact
 * page map — have to be here too. `make-logos` and `partners` were once
 * missing, and every uploaded logo 404ed in every deployment;
 * `public-upload-folders.spec.ts` now fails when an upload route writes to a
 * folder that is neither listed here nor deliberately private.
 */
export const PUBLIC_UPLOAD_FOLDERS = [
  'vehicles',
  'inspections',
  'seed',
  'body-types',
  'articles',
  'make-logos',
  'partners',
  'footer-icons',
  'site',
] as const;

/** Folders an upload route writes to that must never be served to anyone who asks. */
export const PRIVATE_UPLOAD_FOLDERS = ['documents', 'vehicle-originals'] as const;
