# API reference

Every endpoint the Vintrax API exposes, its authorisation rule, and its request and response shapes.

**Base URL:** all routes are prefixed with `/api`.
**Interactive docs:** `http://localhost:3000/api/docs` (Swagger UI, disabled when `NODE_ENV=production`).
**Contract source:** request schemas live in `packages/shared/src/schemas.ts`, response types in
`packages/shared/src/contracts.ts`.

## Authentication

Send the access token as a bearer header:

```http
Authorization: Bearer <accessToken>
```

Access tokens expire in 15 minutes by default. When one expires, exchange the refresh token via
`POST /api/auth/refresh` — the web client does this automatically and transparently on any 401.

The **Auth** column below uses:

| Marker      | Meaning                                                    |
| ----------- | ---------------------------------------------------------- |
| —           | No authentication required                                 |
| optional    | Works anonymously; a valid token personalises the response |
| ✅          | Any authenticated user                                     |
| seller      | `DEALER` or `PRIVATE_SELLER` (or `ADMIN`)                  |
| owner       | The listing's seller (or `ADMIN`)                          |
| participant | The conversation's buyer or seller                         |

## Endpoint summary

| Method   | Path                          | Auth        | Purpose                           |
| -------- | ----------------------------- | ----------- | --------------------------------- |
| `POST`   | `/auth/register`              | —           | Create an account, receive tokens |
| `POST`   | `/auth/login`                 | —           | Exchange credentials for tokens   |
| `POST`   | `/auth/refresh`               | —           | Rotate a refresh token            |
| `POST`   | `/auth/logout`                | —           | Revoke a refresh token            |
| `GET`    | `/auth/me`                    | ✅          | The authenticated user            |
| `GET`    | `/listings`                   | optional    | Search listings                   |
| `GET`    | `/listings/mine`              | seller      | The caller's own listings         |
| `GET`    | `/listings/:id`               | optional    | One listing                       |
| `POST`   | `/listings`                   | seller      | Create a listing                  |
| `PATCH`  | `/listings/:id`               | owner       | Update a listing                  |
| `DELETE` | `/listings/:id`               | owner       | Delete a listing                  |
| `PUT`    | `/listings/:id/favourite`     | ✅          | Save a listing                    |
| `DELETE` | `/listings/:id/favourite`     | ✅          | Unsave a listing                  |
| `GET`    | `/me/favourites`              | ✅          | Saved listings                    |
| `GET`    | `/conversations`              | ✅          | Inbox                             |
| `POST`   | `/conversations`              | ✅          | Start or continue a thread        |
| `GET`    | `/conversations/:id`          | participant | Read a thread                     |
| `POST`   | `/conversations/:id/messages` | participant | Reply                             |
| `GET`    | `/conversations/unread-count` | ✅          | Unread total                      |
| `POST`   | `/uploads/images`             | seller      | Upload a photo                    |
| `GET`    | `/health`                     | —           | Liveness and DB readiness         |

---

## Auth

### `POST /api/auth/register`

Creates an account and returns a token pair. `ADMIN` is never self-assignable.

```json
{
  "email": "buyer@example.com",
  "password": "at-least-ten-chars",
  "displayName": "Jordan Lee",
  "role": "BUYER",
  "dealershipName": "North Shore Motors",
  "phone": "604-555-0142",
  "province": "BC",
  "city": "Vancouver"
}
```

| Field                       | Rules                                                  |
| --------------------------- | ------------------------------------------------------ |
| `email`                     | Valid email, max 254, lowercased automatically         |
| `password`                  | 10–128 characters                                      |
| `displayName`               | 2–80 characters                                        |
| `role`                      | `BUYER` (default), `PRIVATE_SELLER`, or `DEALER`       |
| `dealershipName`            | **Required when `role` is `DEALER`**, 2–120 characters |
| `phone`, `province`, `city` | Optional. Omit rather than sending `""`                |

**201** → `AuthResponse`. **409** if the email is taken. **400** with field details on validation
failure.

