# Testing

What is tested, at what level, and how to add to it.

## Current coverage

36 tests across four suites.

| Suite            | Location                                                 | Tests | Covers                                                     |
| ---------------- | -------------------------------------------------------- | ----- | ---------------------------------------------------------- |
| Listings service | `apps/api/src/modules/listings/listings.service.spec.ts` | 11    | Search query construction, visibility rules, view counting |
| Validation pipe  | `apps/api/src/common/pipes/zod-validation.pipe.spec.ts`  | 5     | Coercion, defaults, field-level error mapping              |
| Search params    | `apps/web/src/lib/search-params.spec.ts`                 | 10    | URL ⇄ filter round-tripping                                |
| Formatting       | `apps/web/src/lib/format.spec.ts`                        | 10    | Currency, distance, relative time, enum labels             |

```bash
pnpm test                        # everything
pnpm --filter @vintrax/api test    # API only
pnpm --filter @vintrax/web test    # web only
pnpm --filter @vintrax/api test -- --watch
```

## What is deliberately tested

Tests concentrate on **logic that is easy to get subtly wrong and expensive to get wrong in
production**:

- **Search query construction.** The `where` clause is built from a dozen optional inputs. A bug
  here silently returns wrong results rather than failing loudly.
- **Visibility rules.** That a draft is invisible to a stranger, and that a seller viewing their own
  listing does not inflate its view count.
- **Validation and error mapping.** That a bad payload reports _every_ failing field, keyed by path,
  since the web app renders those inline.
- **URL round-tripping.** A lossy filter conversion would silently drop a filter — the user sees
  wrong results with no error.
- **Display formatting.** Acronyms in particular: a naive title-case renders `SUV` as "Suv" and
  `AWD` as "Awd", which looks broken to anyone shopping for a car.

## What is deliberately not unit-tested

**Framework wiring.** Testing that NestJS injects a provider tests NestJS.

**Prisma query execution.** The generated client is not ours to verify. Tests assert the _shape_ of
the query passed to Prisma; whether Prisma turns that into correct SQL is Prisma's contract.

**Simple mappers.** `toListingSummary` is field copying. It is exercised indirectly everywhere.

**Presentational components.** Testing that a card renders a title has low defect-detection value
relative to its maintenance cost. Component tests become worthwhile when components hold behaviour.

## Testing approach

### API — Jest with stubbed Prisma

Service tests construct the service directly with a stubbed Prisma client, then assert on what the
service _asked the database for_:

```ts
function createService() {
  const findMany = jest.fn().mockResolvedValue([]);
  const prisma = { listing: { findMany /* … */ } } as unknown as PrismaService;
  return { service: new ListingsService(prisma), findMany };
}

const capturedWhere = (findMany: jest.Mock) => findMany.mock.calls[0]![0].where;
```

Two things make this worth doing rather than reaching for a real database:

**Tests are fast and need no infrastructure**, so they run on every save.

**Inputs go through the real schema.** Tests call `searchListingsSchema.parse(raw)` rather than
hand-constructing a filter object, so they exercise the same coercion and defaults the API does. A
test that fabricated already-parsed input would pass while the real path broke.

The jest config maps `@vintrax/shared` to its TypeScript source, so API tests do not require the
shared package to be built.

### Web — Vitest on pure functions

Web tests target `lib/` — pure functions with no DOM. Vitest reads `vite.config.ts`, so the
`@vintrax/shared` alias applies automatically and tests import exactly what the app imports.

## Writing a good test here

**Name the behaviour, not the method.** `it('hides an unpublished listing from other users')` says
what breaks if it fails. `it('findById works')` does not.

**Assert the specific thing.** `expect(where.status).toBe('ACTIVE')` beats a snapshot of the whole
clause, which breaks on every unrelated addition.

**Prefer real inputs.** Parse through the schema instead of constructing the parsed shape by hand.

**Comment the non-obvious.** When a test encodes a security property, say so — it stops a future
reader from "simplifying" it away:

```ts
// Reported as 404 rather than 403 so drafts are not discoverable by probing.
await expect(service.findById('listing-1', stranger)).rejects.toBeInstanceOf(NotFoundException);
```

## Manual verification

The MVP was verified end to end in a real browser before merge, covering flows automated tests do
not yet reach: search filtering and sorting, listing detail, sign-in, favouriting, messaging with
unread counts, the seller dashboard, role enforcement, validation surfacing, dark mode, and mobile
layout.

Worth re-running before any release that touches those paths. The checklist:

- [ ] Browse anonymously; apply a filter; confirm the URL updates and is shareable
- [ ] Sort by price ascending; confirm ordering
- [ ] Open a listing; confirm gallery, specs, and the signed-out call to action
- [ ] Sign in as a buyer; confirm favourite hearts appear
- [ ] Favourite a listing; confirm it appears under Saved
- [ ] Message a seller; confirm the thread opens
- [ ] Sign in as that seller; confirm the unread badge, then reply
- [ ] Confirm a buyer cannot reach `/dashboard`
- [ ] Unpublish a listing; confirm its public URL 404s in a private window
- [ ] Submit an invalid listing; confirm inline field errors
- [ ] Check dark mode contrast, especially prices
- [ ] Check a 390px viewport for horizontal overflow

## Gaps worth closing

Ordered by value.

1. **HTTP-level API tests.** Supertest against a real test database would cover guards, pipes, and
   filters together — the layers unit tests stub out. `supertest` is already a dev dependency.
2. **Auth service tests.** Registration conflicts, login timing, and especially refresh rotation and
   replay detection. That last one is a security property currently verified only manually.
3. **Messaging service tests.** Participant enforcement and the one-thread-per-buyer invariant.
4. **Automated end-to-end tests.** Playwright over the checklist above, so it stops being manual.
5. **Component tests.** Once components carry more behaviour than markup.
