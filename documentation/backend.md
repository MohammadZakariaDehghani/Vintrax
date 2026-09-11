# Backend

NestJS API covering accounts, inventory, auctions, inspections, commerce and
administration.

- **Runtime:** Node 20.11+ · NestJS 11 · TypeScript 5.7
- **Data:** PostgreSQL 16 via Prisma 6
- **Infrastructure:** Redis 7 (cache, BullMQ, locks), S3-compatible storage,
  optional OpenSearch
- **Docs:** Swagger at `/api/docs` outside production
- **Full endpoint reference:** [api-reference.md](./api-reference.md)

## Module layout

Every feature module owns a controller, a service, and where useful a mapper.
Controllers describe HTTP shape only; business rules and every ownership check
live in services, which are the only layer that can see the data.

```
auth  users  dealers  vehicles  inspections  auctions
favourites  messaging  notifications  transactions
uploads  search-index  admin  health
```

## Authentication

Two tokens with different lifetimes and **different secrets** — the environment
schema rejects a configuration where they match, so a leaked access secret
cannot mint refresh tokens.

| Token   | Default TTL | Purpose                                          |
| ------- | ----------- | ------------------------------------------------ |
| Access  | 15 minutes  | Sent as `Authorization: Bearer` on every request |
| Refresh | 30 days     | Exchanged for a new pair, rotated on every use   |

**Passwords** are bcrypt at cost 12. A login for an unknown email still performs
a comparison against a dummy hash, so a bad email and a bad password take about
the same time — without that, an attacker can enumerate registered addresses by
timing alone. The error message is identical in both cases.

**Refresh rotation with replay detection.** The presented token is revoked and a
fresh pair issued. Presenting an already-revoked token revokes _every_ token for
that user, so a stolen refresh token becomes a detectable, self-limiting event.
The web client deduplicates concurrent refreshes into one in-flight call, or it
would trip its own replay detection.

**Tokens are stored as SHA-256 digests**, not bcrypt hashes. A refresh token is
already high-entropy random, so bcrypt's brute-force resistance buys nothing;
what is needed is a value that is useless if the database leaks but directly
queryable for revocation. An unsalted digest of a random secret is exactly that.

**Email verification and password reset** use single-use tokens, also stored
hashed, with a 24-hour and 1-hour expiry respectively. Requesting a reset always
returns 202 whether or not the address is registered, so the endpoint cannot be
used to enumerate accounts. Completing a reset revokes every existing session.

## Authorisation

Three layers, all server-side.

**1. Authentication guard**, registered globally, so routes are authenticated by
default and must opt out with `@Public()`. This fails safe: a forgotten
decorator makes an endpoint too strict, never too open. On public routes it
still decodes a token when present, which is what lets anonymous and signed-in
visitors share one controller method while only the latter gets `isFavourited`.

**2. Permissions guard** enforcing `@RequirePermissions(...)`,
`@Roles(...)` and `@RequireVerifiedEmail()`. Permissions are finer than roles
and are the ones to prefer — a capability can be granted without inventing a new
role. The guard also rejects suspended and deactivated accounts on every
request, because a token outlives a suspension.

**3. Ownership checks in services**, because only they can see the row:

| Rule                                                | Where                                 |
| --------------------------------------------------- | ------------------------------------- |
| Only the seller or an admin may edit a vehicle      | `VehiclesService.requireOwnedVehicle` |
| Only participants may read a conversation           | `MessagingService`                    |
| A seller cannot bid on their own vehicle            | `AuctionsService.placeBid`            |
| Only the winning bidder may settle an ended auction | `TransactionsService.createOrder`     |
| An inspector may only submit their own assignment   | `InspectionsService.requireAssigned`  |

### Role and permission matrix

| Role          | Can do                                                             |
| ------------- | ------------------------------------------------------------------ |
| `BUYER`       | Browse, save, message, bid                                         |
| `SELLER`      | Everything a buyer can, plus publish and auction own vehicles      |
| `DEALER`      | Everything a seller can, plus dealer profile, analytics, payments  |
| `INSPECTOR`   | Read vehicles, create and submit inspection reports — nothing else |
| `ADMIN`       | Moderation, dealer verification, user management, reports, audit   |
| `SUPER_ADMIN` | Everything, including platform settings                            |

A dealer deliberately **cannot** verify their own dealership; self-verification
would make the badge meaningless.

## Database

20 entities. Money is a whole-dollar integer throughout — floating-point money
accumulates rounding error.

Key invariants enforced by the schema rather than trusted to application code:

| Constraint                                              | Effect                                       |
| ------------------------------------------------------- | -------------------------------------------- |
| `Favourite(userId, vehicleId)` unique                   | Favouriting is idempotent                    |
| `Conversation(vehicleId, buyerId)` unique               | One thread per buyer per vehicle             |
| `InspectionSectionResult(inspectionId, section)` unique | One result per section                       |
| `Payment.providerReference` unique                      | A retried provider callback cannot pay twice |
| `RefreshToken.tokenHash` unique                         | Rotation and replay detection                |

`status` leads every composite index on `Vehicle`, because search always
constrains it first. See [data-model.md](./architecture/data-model.md).

### Full-text search

A hand-written migration adds a generated `tsvector` column with weighted
fields and a GIN index, plus `pg_trgm` indexes on make and model. Prisma cannot
express generated columns, so the search path uses raw SQL for ranking and
hydrates the page through Prisma to keep static types.

When the full-text query matches nothing, trigram similarity catches misspelled
makes and models — `teslla` still finds the Tesla.

## Auctions

The engine is documented in [architecture.md](./architecture.md#data-flow-placing-a-bid).
The rules:

- **Minimum increments scale with price** — $100 under $5k up to $2,500 above
  $75k — so cheap lots stay accessible and expensive ones avoid $1 bid wars.
- **Anti-snipe:** a bid within the final two minutes extends the auction by two
  minutes and re-arms the close job.
- **Reserve prices are never exposed**, only whether the reserve is met.
- **Bidder identities are pseudonymous** — a stable handle derived from the id,
  so a bidding war can be followed without learning who is in it.
- **Close is idempotent**, because a delayed job can be retried and an extension
  can leave more than one close job queued. A Redis lock stops two instances
  settling the same auction.
- **Reserve not met** returns the vehicle to the marketplace as a fixed-price
  listing rather than recording a sale.

## Background jobs

BullMQ over Redis, with an `inline` driver that runs handlers in-process so
development and CI need no broker. Handlers must be idempotent either way.

| Queue               | Work                                                   |
| ------------------- | ------------------------------------------------------ |
| `auction-lifecycle` | Start and close auctions on schedule                   |
| `notifications`     | Outbid, won, lost, moderation and verification fan-out |
| `search-indexing`   | Keep OpenSearch in step with vehicle writes            |
| `email`             | Reserved for bulk sends                                |

## Errors and observability

Every failure is normalised into one shape with a `details` map of field paths
to messages, and a `requestId` correlating the response with server logs.
Unexpected errors return a generic message; internal text never reaches the
client. Known Prisma errors map to real status codes (`P2002` → 409,
`P2025` → 404) without leaking schema internals.

Security- and money-relevant actions are recorded in an append-only audit log
via the `@Audit(...)` decorator. Only successful calls are recorded — a rejected
attempt is a log signal, not a record that something happened.

## Testing

```bash
pnpm --filter @vintrax/backend test
```

Tests concentrate on the rules that decide who wins and what they pay — bid
increments, fee floors and ceilings, auction creation constraints, the
permission matrix — and on validation and error mapping. See
[testing](./guides/testing.md).
