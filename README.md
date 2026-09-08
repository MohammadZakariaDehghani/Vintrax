# Atlas

An enterprise digital automotive marketplace and auction platform for Canada.
Dealers and private sellers publish inventory, buyers search and purchase, and
vehicles can be sold at a fixed price or through live timed auctions with
independent inspection reports attached.

```
frontend/        Next.js 15 · React 19 · Tailwind — desktop-first marketplace
mobile/          Next.js 15 · installable PWA — mobile-first client
backend/         NestJS 11 · REST + WebSocket · Prisma
packages/shared/ Domain enums, Zod schemas, API contracts
packages/client/ API client, session store and formatting shared by both apps
infrastructure/  Docker · Kubernetes · Terraform
documentation/   Architecture, API, deployment, guides
```

## Quick start

### On Ubuntu, one command

```bash
git clone https://github.com/MohammadZakariaDehghani/Atlas.git
cd Atlas
./scripts/setup-ubuntu.sh
```

Installs Node, pnpm, PostgreSQL and Redis, provisions the database, generates
secrets, applies migrations, loads demo data, builds all three applications
and starts them. Re-running is safe — it never overwrites an existing `.env`.

On a server people reach by address, say so, because the browser bundle is
compiled against it:

```bash
ATLAS_PUBLIC_URL=http://203.0.113.10:3000 ./scripts/setup-ubuntu.sh --systemd
```

