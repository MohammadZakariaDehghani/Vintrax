# Implementation notes

How the Phase 1 MVP was actually built, the problems hit along the way, and the reasoning behind
decisions that are not obvious from reading the code.

This is written for whoever maintains or extends the codebase. It is deliberately honest about what
went wrong, because the traps are the expensive part to rediscover.

## Build order

The MVP was built bottom-up, each layer verified before the next depended on it.

1. **Workspace and shared contracts.** Domain enums, Zod schemas, response types — compiled and
   verified before anything imported them.
2. **Database schema and seed.** Migration applied to a real database, seed run twice to prove
   idempotency.
3. **API.** Infrastructure first (Prisma service, validation pipe, error filter, guards, decorators),
   then feature modules. Booted and exercised with real HTTP calls before the frontend existed.
4. **Web app.** Built against a working, verified API, so any failure was unambiguously frontend.
5. **End-to-end verification** in a real browser, then documentation and CI.

The ordering mattered. Because the API was verified independently, every frontend bug had exactly one
possible source.

## Traps hit

Four problems cost real time. Each is the kind that is obvious in hindsight and baffling in the
moment.

### The decorator metadata trap

**Symptom:** the API crashed on boot with `TypeError: Cannot read properties of undefined (reading 'get')`
inside `JwtStrategy`'s constructor — an injected `ConfigService` was `undefined`.

**Cause:** the dev script used `tsx`, which compiles with esbuild. **esbuild does not implement
`emitDecoratorMetadata`.** Without that metadata NestJS's DI container sees a constructor with no
declared parameter types, injects nothing, and every parameter arrives `undefined`.

The failure mode is nasty because it is not a compile error and the message points at the symptom
rather than the cause. Any esbuild-based runner has this problem.

**Fix:** the API builds and runs through the Nest CLI, which uses `tsc`. Jest uses `ts-jest` for the
same reason.

**If you are tempted to swap in a faster runner for startup time:** verify DI works first. SWC can
emit the metadata with `@swc/plugin-transform-imports` configured correctly; plain esbuild cannot.

### The stale pre-bundle trap

**Symptom:** display labels were fixed in `packages/shared`, the shared package rebuilt, tests
passed with the new values — and the browser kept rendering the old ones. Restarting the dev server
and deleting `node_modules/.vite` did not help consistently.

**Cause:** `optimizeDeps.include: ['@atlas/shared']` in `vite.config.ts`. Vite pre-bundles listed
dependencies **once** and caches the result. For a linked workspace package under active development
that is exactly wrong — edits to the shared contracts are invisible until the cache is manually
cleared.

The original reason for the include was real: the shared package compiles to CommonJS, and a browser
cannot consume CommonJS directly.

**Fix:** alias `@atlas/shared` to its TypeScript source instead.

```ts
resolve: { alias: { '@atlas/shared': sharedSrc } }
```

Vite compiles it as project source with correct HMR, and `tsconfig.json` mirrors the alias in `paths`
so typechecking reads the same files. The class of bug is gone rather than worked around.

Time lost to this was mostly spent doubting correct code. If a change is provably in `dist` and
provably in tests but not in the browser, suspect the bundler cache early.

### The CSS ordering trap

**Symptom:** in dark mode, listing prices were nearly invisible — dark navy on a dark surface —
despite an explicit dark-mode override setting a light blue.

**Cause:** the dark `@media` block sat near the top of the stylesheet, immediately after `:root`.
Both `.listing-price { color: var(--brand-900) }` and the dark override `.listing-price { color: #7db3ea }`
have identical specificity, so **source order decides**, and the component rule came later.

**Fix, in two parts:**

1. Colours that flip between themes became **semantic tokens** — `--price-color`, `--link-color`,
   `--prose-color`. Tokens are set on `:root` and consumed later, so ordering is irrelevant.
2. Overrides that genuinely cannot be tokens (the skeleton gradient) moved to a second `@media` block
   at the **end** of the file, with a comment saying why it must stay last.

Prefer a token. Reach for a late override only when the property is not a colour.

### The CI double-source trap

**Symptom:** CI failed instantly on the first run, before installing anything.

```
Error: Multiple versions of pnpm specified:
  - version 10 in the GitHub Action config with the key "version"
  - version pnpm@10.33.0 in package.json with the key "packageManager"
```

**Cause:** `pnpm/action-setup` was given `version: 10` while the root `package.json` already declared
`packageManager`. The action refuses two sources rather than guessing.

**Fix:** remove the pin from the workflow and let `packageManager` be the single source of truth.

A second bug surfaced alongside it: `on: push: branches: ['**']` plus `on: pull_request` ran the full
suite **twice** for every pull request commit. Push is now limited to `main`.

**Lesson:** a workflow that dies at step one has validated nothing downstream. After fixing it, the
entire pipeline was reproduced locally against a fresh database — frozen-lockfile install, generate,
`migrate deploy` from zero, typecheck, test, build, seed twice — before pushing again.

## Decisions worth knowing

