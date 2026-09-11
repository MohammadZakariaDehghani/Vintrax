# Development workflow

Day-to-day process: branching, commits, CI, and the two change types that need particular care —
database schema and shared contracts.

## Branching

`main` is the default branch and is expected to stay releasable. Work happens on a branch and
reaches `main` through a pull request.

```bash
git checkout main
git pull origin main
git checkout -b <descriptive-branch-name>
```

A merged pull request is finished. Follow-up work starts from a fresh branch off the updated `main`
rather than adding commits on top of merged history:

```bash
git fetch origin main
git checkout -B <branch-name> origin/main
```

## Commits

Write the _why_, not a restatement of the diff. The diff already says what changed; the message
should explain the reasoning a reviewer cannot reconstruct six months later.

```
Short imperative summary under ~72 characters

What changed and, more importantly, why. Note trade-offs considered and
rejected. If a fix is non-obvious, say what the failure mode was.
```

A useful test: if the message would still make sense with the diff deleted, it is doing its job.

## Before pushing

```bash
pnpm typecheck && pnpm test && pnpm build
```

All three run in CI, so running them locally is the fast way to avoid a red pull request. They pass
from a clean checkout — each builds `packages/shared` first, because both applications typecheck
against its compiled output.

## Continuous integration

`.github/workflows/ci.yml` runs on pull requests and on pushes to `main`. It deliberately does
**not** run on pushes to every branch — with `pull_request` also configured, that ran the whole
suite twice for each pull request commit.

The `verify` job, against a PostgreSQL 16 service container:

1. `pnpm install --frozen-lockfile`
2. `prisma generate`
3. `prisma migrate deploy` — proves migrations apply to an empty database
4. `pnpm typecheck`
5. `pnpm test`
6. `pnpm build`
7. `pnpm db:seed` twice — proves the seed is idempotent

Two notes for anyone editing the workflow:

- **Do not add a `version:` to `pnpm/action-setup`.** The action reads `packageManager` from
  `package.json`, and specifying both is a hard error that fails the job before anything installs.
- `pnpm/action-setup` must come **before** `actions/setup-node`, because the Node step's
  `cache: pnpm` needs pnpm to already exist.

### Reproducing a CI failure locally

CI runs against a fresh database, which catches things a long-lived development database hides —
most often a migration that only applies cleanly on top of existing state.

```bash
createdb -O vintrax vintrax_ci
export DATABASE_URL="postgresql://vintrax:vintrax@localhost:5432/vintrax_ci?schema=public"

pnpm install --frozen-lockfile
pnpm --filter @vintrax/api exec prisma generate
pnpm --filter @vintrax/api exec prisma migrate deploy
pnpm typecheck && pnpm test && pnpm build
pnpm db:seed && pnpm db:seed
```

## Changing the database schema

1. Edit `apps/api/prisma/schema.prisma`.
2. Generate a migration:
   ```bash
   pnpm --filter @vintrax/api exec prisma migrate dev --name describe_the_change
   ```
3. **Read the generated SQL** in `apps/api/prisma/migrations/`. Prisma occasionally produces a
   destructive plan — a column rename can become drop-and-add, silently discarding data.
4. Commit the schema change and the migration together.

Never edit an applied migration. Correct it with a new one.

Use `migrate dev` locally only. CI and production use `migrate deploy`, which never resets data.

### Migrations that need care

**Adding a required column to a populated table** needs a default, or a three-step deploy: add it
nullable, backfill, then make it required.

**Adding an enum value** is safe. **Removing one** requires migrating existing rows first, and must
be coordinated with `packages/shared/src/domain.ts`.

**Adding an index** to a large table should be `CREATE INDEX CONCURRENTLY`, which Prisma will not
generate — write it by hand.

## Changing a shared contract

`packages/shared` is imported by both applications, so a change there ripples in both directions.
This is the point of the package, but it means the order of operations matters.

For a **domain enum**, three files must change together:

| File                            | Change                  |
| ------------------------------- | ----------------------- |
| `packages/shared/src/domain.ts` | The exported value list |
| `apps/api/prisma/schema.prisma` | The Prisma enum         |
| `apps/api/prisma/migrations/…`  | The generated migration |

Getting these out of sync produces a confusing failure: the API accepts a value that Prisma then
rejects at write time.

For a **request schema** in `schemas.ts`, tightening a rule is a breaking change for existing
clients — the web app is one, but so is anything else already calling the API. Widening is safe.

For a **response type** in `contracts.ts`, adding a field is safe; removing or renaming one breaks
consumers at compile time, which is exactly what should happen.

After any shared change:

```bash
pnpm shared:build   # then typecheck both apps
pnpm typecheck
```

The web app aliases `@vintrax/shared` to its TypeScript source, so it picks changes up immediately.
The API compiles against `dist`, which is why the build step matters there.

## Adding an API endpoint

The module layout is consistent enough to follow mechanically:

1. **Schema** — add the request schema to `packages/shared/src/schemas.ts` and the response type to
   `contracts.ts`.
2. **Service** — business rules and database access. Ownership and visibility checks live here, not
   in the controller.
3. **Controller** — HTTP shape only. Apply `zodBody(schema)` or `zodQuery(schema)`, plus `@Roles`
   or `@Public` as needed.
4. **Module** — register the controller and provider.
5. **Test** — cover the branch logic in the service.

Two ordering traps:

- **Literal route segments must be declared before parameterised ones.** `@Get('mine')` has to come
  before `@Get(':id')`, or `mine` is captured as an id and fails UUID parsing.
- **Everything is authenticated by default.** A public endpoint needs `@Public()` explicitly. This
  fails safe: forgetting it makes the route too strict, never too open.

## Adding a web page

1. Create the component under `src/pages/`.
2. Add a route in `App.tsx`, wrapping it in `RequireAuth` (optionally `sellersOnly`) if it needs a
   session.
3. Fetch with `useQuery` and a hierarchical query key; mutate with `useMutation` and invalidate the
   affected keys.
4. Reuse `ui.tsx` primitives — `Spinner`, `EmptyState`, `ErrorAlert`, `Field`, `Pagination` — so
   loading and error states stay consistent.
5. Style with existing classes and tokens in `styles.css` before adding new ones.

If the page has filters or tabs a user might share or bookmark, put that state in the URL rather than
`useState`.

## Code review

What reviewers should look for, roughly in priority order:

1. **Authorisation.** Does every new endpoint enforce ownership server-side? Client-side checks are
   never the enforcement point.
2. **Validation.** Is input parsed by a schema before reaching a service?
3. **Information disclosure.** Does a not-found path leak existence through a 403 where a 404 was
   intended?
4. **Query cost.** Any N+1 introduced? Any unindexed filter on a large table?
5. **Contract sync.** If an enum changed, did all three places change?
6. **Tests.** Is the branch logic covered, or only the happy path?
7. **Comments.** Do they explain _why_, or restate _what_?

## Dependencies

Add to the package that uses it, not the root:

```bash
pnpm --filter @vintrax/api add <package>
pnpm --filter @vintrax/web add -D <package>
```

Commit the updated `pnpm-lock.yaml` — CI installs with `--frozen-lockfile` and fails if the lockfile
does not match `package.json`.

If a dependency runs install scripts, pnpm blocks it by default. Add it to
`pnpm.onlyBuiltDependencies` in the root `package.json` so the allowlist is explicit and
reproducible, rather than relying on each developer running `pnpm approve-builds`.