`--systemd` runs Atlas under systemd instead of the foreground. Full options in
[deployment.md](./documentation/deployment.md#single-ubuntu-server).

### Anywhere else

Requires Node 20.11+, pnpm 10, and Docker (or local PostgreSQL 16 and Redis 7).

```bash
pnpm install
cp .env.example .env
ln -s ../.env backend/.env    # the Prisma CLI reads .env from backend/

pnpm db:up          # PostgreSQL + Redis
pnpm db:migrate
pnpm db:seed

pnpm dev            # web on :3000, API on :3001
```

| URL | |
| --- | --- |
| <http://localhost:3000> | Marketplace |
| <http://localhost:3002> | Atlas Mobile (installable PWA) |
| <http://localhost:3001/api/docs> | Swagger API documentation |
| <http://localhost:3001/api/health> | Dependency readiness |

Demo accounts all use the password `AtlasDemo123!` —
`jordan.lee@example.test` (buyer), `sales@northshoremotors.test` (dealer),
`inspector@atlas.test` (inspector), `admin@atlas.test` (super admin).

## What it does

| Capability | |
| --- | --- |
| Six roles with a fine-grained permission matrix | ✅ |
| Vehicle inventory with images, documents and features | ✅ |
| Full-text search with facets, fuzzy fallback and 15 filters | ✅ |
| Live auctions with real-time bidding over WebSocket | ✅ |
| Anti-snipe extensions, proxy bid ceilings, reserve prices | ✅ |
| Independent inspection reports graded by section | ✅ |
| Orders, platform fees, payment recording, settlement | ✅ |
| Buyer–seller messaging | ✅ |
| Notifications, in-app and email | ✅ |
| Dealer verification workflow | ✅ |
| Dealer and platform analytics dashboards | ✅ |
| Append-only audit trail | ✅ |
| English and French interface | ✅ |
| Dark mode, responsive, accessible | ✅ |
| Installable mobile PWA with live bidding and camera capture | ✅ |

## Architecture

The API is a standalone service; the web app is a client of it and holds no
business rules. `packages/shared` is the contract both compile against, so a
mismatch is a build failure rather than a runtime bug.

Search and storage sit behind **provider interfaces**. PostgreSQL full-text
search and local disk are the defaults, so the platform boots with only
PostgreSQL and Redis; OpenSearch and S3 are selected by environment variable,
and the OpenSearch provider falls back to PostgreSQL if the cluster is
unreachable.

Read [documentation/architecture.md](./documentation/architecture.md) for the
full picture.

### Bidding correctness

Bidding is the part that has to be right. Every bid runs inside a **serializable
transaction**, so two bidders hitting the same auction at the same instant
cannot both be told they are winning — PostgreSQL aborts one and the caller gets
a 409 telling them to review the price and bid again, rather than silently
losing a bid.

Verified under load: ten simultaneous bids produced two accepted, seven
serialization conflicts and one below-minimum rejection, leaving exactly one
`WINNING` row and a denormalised price matching the database maximum.

Live updates were verified across two independent browser sessions — a bid in
one moved the other from $58,000 to $59,000 in 400 ms with no reload.

## Documentation

| | |
| --- | --- |
| [Architecture](./documentation/architecture.md) | System shape, request lifecycle, the bid path |
| [Backend](./documentation/backend.md) | Modules, auth, the auction engine, jobs |
| [Frontend](./documentation/frontend.md) | Pages, state, live auctions, design system |
| [Mobile](./documentation/mobile.md) | The PWA: screens, live bidding, camera, offline |
| [Brand](./documentation/brand.md) | The mark, the palette, and the rules behind them |
| [Roles and transaction flows](./documentation/transaction-flow.md) | What each role can do, and how every process moves |
| [Security audit](./documentation/security-audit.md) | Findings, evidence, what was fixed, what is still owed |
| [API reference](./documentation/api-reference.md) | Every endpoint |
| [Deployment](./documentation/deployment.md) | Docker, Kubernetes, cloud |
| [Developer guide](./documentation/developer-guide.md) | Setup, workflows, CI, troubleshooting |
| [Decision Log](./documentation/decision-log.md) | Why things are the way they are |
| [Future work](./documentation/reference/future-work.md) | Roadmap and technical debt |

## Commands

| Command | |
| --- | --- |
| `./scripts/setup-ubuntu.sh` | Install everything and run (Ubuntu) |
| `./scripts/update-ubuntu.sh` | Pull, build and restart a running server |
| `pnpm dev` | Run the API and web app |
| `pnpm dev:mobile` | Run the API and Atlas Mobile |
| `pnpm dev:all` | Run all three |
| `pnpm start` | Run all three from a production build |
| `pnpm build` | Production build |
| `pnpm test` | All test suites |
| `pnpm typecheck` / `pnpm lint` | Static checks |
| `pnpm db:migrate` / `db:seed` / `db:reset` | Database lifecycle |
| `pnpm stack:up` | Full Docker stack including MinIO and OpenSearch |

## Testing

122 tests cover the logic that decides who wins and what they pay — bid
increments, fee floors and ceilings, auction constraints, the permission matrix
— plus validation, error mapping, URL round-tripping, query construction and
display formatting. A further group covers the authorization decisions a bug
would quietly reverse: who may record a payment, who may read a vehicle
document, which listing statuses a seller may set, and whether the compose file
still binds its databases to loopback.

The platform was additionally exercised end to end in a real browser: search and
faceted filtering, fuzzy matching, vehicle detail with inspection reports,
authentication, RBAC gating, the verified-email gate, live bidding across two
sessions, dealer and admin dashboards, dark mode, and a 390px viewport. Atlas
Mobile was exercised the same way at iPhone size, including a touch-target
audit and installability of its manifest.

## Known limitations

Deliberate boundaries, documented rather than hidden:

- **Payments are recorded, not processed.** There is no gateway integration —
  `POST /orders/:id/payment` records a reference something else must produce.
  Only the seller on the order or an administrator may record it, but nothing
  verifies that the money actually moved.
- **WebSocket scaling needs a Redis adapter** before running more than one API
  replica; socket rooms are per-process today.
- **Rate limits are per-instance and in-memory.**
- **Docker and Kubernetes manifests have not been runtime-verified** — the
  Docker daemon was unavailable in the environment where this was built.
- **Tokens live in `localStorage`**, which is XSS-exposed; moving refresh tokens
  to `HttpOnly` cookies is planned hardening.

The full register is in
[future work](./documentation/reference/future-work.md).
