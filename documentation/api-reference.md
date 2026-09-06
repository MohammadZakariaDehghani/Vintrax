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

| Marker | Meaning |
| --- | --- |
| — | No authentication |
| optional | Works anonymously; a token personalises the response |
| ✅ | Any authenticated user |
| verified | Requires a verified email address |
| seller | `SELLER` or `DEALER` (or admin) |
| owner | The resource's owner (or admin) |
| admin | `ADMIN` or `SUPER_ADMIN` |

## Auth

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/auth/register` | — | Create an account, receive tokens |
| `POST` | `/auth/login` | — | Exchange credentials for tokens |
| `POST` | `/auth/refresh` | — | Rotate a refresh token |
| `POST` | `/auth/logout` | — | Revoke a refresh token |
| `GET` | `/auth/me` | ✅ | The authenticated user with permissions |
| `PATCH` | `/auth/password` | ✅ | Change password, ending other sessions |
| `POST` | `/auth/password/forgot` | — | Start a reset (always 202) |
| `POST` | `/auth/password/reset` | — | Complete a reset |
| `POST` | `/auth/email/verify` | — | Confirm an email address |
| `POST` | `/auth/email/resend` | ✅ | Send a fresh verification email |

**Register** requires `email`, `password` (10–128 chars), `firstName`,
`lastName`. `role` is `BUYER`, `SELLER` or `DEALER` — admin roles are never
self-assignable. `dealershipName` is required when `role` is `DEALER`.

## Users

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `PATCH` | `/me` | ✅ | Update profile |
| `GET` | `/me/addresses` | ✅ | List saved addresses |
| `POST` | `/me/addresses` | ✅ | Save an address |
| `DELETE` | `/me/addresses/:id` | ✅ | Delete an address |
| `GET` | `/admin/users` | admin | List platform users |
| `PATCH` | `/admin/users/:id/status` | admin | Suspend, reactivate, deactivate |

Suspending an account also revokes its live sessions.

## Vehicles

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/vehicles` | optional | Search with filters, facets, sorting |
| `GET` | `/vehicles/mine` | seller | Own inventory, including drafts |
| `GET` | `/vehicles/pending-review` | admin | Moderation queue |
| `GET` | `/vehicles/:idOrSlug` | optional | One vehicle |
| `POST` | `/vehicles` | seller + verified | Create a listing |
| `PATCH` | `/vehicles/:id` | owner | Update a listing — everything except its status |
| `PATCH` | `/vehicles/:id/status` | owner + verified | Submit for review, withdraw, archive, re-draft |
| `DELETE` | `/vehicles/:id` | owner | Delete a listing |
| `PATCH` | `/vehicles/:id/moderate` | admin | Approve or reject |
| `GET` | `/vehicles/:id/documents/:documentId` | seller, admin or the buyer on a live order | Download a document |
| `PUT`/`DELETE` | `/vehicles/:id/favourite` | ✅ | Save or unsave |
| `GET` | `/me/favourites` | ✅ | Saved vehicles |

### Listing status

`PATCH /vehicles/:id` does not accept `status` — publishing is a moderation
decision, so a seller cannot reach `ACTIVE` by writing the field. Sellers move
listings with `PATCH /vehicles/:id/status`, which accepts only `DRAFT`,
`PENDING_REVIEW` and `ARCHIVED` and validates the transition:

| From | A seller may move it to |
| --- | --- |
| `DRAFT` | `PENDING_REVIEW`, `ARCHIVED` |
| `PENDING_REVIEW` | `DRAFT` |
| `ACTIVE` | `ARCHIVED` |
| `ARCHIVED` | `DRAFT` |
| `IN_AUCTION`, `SOLD` | nothing — the auction and settlement flows own these |

