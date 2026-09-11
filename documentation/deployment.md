# Deployment

Docker, Kubernetes and cloud deployment for Vintrax.

> **Status:** Vintrax has not been deployed to a production environment. This
> describes what the code supports and what still has to be built or chosen.
> Items that do not exist yet are marked **not yet implemented**.
>
> The exception is [Single Ubuntu server](#single-ubuntu-server): that script
> has been run end to end — clean machine to serving marketplace, including a
> sign-in against the seeded data.

## Artefacts

| Artefact         | Build                                       | Runtime                            |
| ---------------- | ------------------------------------------- | ---------------------------------- |
| API image        | `infrastructure/docker/backend.Dockerfile`  | Node 22 Alpine, non-root           |
| Web image        | `infrastructure/docker/frontend.Dockerfile` | Node 22 Alpine, non-root           |
| Mobile image     | `infrastructure/docker/mobile.Dockerfile`   | Node 22 Alpine, non-root           |
| Database         | —                                           | Managed PostgreSQL 16              |
| Cache and queues | —                                           | Managed Redis 7                    |
| Media            | —                                           | S3-compatible storage behind a CDN |
| Search           | —                                           | OpenSearch, optional               |

All three images are multi-stage: the workspace installs once with the full
lockfile so the shared packages resolve, then only build output and production
dependencies reach the runtime layer. Each runs as the unprivileged `node` user
with a health check.

Every image copies **all** workspace manifests before installing, not just its
own. The lockfile describes the whole workspace, and `--frozen-lockfile` fails
on a manifest it cannot find.

`NEXT_PUBLIC_*` values are compiled into the client bundle, so they are **build
arguments** for the web image, not runtime environment variables. Changing
`NEXT_PUBLIC_API_URL` requires a rebuild, not a restart.

## Single Ubuntu server

The shortest path to a running platform, and the only one in this document that
has been executed end to end. `scripts/setup-ubuntu.sh` takes a bare Ubuntu
machine to a serving marketplace.

```bash
git clone https://github.com/MohammadZakariaDehghani/Vintrax.git
cd Vintrax

VINTRAX_PUBLIC_URL=http://203.0.113.10:3000 \
  ./scripts/setup-ubuntu.sh --no-seed --systemd
```

What it does, in order:

| Step            | Detail                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| System packages | curl, gnupg, git, openssl, and a compiler for native modules                                                     |
| Node.js         | Installs 22.x from the NodeSource archive unless ≥ 20.11 is present                                              |
| pnpm            | Enabled through corepack, at the version pinned in `packageManager`                                              |
| PostgreSQL      | Installs 16 — adds the PGDG archive on releases that lack it                                                     |
| Redis           | Installs the distribution package and starts it                                                                  |
| Database        | Creates the role and database, enables `pg_trgm`                                                                 |
| Environment     | Writes `.env` with generated secrets, links `backend/.env`, writes `frontend/.env.local` and `mobile/.env.local` |
| Application     | `pnpm install`, `prisma generate`, `migrate deploy`, optional seed, `pnpm build`                                 |
| Run             | Foreground, or systemd units with `--systemd` — `vintrax-api`, `vintrax-web`, `vintrax-mobile`                   |

Three ports: the API on 3001, the marketplace on 3000, and Vintrax Mobile on 3002. Each is overridable — `VINTRAX_API_PORT`, `VINTRAX_WEB_PORT`,
`VINTRAX_MOBILE_PORT`.

### Options

| Flag            | Effect                                                                         |
| --------------- | ------------------------------------------------------------------------------ |
| `--mode dev`    | Development servers with hot reload instead of a production build              |
| `--skip-system` | Leave apt alone — for containers, or a machine already provisioned             |
| `--no-seed`     | Skip demo data. **Use this for anything real.**                                |
| `--no-start`    | Set everything up and stop                                                     |
| `--systemd`     | Install and enable the `vintrax-api`, `vintrax-web` and `vintrax-mobile` units |

| Variable                                                        | Default                                            |
| --------------------------------------------------------------- | -------------------------------------------------- |
| `VINTRAX_PUBLIC_URL`                                            | `http://localhost:3000`                            |
| `VINTRAX_API_URL`                                               | Derived from `VINTRAX_PUBLIC_URL` and the API port |
| `VINTRAX_DB_NAME` / `VINTRAX_DB_USER`                           | `vintrax` / `vintrax`                              |
| `VINTRAX_DB_PASSWORD`                                           | Generated — 192 bits of hex                        |
| `VINTRAX_DB_HOST` / `VINTRAX_DB_PORT`                           | `localhost` / `5432`                               |
| `VINTRAX_API_PORT` / `VINTRAX_WEB_PORT` / `VINTRAX_MOBILE_PORT` | `3001` / `3000` / `3002`                           |

**Adding Vintrax Mobile to an existing installation** needs the mobile origin in
the API's `CORS_ORIGINS`, or the API refuses the WebSocket handshake and live
bidding falls back to polling. Re-running the setup script adds it.

**`VINTRAX_PUBLIC_URL` is the one to get right.** It becomes `APP_URL`, the CORS
allowlist, and the WebSocket origin compiled into the browser bundle. Left at
the default on a remote server, pages render but live bidding cannot connect,
because the browser would be told to open a socket to its own machine.
Changing it later means re-running the script so the bundle is rebuilt.

### Re-running and upgrading

Every step checks for the state it creates, so a second run is a no-op where
nothing changed. An existing `.env` is never overwritten — rotating the JWT
secrets would sign every issued token out, and rewriting the database password
would lock the platform out of its own data. The script reads `DATABASE_URL`
back instead and keeps the role in step with it.

To deploy a new version:

```bash
./scripts/update-ubuntu.sh
```

It pulls the current branch, installs dependencies, applies migrations,
rebuilds and restarts the systemd units, then checks that the API and web
answer. `--branch NAME` deploys a different branch; `--no-pull` rebuilds what
is already on disk. It refuses to pull over uncommitted changes, and it never
touches `.env`, the database password or the seed.

**A pull on its own is not a deployment.** Both web applications are compiled
ahead of time, so a running server keeps serving the previous build until it is
rebuilt _and_ the process is replaced. The failure mode is quiet and easy to
misread: the page loads, the new controls are simply not on it, which looks
exactly like a change that did not work. The script removes the previous
`.next` output before building for the same reason — a server holding an old
page that references chunk names the new build never wrote fails as a blank
page rather than an error.

Doing it by hand is the same sequence:

```bash
git pull
pnpm install --frozen-lockfile
pnpm db:migrate
rm -rf frontend/.next mobile/.next
NODE_ENV=production pnpm build
sudo systemctl restart vintrax-api vintrax-web vintrax-mobile
```

### What it does not do

Deliberate omissions — a single-server install is a starting point, not a
hardened production deployment:

- **No reverse proxy and no TLS.** All three applications serve plain HTTP on
  their own ports. Put nginx or Caddy in front and terminate TLS there before
  this is reachable from the internet. Vintrax Mobile needs it for a second
  reason: a service worker will not register on an insecure origin, so the PWA
  is not installable over plain HTTP.
- **No firewall rules.** Ports 3000, 3001 and 3002 bind `0.0.0.0`.
- **No dedicated service account.** The systemd units run as the user who ran
  the script.
- **No backups.** See [Backups](#backups).
- **One machine.** WebSocket rooms are per-process, so scaling past one API
  instance needs `@socket.io/redis-adapter` first.

## Docker Compose

```bash
cp .env.example .env
# Set real JWT secrets — the API refuses to start with the placeholders
# when NODE_ENV=production.
openssl rand -base64 48   # twice, into JWT_ACCESS_SECRET and JWT_REFRESH_SECRET

# Redis authenticates. Set REDIS_PASSWORD, and put the same value in
# REDIS_URL as redis://:PASSWORD@redis:6379 — compose reads both.
openssl rand -hex 24

docker compose up -d                      # postgres, redis, api, web, mobile
docker compose --profile full up -d       # adds MinIO and OpenSearch
docker compose exec api node_modules/.bin/prisma migrate deploy
docker compose exec api node_modules/.bin/tsx prisma/seed.ts   # optional
```

The API container runs `prisma migrate deploy` before starting. With more than
one replica that belongs in a separate pre-deploy job instead, to avoid a
migration race.

**PostgreSQL, Redis, MinIO and OpenSearch publish to `127.0.0.1` only.** Docker
publishes ports through its own NAT rules, which sit _in front of_ the host
firewall, so a plain `5432:5432` on a machine with a public interface is a
database on the internet whether or not `ufw` is running. Reach them over an
SSH tunnel. The API, web and mobile services do bind every interface, because a
reverse proxy or another host has to reach them.

> **Not verified in this environment.** The Docker daemon was unavailable while
> this was built, so the compose file and Dockerfiles are written and reviewed
> but have not been run. Treat the first `docker compose up` as a smoke test.

## Kubernetes

Manifests in `infrastructure/kubernetes/`:

```bash
kubectl apply -f infrastructure/kubernetes/namespace.yaml
# Replace with a sealed secret or External Secrets — do not commit real values.
kubectl apply -f infrastructure/kubernetes/secrets.example.yaml
kubectl apply -f infrastructure/kubernetes/configmap.yaml
kubectl apply -f infrastructure/kubernetes/api-deployment.yaml
kubectl apply -f infrastructure/kubernetes/mobile-deployment.yaml
kubectl apply -f infrastructure/kubernetes/web-deployment.yaml
kubectl apply -f infrastructure/kubernetes/ingress.yaml
```

Decisions worth knowing:

**Migrations run in an init container**, so three replicas starting together
cannot race on the migration lock.

**Liveness and readiness differ.** Liveness hits `/api/health/live`, which
answers without touching the database — otherwise a slow query triggers a
restart loop that makes the outage worse. Readiness hits `/api/health`, which
checks dependencies, so an instance that cannot reach the database leaves the
load-balancer pool without being killed.

**The ingress sets long proxy timeouts** on `/socket.io`, or the proxy cuts idle
auction connections between bids.

**Vintrax Mobile gets its own host** (`m.vintrax.example.com`) rather than a path on
the web host. Its manifest scope is `/`, and a service worker cannot claim a
scope above its own path.

**Rolling updates use `maxUnavailable: 0`** with a PodDisruptionBudget, so
capacity never dips during a deploy — which matters while an auction is live.

**Containers run read-only, non-root, with all capabilities dropped.**

## Cloud infrastructure

`infrastructure/terraform/` provisions the managed services on AWS as a
reference example: RDS PostgreSQL, ElastiCache Redis, an S3 bucket behind
CloudFront, and an optional OpenSearch domain. Compute is deliberately omitted —
use the Kubernetes manifests, or add an ECS service.

```bash
cd infrastructure/terraform
terraform init
terraform plan -var-file=environments/production.tfvars
```

Choices encoded there:

- **Multi-AZ, deletion protection and 30-day backups** only when
  `environment = "production"`.
- **Redis `maxmemory-policy: noeviction`** — BullMQ jobs and auction settlement
  locks must never be evicted under memory pressure.
- **S3 versioning on, public access fully blocked**; objects are served through
  CloudFront with an origin access control, never directly.
- **Long CDN cache TTLs**, because uploaded objects have generated immutable
  names.

Review every default before using this for anything real, and add remote state
with locking.

## Configuration

Every variable is documented in [configuration](./guides/configuration.md). The
ones that must change for production:

| Variable                                   | Production value                                                   |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `NODE_ENV`                                 | `production`                                                       |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Distinct, from `openssl rand -base64 48`                           |
| `CORS_ORIGINS`                             | Real origins only, no wildcard                                     |
| `STORAGE_DRIVER`                           | `s3` — local disk is lost on restart and invisible across replicas |
| `DATABASE_URL`                             | Include `connection_limit` sized to your replica count             |
| `MAIL_DRIVER`                              | `smtp`                                                             |

The API **refuses to start** in production with the example JWT secrets, and
rejects a configuration where the two secrets match.

## Scaling

**The API is stateless** once storage is externalised, so it scales
horizontally. Before doing that:

- **Move off local disk.** `STORAGE_DRIVER=s3`. An upload handled by instance A
  is invisible to instance B otherwise.
- **Rate limiting is per-instance and in-memory.** With N instances the
  effective limit is N times the configured value. A Redis-backed store is
  **not yet implemented**.
- **Database connections** are the usual first ceiling. Keep
  instances × `connection_limit` under the server's `max_connections`, and
  consider PgBouncer beyond a handful of instances.

**WebSockets need sticky sessions or a Redis adapter.** Socket.IO rooms are
per-process, so a broadcast from instance A does not reach a client connected to
instance B. The `@socket.io/redis-adapter` is the fix and is **not yet
implemented** — until then, run one API replica for live auctions, or configure
session affinity.

## Observability

Currently: structured logs to stdout, request correlation ids, and the health
endpoint. That is the honest extent of it.

Before carrying real traffic: error tracking, metrics (latency, error rate,
queue depth, database pool saturation), log aggregation keyed on `requestId`,
and alerting on readiness failures and queue backlog. All **not yet
implemented**.

## Backups

Terraform configures automated RDS backups with point-in-time recovery.
**Restores have not been tested** — a backup you have never restored is a
hypothesis. Rehearse it before launch.

S3 versioning protects media against accidental deletion.

## Pre-launch checklist

- [ ] Real JWT secrets in a secret manager, never in the repository
- [ ] `NODE_ENV=production`, `CORS_ORIGINS` set to real origins
- [ ] A real `REDIS_PASSWORD`, and no datastore reachable from outside the host
- [ ] `STORAGE_DRIVER=s3` with a CDN in front, and the bucket **private** —
      vehicle documents are authorized by the API, which cannot help if the
      objects are anonymously readable at their own URL
- [ ] Migrations run as a discrete pre-deploy step
- [ ] Liveness and readiness probes wired correctly
- [ ] TLS terminated; HTTP redirected
- [ ] WebSocket scaling resolved (Redis adapter or session affinity)
- [ ] Rate limiting backed by Redis if running more than one replica
- [ ] Error tracking and log aggregation in place
- [ ] Database restore rehearsed
- [ ] A payment gateway actually integrated — orders currently record a
      reference that something else must produce
- [ ] `SECURITY.md` published with a disclosure contact

Related: [architecture](./architecture.md) ·
[security model](./architecture/security.md) ·
[future work](./reference/future-work.md)
