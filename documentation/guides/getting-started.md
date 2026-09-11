# Getting started

From a clean machine to a running Vintrax marketplace with demo data.

## Prerequisites

| Requirement | Version    | Notes                                             |
| ----------- | ---------- | ------------------------------------------------- |
| Node.js     | ≥ 20.11    | 22 LTS recommended; CI runs 22                    |
| pnpm        | 10.x       | The repo pins `pnpm@10.33.0` via `packageManager` |
| PostgreSQL  | 16         | Either through Docker or installed locally        |
| Docker      | any recent | Optional — only for running PostgreSQL            |

If you do not have pnpm:

```bash
corepack enable && corepack prepare pnpm@10.33.0 --activate
```

## Setup

```bash
git clone https://github.com/MohammadZakariaDehghani/Vintrax.git
cd Vintrax

pnpm install
cp .env.example .env

pnpm db:up        # start PostgreSQL in Docker
pnpm db:migrate   # create the schema
pnpm db:seed      # load demo inventory

pnpm dev          # API on :3000, web on :5173
```

Open <http://localhost:5173>.

### Without Docker

Point `DATABASE_URL` in `.env` at any PostgreSQL 16 instance and skip `pnpm db:up`. To create the
role and database manually:

```bash
createuser vintrax --pwprompt
createdb -O vintrax vintrax_dev
```

Then set:

```
DATABASE_URL="postgresql://vintrax:vintrax@localhost:5432/vintrax_dev?schema=public"
```

## What you should see

| URL                                | Contents                                           |
| ---------------------------------- | -------------------------------------------------- |
| <http://localhost:5173>            | Marketplace home with 8 recently listed vehicles   |
| <http://localhost:5173/listings>   | Browse with 19 active listings and working filters |
| <http://localhost:3000/api/docs>   | Swagger API documentation                          |
| <http://localhost:3000/api/health> | `{"status":"ok","database":"up",…}`                |

If the home page loads but shows no vehicles, the seed did not run — check `pnpm db:seed` output.

## Demo accounts

Every seeded account uses the password **`VintraxDemo123!`**.

| Email                         | Role                | Good for exploring                  |
| ----------------------------- | ------------------- | ----------------------------------- |
| `jordan.lee@example.test`     | Buyer               | Favourites, messaging a seller      |
| `sam.okafor@example.test`     | Buyer               | A second buyer, existing threads    |
| `sales@northshoremotors.test` | Dealer (verified)   | Seller dashboard, 4 listings, inbox |
| `team@prairieautogroup.test`  | Dealer (verified)   | A second dealership                 |
| `contact@maplecityauto.test`  | Dealer (unverified) | Contrast with a verified badge      |
| `priya.raman@example.test`    | Private seller      | Private-seller listing flow         |
| `marc.tremblay@example.test`  | Private seller      | Includes a draft listing            |
| `admin@vintrax.test`          | Admin               | Bypasses all role checks            |

The seed creates 21 listings across BC, AB, ON, and QC — 19 active, one sold, one draft. That
split is intentional: it exercises the visibility rules described in the
[data model](../architecture/data-model.md#listing).

## A tour worth taking

Ten minutes to see the whole product:

1. **Browse anonymously.** Go to `/listings`, tick _Electric_ under Fuel type — results narrow to 3
   and the URL becomes `?fuelType=ELECTRIC`. Copy that URL into a new tab; the filter persists.
2. **Open a listing.** Note the "Sign in to message" call to action for anonymous visitors.
3. **Sign in as `jordan.lee@example.test`.** The nav gains Saved and Messages, and hearts appear on
   listing cards.
4. **Save a vehicle**, then visit _Saved_.
5. **Message a seller** from any listing detail page — you land in the thread.
6. **Sign out, sign in as `sales@northshoremotors.test`.** _Messages_ shows the enquiry with an
   unread badge; open it and reply.
7. **Visit _My listings_.** Try _Unpublish_ on a live listing, then find it under the _Drafts_ tab.
   Open its public URL in a private window — a 404, because drafts are not publicly visible.
8. **Create a listing** with _+ New listing_. Submit it with a two-word description to see
   server-side validation render inline.

## Commands

| Command                       | Effect                                |
| ----------------------------- | ------------------------------------- |
| `pnpm dev`                    | Run API and web together              |
| `pnpm build`                  | Production build of every package     |
| `pnpm test`                   | All test suites                       |
| `pnpm typecheck`              | Typecheck every package               |
| `pnpm lint`                   | Lint every package                    |
| `pnpm db:up` / `pnpm db:down` | Start / stop the PostgreSQL container |
| `pnpm db:migrate`             | Apply pending migrations              |
| `pnpm db:seed`                | Load demo data (safe to re-run)       |
| `pnpm db:reset`               | Drop, recreate, migrate, reseed       |

Target one package with `--filter`:

```bash
pnpm --filter @vintrax/api test
pnpm --filter @vintrax/web dev
```

To browse the database directly:

```bash
pnpm --filter @vintrax/api prisma:studio
```

## Troubleshooting

**`Can't reach database server at localhost:5432`**
PostgreSQL is not running. `pnpm db:up`, or start your local service. Confirm with `pg_isready`.

**`Cannot find module '@vintrax/shared'`**
The shared package has not been built. The root `dev`, `test`, `typecheck`, and `build` scripts all
build it first, so this usually means a package script was run directly. Fix with
`pnpm shared:build`.

**Ignored build scripts warning during install**
`pnpm approve-builds`, though the repo already allowlists Prisma and esbuild under
`pnpm.onlyBuiltDependencies` — a fresh `pnpm install` should not need it.

**Port 3000 or 5173 already in use**
Change `API_PORT` in `.env`, or Vite's port in `apps/web/vite.config.ts`. If you change the API port,
update `VITE_API_PROXY_TARGET` too.

**Changes to `packages/shared` are not visible in the browser**
Should not happen — the web app aliases the shared package to its TypeScript source. If it does,
restart the dev server and clear `apps/web/node_modules/.vite`.

**`Invalid environment configuration` on API start**
The message lists exactly which variables failed. Compare `.env` against `.env.example`; the most
common cause is a missing or too-short JWT secret.

## Next

- [Development workflow](./development-workflow.md) — branching, commits, CI, schema changes
- [Architecture overview](../architecture/overview.md) — how the system fits together
- [API reference](../architecture/api-reference.md) — every endpoint