`ACTIVE` is reached only through `PATCH /vehicles/:id/moderate`. Admins are
exempt from the transition table so support can correct a stuck listing.

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

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/auctions` | optional | Search auctions |
| `GET` | `/auctions/my-bids` | ✅ | The caller's bid history |
| `GET` | `/auctions/:id` | optional | Auction with recent bids |
| `GET` | `/auctions/:id/bids` | optional | Full bid history |
| `POST` | `/auctions` | seller + verified | Schedule an auction |
| `PATCH` | `/auctions/:id` | owner | Update before bidding starts |
| `POST` | `/auctions/:id/cancel` | owner | Cancel |
| `POST` | `/auctions/:id/bids` | ✅ + verified | Place a bid |

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
socket.on('auction:event', (event) => { /* AuctionEvent */ });
```

Events: `BID_PLACED`, `AUCTION_EXTENDED`, `AUCTION_ENDED`, `AUCTION_STARTED`.
The channel is read-only; bids go over HTTP.

## Inspections

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/inspections/mine` | inspector | Assignments |
| `GET` | `/inspections/vehicle/:vehicleId` | — | Completed report for a vehicle |
| `GET` | `/inspections/:id` | optional | One report |
| `POST` | `/inspections` | inspector | Schedule and self-assign |
| `POST` | `/inspections/:id/submit` | inspector | Submit the completed report |

A submitted report grades ten sections, records odometer, and discloses frame
damage and accident history. In-progress reports are visible only to the
inspector, the vehicle's seller and admins — a half-finished condition report is
misleading.

## Orders and payments

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/orders` | ✅ | Orders as buyer or seller |
| `GET` | `/orders/:id` | participant | One order |
| `POST` | `/orders` | ✅ + verified | Create an order |
| `POST` | `/orders/:id/payment` | seller or admin, `payment:manage` | Record a payment |
| `POST` | `/orders/:id/complete` | seller | Mark delivered |
| `POST` | `/orders/:id/cancel` | participant | Cancel an unpaid order |

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

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/dealers` | — | List dealerships |
| `GET` | `/dealers/analytics/me` | seller | Seller dashboard metrics |
| `GET` | `/dealers/:slug` | — | Dealership profile |
| `GET` | `/dealers/:slug/inventory` | — | Published inventory |
| `PATCH` | `/dealers/:id/verification` | admin | Approve or reject verification |
| `GET`/`POST` | `/conversations` | ✅ | Inbox; start or continue a thread |
| `GET` | `/conversations/:id` | participant | Thread, marks incoming read |
| `POST` | `/conversations/:id/messages` | participant | Reply |
| `GET` | `/notifications` | ✅ | Notifications |
| `GET` | `/notifications/unread-count` | ✅ | Badge count |
| `PATCH` | `/notifications/:id/read`, `/read-all` | ✅ | Mark read |
| `PATCH` | `/notifications/preferences` | ✅ | Channel preferences |

The message recipient is derived from the vehicle, never supplied by the client
— otherwise the marketplace becomes a spam relay.

## Uploads, admin, health

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/uploads/images` | seller | Vehicle photo |
| `POST` | `/uploads/inspection-images` | inspector | Inspection photo |
| `POST` | `/uploads/documents` | seller | Title, history report, records |
| `GET` | `/admin/analytics` | admin | Platform metrics |
| `GET` | `/admin/audit-logs` | admin | Query the audit trail |
| `POST` | `/admin/search/reindex` | super admin | Rebuild the search index |
| `GET` | `/health` | — | Readiness including dependencies |
| `GET` | `/health/live` | — | Liveness only |

Uploads are held in memory and only written after validation. The extension
comes from the validated MIME type and the filename is generated, so the
client-supplied name is discarded entirely.

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

| Status | Meaning |
| --- | --- |
| 400 | Validation failed, or a semantically invalid operation |
| 401 | Missing, expired or invalid token |
| 403 | Authenticated but not permitted, or email unverified |
| 404 | Not found, or not visible to this caller |
| 409 | Conflict — duplicate email, or a bid that lost a race |
| 429 | Rate limit exceeded |
| 503 | Database unreachable |

## Rate limits

| Scope | Budget |
| --- | --- |
| Global | 300 requests / 60s |
| Registration, login, password reset | 10 / 60s |
| Bidding | 30 / 60s |

Limits are per-instance and in-memory; a shared store is needed for meaningful
limits across replicas.
