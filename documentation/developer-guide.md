# Developer guide

From a clean machine to a running platform, and the workflows for changing it.

## Prerequisites

| Requirement | Version |
| --- | --- |
| Node.js | ≥ 20.11 (CI runs 22) |
| pnpm | 10.x — the repo pins it via `packageManager` |
| PostgreSQL | 16 |
| Redis | 7 |
| Docker | Optional, for the full stack |

```bash
corepack enable && corepack prepare pnpm@10.33.0 --activate
```

## Quick start

### Ubuntu

```bash
git clone https://github.com/MohammadZakariaDehghani/Atlas.git
cd Atlas
./scripts/setup-ubuntu.sh --mode dev
```

One script from a bare machine to a running platform: it installs Node, pnpm,
PostgreSQL and Redis, provisions the database, writes `.env` with generated
secrets, migrates, seeds and starts the dev servers. It is safe to re-run and
never overwrites an existing `.env`. See
[deployment.md](./deployment.md#single-ubuntu-server) for every option.

### Every other platform

```bash
git clone https://github.com/MohammadZakariaDehghani/Atlas.git
cd Atlas

pnpm install
cp .env.example .env
ln -s ../.env backend/.env    # see below

pnpm db:up          # PostgreSQL + Redis in Docker
pnpm db:migrate     # apply migrations
pnpm db:seed        # load demo data

pnpm dev            # API on :3001, web on :3000
```

**Why the symlink.** The API reads `.env` or `../.env`, so the root file is
enough for it. The Prisma CLI does not look at the parent directory — it reads
`.env` from its working directory, which is `backend/`. Linking keeps one file
to edit instead of two that drift apart. Without it, `pnpm db:migrate` fails
with `Environment variable not found: DATABASE_URL`.

Next.js is the same story in the other direction: it reads env files from
`frontend/`, so browser-facing values (`NEXT_PUBLIC_*`, `API_ORIGIN`) belong in
`frontend/.env.local`. Defaults cover localhost, so this only matters once the
platform is reachable at a real address. `setup-ubuntu.sh` writes both files.

| URL | Contents |
| --- | --- |
| <http://localhost:3000> | Marketplace |
| <http://localhost:3001/api/docs> | Swagger |
| <http://localhost:3001/api/health> | Dependency readiness |

Without Docker, point `DATABASE_URL` and `REDIS_URL` at local services and skip
`pnpm db:up`.

## Demo accounts

All use the password **`AtlasDemo123!`**.

| Email | Role | Good for |
| --- | --- | --- |
| `jordan.lee@example.test` | Buyer | Favourites, bidding, messaging |
| `sam.okafor@example.test` | Buyer | A second bidder |
| `unverified.buyer@example.test` | Buyer | The verified-email gate |
| `sales@northshoremotors.test` | Dealer (verified) | Inventory, analytics |
| `contact@maplecityauto.test` | Dealer (pending) | Verification workflow |
| `marc.tremblay@example.test` | Private seller | Seller flow |
| `inspector@atlas.test` | Inspector | Condition reports |
| `admin@atlas.test` | Super admin | Everything |

The seed creates 20 vehicles across four provinces, three dealerships, three
completed inspections, two live auctions with bid history, favourites,
conversations and notifications. It is idempotent — re-running produces
identical counts.

## A tour worth taking

1. **Browse anonymously** at `/vehicles`, tick *Electric* — results narrow and
   the URL becomes `?fuelType=ELECTRIC`. Copy it into a new tab; it persists.
2. **Search `teslla`** — the misspelling still finds the Tesla, via the trigram
   fallback.
3. **Open a vehicle** with an inspection report and read the section grades.
4. **Sign in as `jordan.lee@example.test`**, save a vehicle, check *Saved*.
5. **Open a live auction** in two browsers, signed in as different buyers. Bid
   in one and watch the other update without reloading.
6. **Try bidding as `unverified.buyer@example.test`** — blocked with a clear
   message.
7. **Sign in as the dealer**, open *My listings*, unpublish a vehicle, then
   visit its public URL in a private window — a 404, because drafts are not
   discoverable.
8. **Sign in as `admin@atlas.test`** and open `/admin/dashboard` for platform
   metrics and the audit trail.

## Commands

| Command | Effect |
| --- | --- |
| `./scripts/setup-ubuntu.sh` | Install dependencies, set up and run (Ubuntu) |
| `pnpm dev` | Run API and web together |
| `pnpm start` | Run both from a production build |
| `pnpm build` | Production build of every package |
| `pnpm test` | All test suites |
| `pnpm typecheck` | Typecheck every package |
| `pnpm lint` | Lint every package |
| `pnpm db:migrate` / `db:seed` / `db:reset` | Database lifecycle |
| `pnpm db:studio` | Browse the database |
| `pnpm stack:up` | Full Docker stack including MinIO and OpenSearch |

Target one package with `--filter`:

```bash
pnpm --filter @atlas/backend test
pnpm --filter @atlas/frontend dev
```

## Optional infrastructure

The platform runs on PostgreSQL and Redis alone. Object storage and a search
cluster are opt-in:

```bash
docker compose --profile storage up -d   # MinIO
docker compose --profile search up -d    # OpenSearch
docker compose --profile full up -d      # everything
```

Then set `STORAGE_DRIVER=s3` or `SEARCH_PROVIDER=opensearch` and restart the
API. The OpenSearch provider falls back to PostgreSQL if the cluster is
unreachable, so a search outage degrades relevance rather than breaking browse.

## Branching and commits

`main` stays releasable. Work happens on a branch and reaches `main` through a
pull request. A merged pull request is finished — follow-up work starts from a
fresh branch off the updated `main`.

Write commit messages that explain *why*. The diff already says what changed.

Before pushing:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

## Changing the database schema

```bash
# Edit backend/prisma/schema.prisma, then:
pnpm --filter @atlas/backend exec prisma migrate dev --name describe_the_change
```

**Read the generated SQL before committing.** Prisma occasionally produces a
destructive plan — a column rename can become drop-and-add, silently discarding
data. Never edit an applied migration; correct it with a new one.

`migrate dev` is for local use only. CI and production use `migrate deploy`,
which never resets data.

## Changing a shared contract

`packages/shared` is imported by both applications, so the order matters. For a
**domain enum**, three things change together:

| File | Change |
| --- | --- |
| `packages/shared/src/domain.ts` | The exported value list |
| `backend/prisma/schema.prisma` | The Prisma enum |
| `backend/prisma/migrations/…` | The generated migration |

Out of sync, the API accepts a value that Prisma then rejects at write time.

Tightening a request schema is a breaking change for existing clients; widening
is safe. Removing a response field breaks consumers at compile time, which is
exactly what should happen.

## Adding an endpoint

1. **Schema** in `packages/shared` — request schema and response type.
2. **Service** — business rules and data access. Ownership checks live here.
3. **Controller** — HTTP shape, `zodBody(...)`, `@RequirePermissions(...)`,
   `@Audit(...)` where the action is security- or money-relevant.
4. **Module** — register controller and provider.
5. **Test** the branch logic.

Two traps:

- **Literal routes before parameterised ones.** `@Get('mine')` must precede
  `@Get(':id')`, or `mine` is captured as an id and fails UUID parsing.
- **Everything is authenticated by default.** A public endpoint needs
  `@Public()` explicitly — which fails safe.

## CI

`.github/workflows/ci.yml` runs three jobs on pull requests and pushes to
`main`: **verify** (install, migrate against an empty database, typecheck, lint,
test, build, seed twice), **security** (dependency audit plus a Trivy scan for
vulnerabilities, secrets and misconfiguration), and **docker** (builds both
images, gated on verify).

Only the dependency audit blocks: `pnpm audit --audit-level high` fails the job
on a high or critical advisory. Trivy reports — its findings are uploaded as a
build artifact rather than to code scanning, because SARIF upload needs GitHub
Advanced Security, which this repository does not have.

When the audit fails on a transitive dependency whose parent has not yet
released a fix, pin the patched version in the `pnpm.overrides` block in the
root `package.json` and drop the entry once the parent catches up.

Three notes for anyone editing it:

- **Do not add `version:` to `pnpm/action-setup`** — it reads `packageManager`
  from `package.json`, and specifying both is a hard error.
- **Trivy runs from its published image, not the marketplace action.** The
  runner already has Docker, and this pins the scanner itself rather than a
  wrapper around it.
- `pnpm/action-setup` must precede `actions/setup-node`, because the Node step's
  `cache: pnpm` needs pnpm to exist.

### Reproducing a CI failure locally

CI runs against a fresh database, which catches migrations that only apply on
top of existing state.

```bash
createdb -O atlas atlas_ci
export DATABASE_URL="postgresql://atlas:atlas@localhost:5432/atlas_ci?schema=public"
export QUEUE_DRIVER=inline SEARCH_PROVIDER=postgres

pnpm install --frozen-lockfile
pnpm --filter @atlas/backend exec prisma generate
pnpm --filter @atlas/backend exec prisma migrate deploy
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm db:seed && pnpm db:seed
```

## Code review

In priority order:

1. **Authorisation** — is ownership enforced server-side?
2. **Validation** — is input parsed by a schema before reaching a service?
3. **Information disclosure** — does a not-found path leak existence via 403?
4. **Query cost** — any N+1, any unindexed filter on a large table?
5. **Contract sync** — if an enum changed, did all three places change?
6. **Money and concurrency** — anything touching bids, prices or settlement
   deserves the closest reading.

## Troubleshooting

**`Cannot find module '@atlas/shared'`** — the shared package has not been
built. The root scripts build it first; run `pnpm shared:build` if you invoked a
package script directly.

**WebSocket shows "Reconnecting"** — `NEXT_PUBLIC_WS_URL` must point at the API
origin (Next's proxy does not forward upgrades), and that origin must be in the
API's `CORS_ORIGINS`. Both need a restart to take effect.

**`Invalid environment configuration`** — the message names each failing
variable. Compare `.env` against `.env.example`.

**`Environment variable not found: DATABASE_URL`** from a `prisma` command —
the Prisma CLI reads `.env` from `backend/`, not from the repository root.
Link them: `ln -s ../.env backend/.env`.

**Redis unavailable** — the API still starts. Caching and shared locks are
disabled and the queue driver logs a warning; set `QUEUE_DRIVER=inline` to run
jobs in-process.