Things a reader might otherwise "fix".

### Favourites are a second query, not a join

`ListingsService` fetches a page of listings, then issues a separate query for which of those the
viewer has favourited.

The tempting alternative is including a filtered `favourites` relation in the Prisma select. That
requires the viewer id inside the select object, which makes the select dynamic and destroys the
static `Prisma.ListingGetPayload` typing that the mapper relies on. A sentinel-UUID hack would keep
the select static at the cost of a confusing lie in the query.

One extra indexed query against at most 60 ids is cheap. Static types across the whole mapper are
not. If this becomes a bottleneck, the fix is caching, not a join.

### Search facets share the results' `where` clause

Facet counts are computed with the same filters as the results, so they describe what is reachable
from the current search rather than the whole catalogue. Selecting *Electric* and seeing
"Gasoline (14)" would be actively misleading.

Cost: three extra `groupBy` queries per search, five queries total including count and page. The
first thing to cache.

### `RELEVANCE` sorts by recency

Honest naming would be `NEWEST`, but the enum value exists so the sort control has a sensible default
that can become real relevance without a client change or a URL migration. The service comments say
so plainly, and so does the [API reference](../architecture/api-reference.md).

Real ranking needs a `tsvector` column and `ts_rank`, which is [future work](./future-work.md#search-quality).

### Keyword search maps onto enum columns

Early on, `q=awd suv` returned zero results. Both terms are meaningful to a buyer, but `SUV` lives in
the `bodyType` enum and `AWD` in `drivetrain`, and free-text search only looked at text columns.

`enumMatchesForTerm` maps a term onto the enum columns it could plausibly mean, including shorthands
buyers actually type — `4x4`, `ev`, `phev`, `cpo`, `pickup`.

A second problem appeared immediately: `q=ev` returned nine results, because `ILIKE '%ev%'` matches
"Chevrolet", "seven", and "previous" in descriptions. Terms shorter than three characters now skip
the description field. Genuine word-boundary matching needs full-text search.

### Images are replaced wholesale on update

`PATCH /listings/:id` with an `images` array deletes and recreates the set inside a transaction.

Diffing would be more efficient and considerably more code — insertion, deletion, and reordering
become three cases instead of one. Listings have at most 20 images and are edited rarely. Simplicity
wins until it demonstrably does not.

### The seller is derived from the listing, never sent by the client

`POST /conversations` takes a `listingId` and resolves the seller server-side. Accepting a
`sellerId` would let a caller address messages to arbitrary accounts, turning the marketplace into a
spam relay.

Obvious once stated, easy to get wrong when building quickly, and easy to reintroduce.

### `publishedAt` is separate from `createdAt`

A listing drafted in January and published in March is "new" in March. Sorting by `createdAt` would
bury it below listings created later but published earlier. `publishedAt` is stamped on the first
transition to `ACTIVE` and cleared if it returns to `DRAFT`.

### Sorts include a tiebreaker

Every `orderBy` ends with `{ id: 'asc' }`. Without it, rows with equal sort values can appear in
different orders across pages, so an item is shown twice or skipped during pagination. Cheap
insurance against a bug that is miserable to reproduce.

### `AllExceptionsFilter` translates Prisma errors

`P2002` (unique violation) becomes 409, `P2003` 400, `P2025` 404. Everything else logs the full error
and returns a generic 500. Database internals never reach the client, and callers get accurate status
codes without services catching Prisma errors individually.

## Verification performed

Beyond the 36 automated tests, before merge:

**API, via HTTP against a live server** — health, anonymous search with facets, keyword and enum
filters, sorting, authentication, personalised favourite flags, validation error shape, 401 on
unauthenticated writes, 403 on wrong-role writes, draft visibility (404 public / 200 owner),
`publishedAt` stamping, cross-seller edit rejection, conversation creation and thread continuation,
unread counts and read receipts, non-participant rejection, self-messaging rejection, favourite
idempotency, refresh rotation, and replay detection revoking the token family.

**Web, in a real browser** — home page rendering, filter application updating the URL, sorting,
listing detail with gallery, sign-in, favourite toggling, saved listings, messaging with reply, role
gating on the dashboard, dashboard statistics, the listing form, inline validation, the 404 route,
dark mode contrast, and a 390px viewport checked for horizontal overflow.

**Pipeline, against a fresh database** — the exact CI sequence, including `migrate deploy` from zero
and the seed run twice.

## If you are picking this up

Read in this order:

1. [Architecture overview](../architecture/overview.md) — the shape and why the API is separate
2. [Data model](../architecture/data-model.md) — entities and invariants
3. `packages/shared/src/` — the whole domain vocabulary in three files
4. `apps/api/src/modules/listings/` — the most representative module
5. [This document](#traps-hit) — so you do not rediscover the traps

The single most useful thing to internalise: **`packages/shared` is the contract**. Changing an enum
there without changing the Prisma schema and generating a migration produces a confusing runtime
failure. The [workflow guide](../guides/development-workflow.md#changing-a-shared-contract) covers
the process.
