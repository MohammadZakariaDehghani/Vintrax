# API reference

**Base URL:** all routes are prefixed with `/api`.
**Interactive docs:** `http://localhost:3001/api/docs` (disabled in production).
**Contract source:** `packages/shared/src/schemas.ts` and `contracts.ts`.

## Authentication

```http
Authorization: Bearer <accessToken>
```

Access tokens expire in 15 minutes. On expiry, exchange the refresh token at
`POST /api/auth/refresh` — the web client does this automatically.

The **Auth** column uses:

| Marker   | Meaning                                              |
| -------- | ---------------------------------------------------- |
| —        | No authentication                                    |
| optional | Works anonymously; a token personalises the response |
| ✅       | Any authenticated user                               |
| verified | Requires a verified email address                    |
| seller   | `SELLER` or `DEALER` (or admin)                      |
| owner    | The resource's owner (or admin)                      |
| admin    | `ADMIN` or `SUPER_ADMIN`                             |

## Auth

| Method  | Path                    | Auth | Purpose                                 |
| ------- | ----------------------- | ---- | --------------------------------------- |
| `POST`  | `/auth/register`        | —    | Create an account, receive tokens       |
| `POST`  | `/auth/login`           | —    | Exchange credentials for tokens         |
| `POST`  | `/auth/refresh`         | —    | Rotate a refresh token                  |
| `POST`  | `/auth/logout`          | —    | Revoke a refresh token                  |
| `GET`   | `/auth/me`              | ✅   | The authenticated user with permissions |
| `PATCH` | `/auth/password`        | ✅   | Change password, ending other sessions  |
| `POST`  | `/auth/password/forgot` | —    | Start a reset (always 202)              |
| `POST`  | `/auth/password/reset`  | —    | Complete a reset                        |
| `POST`  | `/auth/email/verify`    | —    | Confirm an email address                |
| `POST`  | `/auth/email/resend`    | ✅   | Send a fresh verification email         |

**Register** requires `email`, `password` (10–128 chars), `firstName`,
`lastName`. `role` is `BUYER`, `SELLER` or `DEALER` — admin roles are never
self-assignable. `dealershipName` is required when `role` is `DEALER`.

## Users

| Method   | Path                        | Auth          | Purpose                          |
| -------- | --------------------------- | ------------- | -------------------------------- |
| `PATCH`  | `/me`                       | ✅            | Update profile                   |
| `GET`    | `/me/addresses`             | ✅            | List saved addresses             |
| `POST`   | `/me/addresses`             | ✅            | Save an address                  |
| `DELETE` | `/me/addresses/:id`         | ✅            | Delete an address                |
| `GET`    | `/admin/users`              | `user:read`   | List platform users              |
| `GET`    | `/admin/users/:id`          | `user:read`   | Read one account                 |
| `POST`   | `/admin/users`              | `user:manage` | Create an account, with its role |
| `PATCH`  | `/admin/users/:id/role`     | `user:manage` | Change an account's role         |
| `PATCH`  | `/admin/users/:id/password` | `user:manage` | Set an account's password        |
| `PATCH`  | `/admin/users/:id/status`   | `user:manage` | Suspend, reactivate, deactivate  |

Suspending an account also revokes its live sessions.

The four `/admin/users` write paths all run the same two rules, on the server,
regardless of what the caller's UI offered:

- **`canAssignRole`** — a `SUPER_ADMIN` may assign any role; an `ADMIN` may
  assign `BUYER`, `SELLER`, `DEALER` and `INSPECTOR` but not `ADMIN` or
  `SUPER_ADMIN`. Without this an admin could mint a peer, or promote themselves
  through a second account.
- **`canAdministerUser`** — only a `SUPER_ADMIN` may act on another
  administrator. An `ADMIN` aimed at one gets `404`, not `403`: refusing by
  name would confirm the account exists and say who the administrators are.

Three self-actions are refused outright, for anyone: changing your own role,
changing your own status, and setting your own password. The last of those
matters most — allowing it would turn this into a way to change a password
without knowing the current one, which is exactly what `PATCH /auth/password`
exists to require.

**Setting a password** (`PATCH /admin/users/:id/password`) takes `password`
(10–128 chars) and an optional `reason`. It is the recovery path for an account
whose owner cannot use either ordinary route — no working mailbox, so no reset
link, and no current password to prove. It hashes with bcrypt at the same cost
as registration, revokes every live session, and consumes any unconsumed
`PASSWORD_RESET` token so a link mailed earlier cannot overwrite what was just
set. The audit entry records the reason; it never records the password.

