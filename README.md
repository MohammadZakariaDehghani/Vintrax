# Atlas

Project Atlas is a planned vehicle commerce platform for Canada: a trusted, easy-to-use marketplace
connecting buyers, dealerships, and private sellers, with direct buyer-to-seller messaging and a
future auction application built on shared platform foundations.

This repository contains the **Phase 1 marketplace MVP** — a working full-stack application — plus
the project's planning documents.

## Project documentation

- [Project Atlas HQ](./docs/atlas-hq.md) — vision, mission, phased roadmap, guiding principles,
  user groups, and open questions.
- [Decision Log](./docs/decision-log.md) — the record of significant accepted product, business,
  and architecture decisions.

## What is built

| Capability | Status |
| --- | --- |
| Accounts for buyers, private sellers, dealerships, and admins | ✅ |
| JWT auth with rotating, hashed refresh tokens and replay detection | ✅ |
| Listing create / edit / publish / unpublish / mark sold / delete | ✅ |
| Search with keyword, 11 filters, 6 sort orders, pagination, facet counts | ✅ |
| Buyer-to-seller messaging with unread counts and read receipts | ✅ |
| Favourites | ✅ |
| Listing photo upload | ✅ |
| Seller dashboard | ✅ |
| Auctions | Out of scope — see [D-006](./docs/decision-log.md) |

## Architecture

A pnpm workspace with two applications over one shared contract package:

```
apps/
  api/       NestJS + Prisma + PostgreSQL REST API
  web/       React + Vite single-page app
packages/
  shared/    Domain enums, Zod schemas, and API response types
```

`@atlas/shared` is the single source of truth for the domain. The API validates every request
against its Zod schemas, and the web app imports the same schemas and types — so a contract change
is a compile error on both sides rather than a runtime surprise.

The API is deliberately a standalone service rather than logic embedded in the web app. Per
[D-006](./docs/decision-log.md), the future auction application and any mobile client are expected
to consume the same accounts, vehicle data, images, and messaging.

## Quick start

Requires Node 20.11+, pnpm 10+, and either Docker or a local PostgreSQL 16.

```bash
pnpm install
cp .env.example .env            # adjust if your database differs

pnpm db:up                      # starts PostgreSQL in Docker
pnpm db:migrate                 # applies migrations
pnpm db:seed                    # loads demo inventory

pnpm dev                        # API on :3000, web on :5173
```

Then open <http://localhost:5173>. API documentation is served at
<http://localhost:3000/api/docs> outside production.

Without Docker, point `DATABASE_URL` at any PostgreSQL 16 instance and skip `pnpm db:up`.

### Demo accounts

The seed creates a Canadian demo marketplace — 8 accounts, 21 listings across 6 provinces,
3 dealerships, favourites, and message threads. Every account uses the password
`AtlasDemo123!`.

| Email | Role |
| --- | --- |
| `jordan.lee@example.test` | Buyer |
| `sales@northshoremotors.test` | Dealer (verified) |
| `priya.raman@example.test` | Private seller |
| `admin@atlas.test` | Admin |

Listing photos are generated locally as SVG files, so the demo renders with no network access.
The seed is idempotent — re-running it produces the same data rather than duplicates.

## Commands

| Command | Description |
| --- | --- |
| `pnpm dev` | Run the API and web app together |
| `pnpm build` | Production build of every package |
| `pnpm test` | Run all test suites |
| `pnpm typecheck` | Typecheck every package |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:seed` | Load demo data |
| `pnpm db:reset` | Drop, recreate, migrate, and reseed |

## API

All routes are prefixed with `/api`. Authentication is a bearer access token; browse endpoints
accept one optionally, which is what lets an anonymous and a signed-in visitor share a controller
while only the latter receives favourite flags.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/auth/register` | — | Create an account and receive a token pair |
| `POST` | `/auth/login` | — | Exchange credentials for a token pair |
| `POST` | `/auth/refresh` | — | Rotate a refresh token |
| `POST` | `/auth/logout` | — | Revoke a refresh token |
| `GET` | `/auth/me` | ✅ | The authenticated user |
| `GET` | `/listings` | optional | Search with filters, sorting, pagination, facets |
| `GET` | `/listings/mine` | seller | The caller's listings, including drafts |
| `GET` | `/listings/:id` | optional | A single listing |
| `POST` | `/listings` | seller | Create a listing |
| `PATCH` | `/listings/:id` | owner | Update a listing |
| `DELETE` | `/listings/:id` | owner | Delete a listing |
| `PUT`/`DELETE` | `/listings/:id/favourite` | ✅ | Add or remove a favourite |
| `GET` | `/me/favourites` | ✅ | The caller's saved listings |
| `GET` | `/conversations` | ✅ | Inbox, most recent first |
| `POST` | `/conversations` | ✅ | Start or continue a thread about a listing |
| `GET` | `/conversations/:id` | participant | A thread; marks incoming messages read |
| `POST` | `/conversations/:id/messages` | participant | Post a reply |
| `GET` | `/conversations/unread-count` | ✅ | Total unread, for the navbar badge |
| `POST` | `/uploads/images` | seller | Upload a listing photo |
| `GET` | `/health` | — | Liveness and database readiness |

Errors share one shape (`ApiErrorBody`) with a `details` map of field paths to messages, which the
web app renders inline next to the offending input.

## Notable design decisions

**Money is stored as an integer** number of Canadian dollars. Floating-point dollars accumulate
rounding error, and this marketplace has no sub-dollar prices.

**Refresh tokens are stored as SHA-256 digests**, not bcrypt hashes — the token is already
high-entropy random, and an unsalted digest is what makes the stored value directly queryable for
revocation. Presenting an already-revoked token revokes the entire family, so a stolen token
becomes a detectable, self-limiting event.

**Unpublished listings return 404, not 403**, so drafts cannot be discovered by probing IDs.

**One conversation per buyer per listing**, enforced by a unique constraint. Messaging the same
listing twice continues the existing thread instead of fragmenting it.

**`@atlas/shared` is aliased to its TypeScript source** in the web app rather than pre-bundled.
Pre-bundling a linked workspace package caches it once, so edits to the shared contracts would be
served stale until the cache was manually cleared.

**The API compiles with the Nest CLI, not esbuild.** NestJS dependency injection relies on
`emitDecoratorMetadata`, which esbuild-based runners (`tsx`, `swc` without the plugin) do not emit —
the result is a container that silently injects `undefined`.

## Known limitations

These are deliberate Phase 1 boundaries, not oversights:

- **Search relevance is recency.** The `RELEVANCE` sort orders by publication date. Genuine scoring
  needs a `tsvector` column with `ts_rank`; the current keyword matching is `ILIKE` substring
  matching, which is also why terms shorter than three characters skip the description field.
- **Uploads are written to local disk.** Production would swap the upload controller for object
  storage behind the same response shape.
- **Messaging polls rather than streams.** Async messaging was chosen over live chat per
  [D-005](./docs/decision-log.md); the unread badge refreshes on an interval.
- **No email delivery.** Message notifications and address verification are not implemented.
- **Dealer verification is a manual database flag.** There is no admin UI yet.

## Testing

36 tests cover the logic-dense areas: search query construction, listing visibility rules, view
counting, validation and error mapping, URL filter round-tripping, and display formatting.

```bash
pnpm test
```

The application flows were additionally exercised end to end in a real browser — search and
filtering, listing detail, authentication, favourites, messaging, the seller dashboard, role
enforcement, dark mode, and mobile layout.