### `POST /api/auth/login`

```json
{ "email": "jordan.lee@example.test", "password": "VintraxDemo123!" }
```

**200** → `AuthResponse`. **401** `Invalid email or password` — deliberately identical whether the
email is unknown or the password is wrong.

### `POST /api/auth/refresh`

```json
{ "refreshToken": "<token>" }
```

Rotates the token: the presented one is revoked and a fresh pair issued. **200** → `AuthResponse`.

**401** if the token is invalid, expired, or already used. Presenting an already-revoked token
revokes every token for that user — see [replay detection](./security.md#refresh-token-rotation).

### `POST /api/auth/logout`

```json
{ "refreshToken": "<token>" }
```

**204**. Unknown tokens succeed silently rather than leaking which tokens exist.

### `GET /api/auth/me`

**200** → `PublicUser`. This is the only place an account's own email is returned; seller objects
embedded in listings never include one.

```json
{
  "id": "uuid",
  "email": "jordan.lee@example.test",
  "displayName": "Jordan Lee",
  "role": "BUYER",
  "phone": null,
  "province": "BC",
  "city": "Burnaby",
  "dealership": null,
  "createdAt": "2026-07-30T16:41:25.129Z"
}
```

---

## Listings

### `GET /api/listings`

Searches **active listings only**. Authentication is optional; with a token, each result carries its
`isFavourited` flag.

**Query parameters**

| Parameter              | Type      | Notes                                                                                  |
| ---------------------- | --------- | -------------------------------------------------------------------------------------- |
| `q`                    | string    | Keyword. See [keyword matching](#keyword-matching) below                               |
| `make`                 | string    | Exact, case-insensitive                                                                |
| `model`                | string    | Substring, case-insensitive                                                            |
| `minYear`, `maxYear`   | int       | `minYear` must be ≤ `maxYear`                                                          |
| `minPrice`, `maxPrice` | int       | Whole CAD; `minPrice` must be ≤ `maxPrice`                                             |
| `maxMileageKm`         | int       | Upper bound                                                                            |
| `bodyType`             | enum list | Comma-separated or repeated                                                            |
| `fuelType`             | enum list | Comma-separated or repeated                                                            |
| `transmission`         | enum list | Comma-separated or repeated                                                            |
| `drivetrain`           | enum list | Comma-separated or repeated                                                            |
| `condition`            | enum list | Comma-separated or repeated                                                            |
| `province`             | enum      | Single province code                                                                   |
| `city`                 | string    | Substring, case-insensitive                                                            |
| `sellerType`           | enum      | `DEALER` or `PRIVATE_SELLER`                                                           |
| `sort`                 | enum      | `RELEVANCE` (default), `NEWEST`, `PRICE_ASC`, `PRICE_DESC`, `MILEAGE_ASC`, `YEAR_DESC` |
| `page`                 | int       | Default 1                                                                              |
| `pageSize`             | int       | Default 24, max 60                                                                     |

Example:

```
GET /api/listings?fuelType=ELECTRIC,HYBRID&maxPrice=45000&province=ON&sort=PRICE_ASC
```

**200** → `ListingSearchResponse`:

```json
{
  "items": [/* ListingSummary[] */],
  "page": 1,
  "pageSize": 24,
  "total": 19,
  "totalPages": 1,
  "facets": {
    "makes": [{ "value": "Toyota", "count": 3 }],
    "bodyTypes": [{ "value": "SUV", "count": 7 }],
    "provinces": [{ "value": "ON", "count": 7 }]
  }
}
```

Facets are computed against the **same filters as the results**, so counts reflect what is reachable
from the current search rather than the whole catalogue.

#### Keyword matching

Each whitespace-separated term must match the listing somewhere, but a term may match any field —
so `blue rav4` finds a blue RAV4 rather than nothing.

A term is matched against `title`, `make`, `model`, `trim`, `exteriorColour`, and — **only when the
term is 3 or more characters** — `description`. The length floor exists because substring matching
on prose is noisy: `ev` otherwise matches "Chevrolet", "seven", and "previous".

Terms are additionally mapped onto enum columns, so category words behave like filter chips:

| Term                              | Matches                           |
| --------------------------------- | --------------------------------- |
| `suv`, `truck`, `sedan`, …        | `bodyType`                        |
| `electric`, `hybrid`, `diesel`, … | `fuelType`                        |
| `awd`, `fwd`, `rwd`               | `drivetrain`                      |
| `automatic`, `manual`, `cvt`      | `transmission`                    |
| `4x4`, `4wd`                      | `drivetrain = FOUR_WHEEL_DRIVE`   |
| `ev`                              | `fuelType = ELECTRIC`             |
| `phev`                            | `fuelType = PLUG_IN_HYBRID`       |
| `cpo`                             | `condition = CERTIFIED_PRE_OWNED` |
| `pickup`                          | `bodyType = TRUCK`                |

> **`RELEVANCE` currently orders by recency.** Genuine relevance scoring needs a `tsvector` column
> with `ts_rank`; see [future work](../reference/future-work.md#search-quality).

### `GET /api/listings/mine`

The caller's own listings, **including drafts and archived**. Query: `status` (optional),
`page`, `pageSize` (default 20, max 60). Ordered by `updatedAt` descending.

**200** → `Paginated<ListingSummary>`.

### `GET /api/listings/:id`

**200** → `ListingDetail` — everything in `ListingSummary` plus `description`, `exteriorColour`,
`vin`, `viewCount`, the full ordered `images` array, `seller`, and `updatedAt`.

Increments `viewCount` unless the caller is the seller. **404** if the listing does not exist, or if
it is unpublished and the caller is not its owner or an admin.

### `POST /api/listings`

Creates a listing owned by the caller.

```json
{
  "title": "2022 Toyota RAV4 XLE AWD",
  "description": "At least twenty characters of description.",
  "make": "Toyota",
  "model": "RAV4",
  "trim": "XLE AWD",
  "year": 2022,
  "priceCad": 38900,
  "mileageKm": 41200,
  "condition": "CERTIFIED_PRE_OWNED",
  "bodyType": "SUV",
  "transmission": "AUTOMATIC",
  "fuelType": "GASOLINE",
  "drivetrain": "AWD",
  "exteriorColour": "Silver Sky Metallic",
  "vin": "2T3W1RFV8NW123456",
  "province": "BC",
  "city": "North Vancouver",
  "status": "DRAFT",
  "images": [{ "url": "/uploads/listings/abc.jpg", "alt": "Front" }]
}
```

| Field         | Rules                                                              |
| ------------- | ------------------------------------------------------------------ |
| `title`       | 6–140 characters                                                   |
| `description` | 20–6000 characters                                                 |
| `year`        | 1900 to next calendar year                                         |
| `priceCad`    | 1 to 10,000,000, integer                                           |
| `mileageKm`   | 0 to 2,000,000, integer                                            |
| `vin`         | Optional. Exactly 17 chars, excluding I, O, Q per the VIN standard |
| `status`      | Defaults to `DRAFT`                                                |
| `images`      | Up to 20, order preserved; index 0 is primary                      |

Setting `status: "ACTIVE"` stamps `publishedAt`. **201** → `ListingDetail`.

### `PATCH /api/listings/:id`

Same fields, all optional, but the payload must change at least one. Owner or admin only.

Transitioning to `ACTIVE` stamps `publishedAt` if unset; transitioning to `DRAFT` clears it. If
`images` is present it **replaces the whole set** — send the complete ordered array.

**200** → `ListingDetail`. **403** if the caller is not the owner. **404** if it does not exist.

### `DELETE /api/listings/:id`

**204**. Cascades to images, favourites, and conversations.

---

## Favourites

### `PUT /api/listings/:id/favourite`

`PUT` rather than `POST` because favouriting is idempotent — repeat calls are safe. **204**.
**404** if the listing is a draft or archived.

### `DELETE /api/listings/:id/favourite`

**204**, including when it was never favourited.

### `GET /api/me/favourites`

Query: `page`, `pageSize` (default 20, max 60). **200** → `Paginated<ListingSummary>`, newest saved
first.

---

## Messaging

### `GET /api/conversations`

The caller's threads, whether they are the buyer or the seller, ordered by most recent message.

**200** → `Paginated<ConversationSummary>`. Each item carries `counterparty` — the other party
relative to the caller — so the client does not have to work out which side it is on.

### `POST /api/conversations`

```json
{ "listingId": "uuid", "body": "Is this still available?" }
```

The **seller is resolved from the listing**, never supplied by the client, so a caller cannot address
a message to an arbitrary account. If a thread already exists for this buyer and listing, the message
is appended to it rather than creating a second thread.

**201** → `ConversationDetail`. **400** if the caller owns the listing, or the listing is not
`ACTIVE`. **404** if the listing does not exist.

### `GET /api/conversations/:id`

Returns the full thread and **marks the counterparty's messages as read** as a side effect.

**200** → `ConversationDetail` (a `ConversationSummary` plus `messages` ascending by time).
**403** if the caller is not a participant.

### `POST /api/conversations/:id/messages`

```json
{ "body": "Saturday at 10am works." }
```

Body is 1–4000 characters. **201** → `MessageDto`. **403** for non-participants.

### `GET /api/conversations/unread-count`

**200** → `{ "unread": 3 }`. Counts messages across all threads where `readAt` is null and the
sender is not the caller. Drives the navbar badge.

---

## Uploads

### `POST /api/uploads/images`

`multipart/form-data` with a single `file` field. Seller roles only.

Accepts `image/jpeg`, `image/png`, `image/webp`, `image/avif`, up to `MAX_UPLOAD_BYTES`
(5 MB default). The file is held in memory and only written after validation passes.

**201** → `{ "url": "/uploads/listings/<uuid>.jpg" }`

The stored filename is generated, and the extension comes from the validated MIME type — the
client-supplied filename is discarded entirely, which removes any path-traversal or
extension-spoofing surface.

> Files are written to local disk today. Production should swap this controller for object storage
> behind the same response shape.

---

## Health

### `GET /api/health`

**200** → `{ "status": "ok", "database": "up", "uptimeSeconds": 1234 }`
**503** if the database is unreachable, so orchestrators treat the instance as not ready.

---

## Errors

Every failure — validation, authorisation, database, unexpected — is normalised into one shape:

```json
{
  "statusCode": 400,
  "error": "BadRequestException",
  "message": "Validation failed",
  "details": {
    "email": ["Invalid email"],
    "password": ["Password must be at least 10 characters"]
  },
  "timestamp": "2026-07-30T16:50:32.060Z",
  "path": "/api/auth/register"
}
```

`details` maps dotted field paths to messages and is present on validation failures. Whole-object
refinements are attached to the field they concern — a dealer signup missing its dealership name
reports under `dealershipName`, not at the root.

| Status | Meaning                                                  |
| ------ | -------------------------------------------------------- |
| 400    | Validation failed, or a semantically invalid operation   |
| 401    | Missing, expired, or invalid token                       |
| 403    | Authenticated but not permitted                          |
| 404    | Not found, or not visible to this caller                 |
| 409    | Conflict, e.g. email already registered                  |
| 429    | Rate limit exceeded                                      |
| 500    | Unexpected — internal details are logged, never returned |
| 503    | Database unreachable                                     |

Unexpected errors return a generic message. Internal exception text never reaches the client.

## Rate limiting

| Scope                                     | Budget             |
| ----------------------------------------- | ------------------ |
| Global                                    | 300 requests / 60s |
| `POST /auth/register`, `POST /auth/login` | 10 requests / 60s  |

Exceeding a budget returns **429**.