Demoting the last active `SUPER_ADMIN` is refused, and promoting an account
into `DEALER` is refused when it has no dealership — create a dealer account
instead, so the dealership is created with it.

## Bulk vehicle actions

| Method  | Path                      | Permission                       | Purpose                                |
| ------- | ------------------------- | -------------------------------- | -------------------------------------- |
| `PATCH` | `/vehicles/bulk-status`   | `vehicle:write`                  | Move many of the caller's own listings |
| `PATCH` | `/vehicles/bulk-moderate` | `vehicle:publish`, `user:manage` | Approve or reject many awaiting review |
| `POST`  | `/vehicles/bulk-delete`   | `vehicle:delete`                 | Delete many vehicles                   |
| `PUT`   | `/vehicles/:id/history`   | `vehicle:write`                  | Replace a vehicle's history timeline   |

Each id in a bulk request is applied through the same service method the
single-vehicle endpoint uses, one at a time. That is the design rather than a
performance compromise: the transition table, the live-auction guard, the
paid-order guard, ownership and the moderation notification are all enforced
because the path that enforces them is the path that runs. An `updateMany` here
would be a second implementation of those rules.

Partial success is the normal outcome. Every id returns `{ id, ok, title, error }`,
one refusal does not undo the rest, and only messages from exceptions the
application raised deliberately are relayed. Up to `MAX_BULK_VEHICLE_IDS` (200)
per request; duplicate ids collapse. A seller still cannot reach `ACTIVE` —
`bulk-status` accepts only the seller-settable statuses, exactly as the single
endpoint does.

No bulk route carries `@Audit`: that decorator takes its entity id from
`request.params.id`, which a bulk route has none of, and would file a single
entry with a null id. For status and moderation the service writes one entry per
vehicle actually changed; for delete the single-vehicle path already does.

**Delete** is `POST` because it carries a body, and requires `confirm: true` so a
destructive request is not one character from a harmless one. Each id runs
through the single-vehicle delete, so a vehicle under a live auction or holding
a sales record is still refused, and a seller still reaches only their own —
the route grants nobody anything they did not have one vehicle at a time. Each
deletion audits itself, so unlike the other two bulk routes the service writes
no extra entry.

**Search.** `GET /vehicles/mine` and `GET /dealers` both accept `q`. It is a
plain case-insensitive `contains` across the few fields each is looked up by —
not the public full-text index, which covers only published listings and would
therefore never find the draft a dealer is hunting for. Terms are ANDed so
typing more narrows, capped at six, and a four-digit term also matches the model
year. On `/vehicles/mine` the term is an _additional_ constraint: `sellerId`
comes from the authenticated user, so the worst a hostile term can do is match
nothing.

**CARFAX link.** A vehicle may carry an optional `carfaxUrl`. The host must be
exactly `vhr.carfax.ca`, over https, with no credentials — an exact match, not a
suffix match, so `vhr.carfax.ca.example.com` and `evil.vhr.carfax.ca` are both
refused. That is the address CARFAX gives a dealer to share a report, so it is
the only address that holds one to read; a `www.carfax.ca` page is a valid
CARFAX URL containing nothing about any particular car. Pinning it is also most
of the SSRF answer, and it keeps a badge carrying a third party's name from
pointing anywhere else. It appears on the summary as well as the detail, since
the search cards draw the badge. It is purely an associated reference (issue
#67, superseding D-047): nothing reads or scrapes this page.

**Badges.** Four booleans the dealer sets directly — `badgeLowKilometres`,
`badgeOneOwner`, `badgeNoAccident`, `badgeCarfax` — each independent of the
others and of `carfaxUrl` itself. (A fifth, `badgeReport`, was removed in
issue #76; the update schema is strict, so sending it is now a 400.) `create`/`update` accept
them as plain fields alongside everything else; there is no background job,
no fetch, and no per-viewer visibility rule. They ride with `carfaxUrl` on the
summary as well as the detail response, since the search cards draw the badge
strip, and `toVehicleSummary` carries them into one nested `badges` object —
the single source of truth every badge-drawing surface in the app (the card,
the row, the detail page, search results, comparison) reads from, rather than
each keeping its own notion of what a listing claims.

**History.** `historyEvents` is replaced as a whole on `PUT
/vehicles/:id/history`, matching images and documents — entries a dealer
transcribes by hand, from whatever they hold. Every entry is the dealer's own
account; there is no other source, no per-row provenance field, and nothing
here is filtered by viewer. `VehicleDocument.issuedOn` carries the date
printed on an uploaded document; that date is public even though the document
is not, because it is what lets a buyer judge how current an entry is.

`ACCIDENT_DAMAGE` and `NO_ACCIDENTS` are the kinds either source can record.
They are separate from `CLAIM` so a damage record and an insurance claim stay
distinct events rather than one looking like two accidents.

## Dealer inventory (CSV)

Bulk inventory for a seller's own listings. Under `vehicle:write` — the same
authority as creating and editing one listing, applied to many — so SELLER,
DEALER, ADMIN and SUPER_ADMIN all hold it and no new permission was added.

| Method | Path                                | Auth            | Purpose                                     |
| ------ | ----------------------------------- | --------------- | ------------------------------------------- |
| `GET`  | `/dealer/inventory/import/template` | `vehicle:write` | Blank CSV with documented headers           |
| `GET`  | `/dealer/inventory/export`          | `vehicle:write` | The caller's own inventory, same schema     |
| `POST` | `/dealer/inventory/import/validate` | `vehicle:write` | Report what a CSV would do. Writes nothing. |
| `POST` | `/dealer/inventory/import/confirm`  | `vehicle:write` | Apply a previewed CSV                       |
| `GET`  | `/dealer/inventory/imports`         | `vehicle:write` | Past runs, newest first                     |
| `GET`  | `/dealer/inventory/imports/:id`     | `vehicle:write` | One past run, with per-row outcomes         |

**Ownership is never in the request.** Every route scopes to
`sellerId: <the authenticated user>`, taken from the JWT. No route accepts a
seller or dealer id from the query, the body or the file, and the columns that
name one — `dealer_id`, `seller_id`, `owner_id`, `id` and their variants — are
recognised only so the response can say they were ignored. Matching is scoped
to the caller's own vehicles, so a row naming a VIN another seller lists cannot
match it; it creates in the caller's inventory instead, with a warning saying
so.

**Two steps.** `validate` parses, normalises and plans, and returns a per-row
verdict — `CREATE`, `UPDATE`, `UNCHANGED` or `ERROR` — plus a `fileHash`.
`confirm` takes the same file and that hash as multipart fields; a different
file is a `400`. The plan is rebuilt at confirm time against the database as it
is then, so the preview is a dry run of the same code path rather than a
description of it.

**Where the vehicles are.** A listing needs a city and a province; a dealer
management system export usually has neither, because the source holds one
address for the whole rooftop. Both endpoints accept optional `defaultCity` and
`defaultProvince` multipart fields, and the value used is resolved most-specific
first: the fields on the request, then the caller's dealership address, then
their own profile. The two halves resolve independently, so a profile with a
province but no city still supplies the province. It is a **fallback only** — a
row whose file names its own city keeps it — and the plan echoes what it
resolved to as `defaultLocation`.

When none of the three supplies a value, rows that would create a vehicle fail
**in the preview**, naming `city` and `province` and saying how to supply them.
Nothing is placed in a guessed location. An unrecognised province code is a
`400` rather than being dropped, since dropping it would silently fall through
to the profile.

**Photos.** `main_photo`, `extra_photos` and their two `…_updated_at` columns
are read. The addresses are fetched server-side and the bytes re-hosted here,
per D-025 — a listing rendering from a third-party photo host leaks the buyer's
address to it and goes blank when the dealer changes DMS. Fetching happens
_after_ the import responds, because a rooftop's feed is a four-figure number of
downloads from someone else's server; progress is on the import record. Pass
`importPhotos=false` on confirm to skip it for a price-only file.

Reconciliation is by source URL plus source stamp, so re-importing the same file
downloads nothing. Photos the dealer uploaded through the web application have
no source URL, are never removed by an import, and sit after the imported set.
The export emits source addresses rather than storage URLs, so export, edit,
re-import also costs nothing.

Every fetch goes through the SSRF gates in `remote-image.ts`: http and https
only on standard ports, credentials stripped, every resolved IP checked against
the private, loopback, link-local, CGNAT and reserved ranges with IPv4-mapped
IPv6 unwrapped first, the socket pinned to an address that passed, redirects
followed by hand and re-checked at each hop, the body capped while streaming,
and the content type taken from the file's magic number rather than the header.

**Partial import.** Valid rows are written and invalid rows are skipped and
returned with their errors. Nothing is skipped silently, and the counts are
recorded on the `InventoryImport` row.

**Matching order**, always within one seller: VIN, then stock number. A row
needs one of the two. Re-importing an unchanged file reports `UNCHANGED` for
every row and writes nothing, which is what makes the importer idempotent.

**Limits**: 2MB and 2000 rows, enforced on the server. The upload is held in
memory and read only after the size, encoding and content checks pass; the
filename extension is not trusted. A file that is not valid UTF-8, or that
carries a NUL byte, is refused with a message saying how to re-save it.

`listing_status` accepts only `DRAFT`, `PENDING_REVIEW`, `ARCHIVED` and `SOLD`.
A real status the column may not set — `ACTIVE`, `IN_AUCTION` — is left
unchanged and reported, so a dealer can export live inventory, edit it and
re-import without those rows failing. Publishing stays a moderation decision.

**A column called `Status` is the vehicle's condition, not the listing's
state.** Every dealership management system seen so far writes `New` or `Used`
there, so `status` is an alias for `condition`, and Vintrax's own listing state
is `listing_status`. Reading `Status` as the listing state is what failed all 47
rows of the first real export tried against this importer.

**Blank required columns.** `transmission` and `drivetrain` accept a blank and
record `OTHER`, with a warning on the row — see
[D-030](./decision-log.md). Every other required column is a complete
enumeration, so a blank there is missing data and fails the row rather than
being guessed at. An optional column that cannot be read (a feed writing
`Electric` in its engine-size column) costs the field, not the vehicle: the row
imports and carries a warning.

## Vehicles

| Method         | Path                                  | Auth                                       | Purpose                                         |
| -------------- | ------------------------------------- | ------------------------------------------ | ----------------------------------------------- |
| `GET`          | `/vehicles`                           | optional                                   | Search with filters, facets, sorting            |
| `GET`          | `/vehicles/mine`                      | seller                                     | Own inventory, including drafts                 |
| `GET`          | `/vehicles/pending-review`            | admin                                      | Moderation queue                                |
| `GET`          | `/vehicles/:idOrSlug`                 | optional                                   | One vehicle                                     |
| `POST`         | `/vehicles`                           | seller + verified                          | Create a listing                                |
| `PATCH`        | `/vehicles/:id`                       | owner                                      | Update a listing — everything except its status |
| `PATCH`        | `/vehicles/:id/status`                | owner + verified                           | Submit for review, withdraw, archive, re-draft  |
| `DELETE`       | `/vehicles/:id`                       | owner                                      | Delete a listing                                |
| `POST`         | `/vehicles/:id/images`                | owner                                      | Add one photo (multipart), processed            |
| `PUT`          | `/vehicles/:id/images/:imageId`       | owner                                      | Replace one photo's file, keeping its place     |
| `DELETE`       | `/vehicles/:id/images/:imageId`       | owner                                      | Remove one photo and its files (idempotent)     |
| `PATCH`        | `/vehicles/:id/moderate`              | admin                                      | Approve or reject                               |
| `GET`          | `/vehicles/:id/documents/:documentId` | seller, admin or the buyer on a live order | Download a document                             |
| `PUT`/`DELETE` | `/vehicles/:id/favourite`             | ✅                                         | Save or unsave                                  |
| `GET`          | `/me/favourites`                      | ✅                                         | Saved vehicles                                  |

### Photos

Every vehicle photo goes through the image pipeline
([images.md](./images.md)): validated by its content, then rendered to
responsive WebP widths. A vehicle's `images[]` entries, and a summary's
primary photo, carry the renditions alongside the plain `url`:

```json
{
  "id": "…",
  "url": "/uploads/vehicles/<asset>/960.webp",
  "alt": null,
  "position": 0,
  "optimized": {
    "width": 1920,
    "height": 1280,
    "webp": [
      { "width": 320, "url": "/uploads/vehicles/<asset>/320.webp" },
      { "width": 640, "url": "/uploads/vehicles/<asset>/640.webp" },
      { "width": 960, "url": "/uploads/vehicles/<asset>/960.webp" },
      { "width": 1440, "url": "/uploads/vehicles/<asset>/1440.webp" },
      { "width": 1920, "url": "/uploads/vehicles/<asset>/1920.webp" }
    ],
    "avif": []
  }
}
```

Summaries carry the same object as `primaryImage`, next to the existing
`primaryImageUrl`. Both are additive: `url` and `primaryImageUrl` keep their
meaning — one displayable URL — and for a processed photo they now point at a
WebP rendition rather than the original upload. `optimized` is `null` for a
photo the pipeline has not processed yet; clients draw those from `url` as
before.

Saving a listing (`POST /vehicles`, `PATCH /vehicles/:id`) still takes
`images: [{ url, alt }]`. A `url` returned by `POST /uploads/images` links the
listing to that processed photo; photos a save drops have their files deleted
once the save has committed.

### Listing status

`PATCH /vehicles/:id` does not accept `status` — publishing is a moderation
decision, so a seller cannot reach `ACTIVE` by writing the field. The update
schema is **strict**, so sending it is a 400 naming the right endpoint rather
than a silent no-op; an edit form that keeps sending the field would otherwise
report a successful save that changed nothing. Sellers move listings with
`PATCH /vehicles/:id/status`, which accepts `DRAFT`, `PENDING_REVIEW`,
`ARCHIVED` and `SOLD`, and validates the transition:

| From             | A seller may move it to              |
| ---------------- | ------------------------------------ |
| `DRAFT`          | `PENDING_REVIEW`, `ARCHIVED`, `SOLD` |
| `PENDING_REVIEW` | `DRAFT`, `SOLD`                      |
| `ACTIVE`         | `DRAFT`, `ARCHIVED`, `SOLD`          |
| `ARCHIVED`       | `DRAFT`, `SOLD`                      |
| `SOLD`           | `DRAFT`                              |
| `IN_AUCTION`     | nothing — cancel the auction first   |

`ACTIVE` is reached only through `PATCH /vehicles/:id/moderate`. Admins are
exempt from the transition table so support can correct a stuck listing, but
not from the two guards below, which protect other people's money rather than
the workflow:

- **Marking a vehicle sold is refused while it has a scheduled or live
  auction.** Relabelling the subject of an auction would end it out from under
  the bidders.
- **Reopening a sold vehicle is refused when a non-cancelled order exists for
  it**, and the error names the order. A buyer may already have paid;
  cancelling the order is what returns the vehicle to the marketplace, and that
  path already does so.

`soldAt` follows the status in both directions, so time-to-sale reporting is
not skewed by a listing that was reopened.

### Documents

Vehicle paperwork carries owner names, addresses and VIN history, so it is not
served as a static file. `documents` in a vehicle response is empty unless the
caller is the seller, an administrator, or the buyer on an order that has not
been cancelled; `documentCount` is always present so a page can say that
paperwork exists. When documents are returned, each `url` is the download route
above rather than a storage path, and it needs the caller's access token — so it
is fetched, not linked.

### Search parameters

`q`, `make`, `model`, `minYear`, `maxYear`, `minPrice`, `maxPrice`,
`maxMileageKm`, `bodyType`, `fuelType`, `transmission`, `drivetrain`,
`condition`, `saleChannel`, `province`, `city`, `sellerType`, `inspectedOnly`,
`sort`, `page`, `pageSize` (max 60).

Multi-select filters accept a comma-separated list or a repeated key. Sorting:
`RELEVANCE` (default), `NEWEST`, `PRICE_ASC`, `PRICE_DESC`, `MILEAGE_ASC`,
`YEAR_DESC`, `ENDING_SOON`.

```
GET /api/vehicles?fuelType=ELECTRIC,HYBRID&maxPrice=45000&province=ON&sort=PRICE_ASC
```

The response carries `facets` computed against the same filters as the results —
so counts describe what is reachable from the current search — plus `provider`
and `tookMs` so a client can surface a degraded search backend.

Only `ACTIVE` and `IN_AUCTION` vehicles are publicly searchable. Unpublished
vehicles return **404, not 403**, so inventory cannot be mapped by probing ids.

## Auctions

| Method  | Path                   | Auth              | Purpose                      |
| ------- | ---------------------- | ----------------- | ---------------------------- |
| `GET`   | `/auctions`            | optional          | Search auctions              |
| `GET`   | `/auctions/my-bids`    | ✅                | The caller's bid history     |
| `GET`   | `/auctions/:id`        | optional          | Auction with recent bids     |
| `GET`   | `/auctions/:id/bids`   | optional          | Full bid history             |
| `POST`  | `/auctions`            | seller + verified | Schedule an auction          |
| `PATCH` | `/auctions/:id`        | owner             | Update before bidding starts |
| `POST`  | `/auctions/:id/cancel` | owner             | Cancel                       |
| `POST`  | `/auctions/:id/bids`   | ✅ + verified     | Place a bid                  |

**Placing a bid** runs in a serializable transaction. Simultaneous bids conflict
rather than interleave, and the losing caller receives **409** with a message to
review the price and bid again — not a silent loss.

Rate limited to 30 bids per minute: generous for a real bidding war, tight
enough to stop a bot.

Auction terms cannot change once bidding has started, and an auction with bids
can only be cancelled by an administrator.

### WebSocket

Namespace `/auctions`. Authentication is optional — anonymous visitors may
watch.

```js
const socket = io('http://localhost:3001/auctions', { auth: { token } });
socket.emit('auction:subscribe', { auctionId });
socket.on('auction:event', (event) => {
  /* AuctionEvent */
});
```

Events: `BID_PLACED`, `AUCTION_EXTENDED`, `AUCTION_ENDED`, `AUCTION_STARTED`.
The channel is read-only; bids go over HTTP.

## Editorial

| Method   | Path                    | Auth             | Purpose                                    |
| -------- | ----------------------- | ---------------- | ------------------------------------------ |
| `GET`    | `/articles/masthead`    | —                | The post the home page leads with, or null |
| `GET`    | `/articles`             | —                | Published posts, newest first              |
| `GET`    | `/articles/:slug`       | —                | One published post                         |
| `GET`    | `/admin/articles`       | `content:manage` | All posts including drafts                 |
| `GET`    | `/admin/articles/:slug` | `content:manage` | One post, published or not                 |
| `POST`   | `/admin/articles`       | `content:manage` | Write a post                               |
| `PATCH`  | `/admin/articles/:id`   | `content:manage` | Edit, publish or unpublish                 |
| `DELETE` | `/admin/articles/:id`   | `content:manage` | Delete a post                              |

`heroImageUrl` must be a URL returned by `POST /uploads/article-images`; an
address on another server is refused. `ctaHref` must be a path on Vintrax
starting with `/`, and `ctaLabel` and `ctaHref` are required together. The slug
is derived from the title. An unpublished post answers 404 on the public
routes.

## Site presentation

| Method   | Path                                | Auth             | Purpose                            |
| -------- | ----------------------------------- | ---------------- | ---------------------------------- |
| `GET`    | `/admin/body-type-images`           | —                | Body-type shortcut photographs     |
| `PUT`    | `/admin/body-type-images/:bodyType` | `content:manage` | Set one                            |
| `DELETE` | `/admin/body-type-images/:bodyType` | `content:manage` | Remove one, restoring the fallback |
| `GET`    | `/admin/footer`                     | —                | The site footer, sections and links |
| `PUT`    | `/admin/footer`                     | `content:manage` | Replace the whole footer            |
| `GET`    | `/admin/site-settings/public`       | —                | Footer copyright lines and Contact page content |
| `GET`    | `/admin/site-settings`              | `content:manage` | The same, plus where Contact messages are emailed |
| `PUT`    | `/admin/site-settings`              | `content:manage` | Replace the site settings           |
| `GET`    | `/pages/:slug`                      | —                | One published page, such as About us |
| `POST`   | `/contact`                          | — (5/min)        | Send a Contact-page message         |
| `GET`    | `/admin/contact-messages`           | `content:manage` | Contact-page messages, newest first |
| `DELETE` | `/admin/contact-messages/:id`       | `content:manage` | Delete one                          |
| `POST`   | `/uploads/footer-icons`             | `content:manage` | Upload a footer link's icon image   |
| `POST`   | `/uploads/site-images`              | `content:manage` | Upload a site image, such as the Contact map |
| `GET`    | `/admin/make-logos`                 | —                | Logos set for vehicle makes         |
| `PUT`    | `/admin/make-logos/:make`           | `content:manage` | Set one                             |
| `DELETE` | `/admin/make-logos/:make`           | `content:manage` | Remove one, restoring the generated mark |

`make-logos` overrides the generated mark the home page's "popular makes" row
otherwise draws for that make (a real trademark from a build-time icon set
where Vintrax has one on file, a lettermark otherwise). Unlike `body-type-images`,
there is no fixed enum behind it — `Vehicle.make` is free text a dealer types
— so `:make` is matched case-insensitively against whatever a caller passes,
and `GET /admin/make-logos` returns only the makes an administrator has
actually set a logo for, not a full backfilled list.

`GET /admin/footer` is public and cached — it renders on every page for every
visitor, signed in or not, the same reasoning as the body-type photographs.
`PUT /admin/footer` replaces the whole thing in one call: the caller sends
every section it wants kept, each with its own ordered `links` array, and
anything left out is gone. There is no per-section or per-link endpoint, the
same whole-set-replacement shape `PUT /vehicles/:id/history` already uses —
order lives in the array position rather than a separate field to keep in
sync, and a section can be emptied down to zero links without a delete call
of its own.

A link's `href` is restricted to a site path starting with `/`, an `https://`
address, a `mailto:` or a `tel:` — never `javascript:` or a protocol-relative
`//` address, which the schema refuses outright. What an administrator is
likely to paste is normalised first: `instagram.com/x` and `www.x.com` gain
`https://`, `http://` becomes `https://`, and a bare email address gains
`mailto:`. `icon` is one of `FACEBOOK` / `INSTAGRAM` / `TWITTER` / `YOUTUBE` /
`LINKEDIN` / `EMAIL` / `PHONE` / `TIKTOK` / `APPLE` / `ANDROID`, or omitted
for a plain text link; it is purely decorative and is never checked against
where the link actually goes. A social network's icon draws the link as a
round badge. `imageUrl`, an upload from `POST /uploads/footer-icons`,
replaces the built-in icon. Each section's `column` (1–4) places it; two
sections in one column stack.

Pages such as About us are articles with `kind: "PAGE"`, written through the
same `/admin/articles` routes (`?kind=PAGE` to list them). A page may have no
photograph, and never appears on the blog, the home page banner or
`/articles/:slug`; it is read at `/pages/:slug`.

`POST /contact` stores the message and emails it to the settings'
`contactRecipient`, or failing that `contactEmail`, with the sender as
Reply-To. A message whose hidden `website` field is filled is dropped
without an error.

## Inspections

| Method | Path                              | Auth      | Purpose                        |
| ------ | --------------------------------- | --------- | ------------------------------ |
| `GET`  | `/inspections/mine`               | inspector | Assignments                    |
| `GET`  | `/inspections/vehicle/:vehicleId` | —         | Completed report for a vehicle |
| `GET`  | `/inspections/:id`                | optional  | One report                     |
| `POST` | `/inspections`                    | inspector | Schedule and self-assign       |
| `POST` | `/inspections/:id/submit`         | inspector | Submit the completed report    |

A submitted report grades ten sections, records odometer, and discloses frame
damage and accident history. In-progress reports are visible only to the
inspector, the vehicle's seller and admins — a half-finished condition report is
misleading.

## Orders and payments

| Method | Path                   | Auth                              | Purpose                   |
| ------ | ---------------------- | --------------------------------- | ------------------------- |
| `GET`  | `/orders`              | ✅                                | Orders as buyer or seller |
| `GET`  | `/orders/:id`          | participant                       | One order                 |
| `POST` | `/orders`              | ✅ + verified                     | Create an order           |
| `POST` | `/orders/:id/payment`  | seller or admin, `payment:manage` | Record a payment          |
| `POST` | `/orders/:id/complete` | seller                            | Mark delivered            |
| `POST` | `/orders/:id/cancel`   | participant                       | Cancel an unpaid order    |

Creating an order reserves the vehicle, which is what stops a second buyer
ordering it while payment is pending. Auction vehicles can only be ordered by
the winning bidder after the auction has ended.

`providerReference` is unique, so a retried provider callback cannot mark the
same payment paid twice.

Recording a payment is the **seller's** side of a sale, not the buyer's: the
route requires `payment:manage`, and the service additionally requires the
caller to be the seller on that specific order, or an administrator. A buyer —
including a dealer who holds the permission but is the buyer here — is refused.

> Payments are **recorded, not processed** — there is no gateway integration.
> This endpoint asserts that money arrived; nothing verifies that it did. A
> signed provider webhook has to replace it before it carries real funds.

## Dealers, messaging, notifications

| Method       | Path                                   | Auth        | Purpose                           |
| ------------ | -------------------------------------- | ----------- | --------------------------------- |
| `GET`        | `/dealers`                             | —           | List dealerships                  |
| `GET`        | `/dealers/analytics/me`                | seller      | Seller dashboard metrics          |
| `GET`        | `/dealers/:slug`                       | —           | Dealership profile                |
| `GET`        | `/dealers/:slug/inventory`             | —           | Published inventory               |
| `PATCH`      | `/dealers/:id/verification`            | admin       | Approve or reject verification    |
| `GET`/`POST` | `/conversations`                       | ✅          | Inbox; start or continue a thread |
| `GET`        | `/conversations/:id`                   | participant | Thread, marks incoming read       |
| `POST`       | `/conversations/:id/messages`          | participant | Reply                             |
| `GET`        | `/notifications`                       | ✅          | Notifications                     |
| `GET`        | `/notifications/unread-count`          | ✅          | Badge count                       |
| `PATCH`      | `/notifications/:id/read`, `/read-all` | ✅          | Mark read                         |
| `PATCH`      | `/notifications/preferences`           | ✅          | Channel preferences               |

The message recipient is derived from the vehicle, never supplied by the client
— otherwise the marketplace becomes a spam relay.

## Uploads, admin, health

| Method | Path                         | Auth             | Purpose                          |
| ------ | ---------------------------- | ---------------- | -------------------------------- |
| `POST` | `/uploads/images`            | seller           | Vehicle photo, processed         |
| `POST` | `/uploads/inspection-images` | inspector        | Inspection photo                 |
| `POST` | `/uploads/body-type-images`  | `content:manage` | Body-type shortcut photo         |
| `POST` | `/uploads/make-logos`        | `content:manage` | Vehicle make logo                |
| `POST` | `/uploads/article-images`    | `content:manage` | Editorial hero photo             |
| `POST` | `/uploads/documents`         | seller           | Title, history report, records   |
| `GET`  | `/admin/analytics`           | admin            | Platform metrics                 |
| `GET`  | `/admin/audit-logs`          | admin            | Query the audit trail            |
| `POST` | `/admin/search/reindex`      | super admin      | Rebuild the search index         |
| `GET`  | `/health`                    | —                | Readiness including dependencies |
| `GET`  | `/health/live`               | —                | Liveness only                    |

Uploads are held in memory and only written after validation. The extension
comes from the validated MIME type and the filename is generated, so the
client-supplied name is discarded entirely. Every multipart upload is capped
at the larger of `MAX_UPLOAD_BYTES` and `IMAGE_MAX_UPLOAD_BYTES` (413 above
it) and one file per request.

`POST /uploads/images` goes further: the photo's type is read from its bytes
(the declared MIME type and extension are ignored), its dimensions and pixel
count are checked before it is decoded, and it is rendered to responsive WebP
widths before the response returns. It answers with an
`UploadedVehicleImage` — `id`, `url` (a WebP rendition, never the original),
`originalWidth`/`originalHeight`, and every rendition in `optimized`. A file
that is not an acceptable photo is a 400 with a message meant for the
uploader. See [images.md](./images.md).

`/health` returns 503 only when the **database** is unreachable — Redis or a
search cluster being down reports `degraded` but keeps serving.

## Errors

```json
{
  "statusCode": 400,
  "error": "BadRequestException",
  "message": "Validation failed",
  "details": { "email": ["Invalid email"] },
  "requestId": "0f8c…",
  "timestamp": "2026-08-12T16:50:32.060Z",
  "path": "/api/auth/register"
}
```

| Status | Meaning                                                |
| ------ | ------------------------------------------------------ |
| 400    | Validation failed, or a semantically invalid operation |
| 401    | Missing, expired or invalid token                      |
| 403    | Authenticated but not permitted, or email unverified   |
| 404    | Not found, or not visible to this caller               |
| 409    | Conflict — duplicate email, or a bid that lost a race  |
| 429    | Rate limit exceeded                                    |
| 503    | Database unreachable                                   |

## Rate limits

| Scope                               | Budget             |
| ----------------------------------- | ------------------ |
| Global                              | 300 requests / 60s |
| Registration, login, password reset | 10 / 60s           |
| Bidding                             | 30 / 60s           |

Limits are per-instance and in-memory; a shared store is needed for meaningful
limits across replicas.
