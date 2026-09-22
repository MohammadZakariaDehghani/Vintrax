# Docker and production deployment

Everything needed to take Vintrax from a clean Ubuntu server to a running
platform behind HTTPS, and to keep it running.

The shape of it:

```
GitHub ──push──> Actions ──build──> GHCR ──pull──> Ubuntu server
                    │                                   │
                 verify                          docker compose up -d
              (typecheck, lint,                         │
               test, build, seed)                    Nginx :443
                                                        │
                                          ┌─────────────┼─────────────┐
                                         web           api          mobile
                                        :3000         :3001          :3002
                                                        │
                                               PostgreSQL, Redis
                                              (no published port)
```

**The server builds nothing.** It pulls the images CI verified. That is what
makes a rollback a matter of pulling a different tag rather than checking out
older source and hoping it still compiles.

---

## 1. Images

| Image            | From                                        | Runtime                                 |
| ---------------- | ------------------------------------------- | ---------------------------------------- |
| `vintrax-api`    | `infrastructure/docker/backend.Dockerfile`  | Node 22 Alpine, non-root, `:3001`       |
| `vintrax-web`    | `infrastructure/docker/frontend.Dockerfile` | Node 22 Alpine, non-root, `:3000`       |
| `vintrax-mobile` | `infrastructure/docker/mobile.Dockerfile`   | Node 22 Alpine, non-root, `:3002`       |

All three images are Alpine. The API image briefly moved to Debian slim to run
a real headless Chromium for automatic CARFAX report extraction (issue #49,
D-047); issue #67 reverted that feature to five badges the dealer sets
directly, so nothing in the image talks to a browser any more and it is back
on Alpine, the smaller base.

All three build from the **repository root**, not from the app directory: the
pnpm workspace only resolves as a whole, and every image copies _all_ workspace
manifests before installing, because the lockfile describes the whole workspace
and `--frozen-lockfile` fails on a manifest it cannot find.

**The API image has four stages.** `deps` installs the full workspace so the
build has the Nest CLI and `tsc`; `build` compiles `@vintrax/shared`, generates
the Prisma client and runs `nest build`; `proddeps` does a second,
production-only install; `runtime` takes the compiled output and the production
dependencies and nothing else. The second install is what keeps the Nest CLI,
TypeScript, ESLint, Jest and tsx out of the production image.

The Prisma client is generated again in `proddeps` rather than copied from
`build`. pnpm's store paths differ between two installs, and a copied client
resolves to a directory that is not there.

**Both Next images use `output: 'standalone'`** with `outputFileTracingRoot`
set to the workspace root. Tracing has to start there: begun inside the app it
follows pnpm's symlinks out and misses the shared packages.

### Build-time versus runtime

This is the one thing about these images that surprises people.

| Value                        | When                | Why                                                                                                                    |
| ---------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`        | **build**           | Next inlines `NEXT_PUBLIC_*` into the browser bundle                                                                   |
| `NEXT_PUBLIC_WS_URL`         | **build**           | same                                                                                                                   |
| `NEXT_PUBLIC_BRAND_LOGO_SRC` | **build**           | optional; a file in `frontend/public` to use as the brand lockup instead of the drawn one — see [brand.md](./brand.md) |
| `API_ORIGIN`                 | **build _and_ run** | see below                                                                                                              |
| everything else              | run                 | ordinary container environment                                                                                         |

`API_ORIGIN` has two separate consumers:

- **`next.config.mjs` `rewrites()`** — Next resolves rewrites at _build_ time
  into `routes-manifest.json`. Setting `API_ORIGIN` on a running container does
  not move the `/api` proxy. It is a build argument.
- **`serverFetch()`** — reads `process.env.API_ORIGIN` per request for server
  components. That one is genuinely runtime.

Behind Nginx the baked rewrite is never exercised, because the proxy routes
`/api` and `/uploads` to the API before Next sees them. It only matters for a
bare compose stack with nothing in front of it.

**Changing a `NEXT_PUBLIC_*` value means rebuilding the image, not restarting
the container.** `NEXT_PUBLIC_WS_URL` is set from the `NEXT_PUBLIC_WS_URL`
_repository variable_ in GitHub (Settings → Secrets and variables → Actions →
Variables). It is a public URL, not a secret; no secret is ever passed to a
build, because build arguments are visible in the image's history.

---

## 2. Local Docker development

The root `docker-compose.yml` builds from source and is for working on the
project. It is not what production runs.

```bash
cp .env.example .env
# JWT secrets are required even locally, because compose refuses to interpolate
# without them:
printf 'JWT_ACCESS_SECRET=%s\nJWT_REFRESH_SECRET=%s\n' \
  "$(openssl rand -base64 48)" "$(openssl rand -base64 48)" >> .env

docker compose up -d --build       # everything
docker compose up -d postgres redis # just the backing services, for `pnpm dev`
```

Optional extras sit behind profiles, because the defaults need neither:

```bash
docker compose --profile storage up -d   # MinIO, for STORAGE_DRIVER=s3
docker compose --profile search up -d    # OpenSearch, for SEARCH_PROVIDER=opensearch
docker compose --profile full up -d      # both
```

Migrations run as a one-shot `migrate` service that the API waits on with
`depends_on: service_completed_successfully`, so the API never starts against a
schema that has not been migrated.

---

## 3. Ubuntu server setup

Tested against **Ubuntu 22.04 LTS and 24.04 LTS**. Run as a user with sudo.

### 3.1 Prerequisites

```bash
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y ca-certificates curl gnupg git ufw postgresql-client
```

Docker Engine and the Compose plugin, from Docker's own repository — the
`docker.io` package in Ubuntu's archive is older and ships no Compose plugin:

```bash
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
                        docker-buildx-plugin docker-compose-plugin

sudo usermod -aG docker "$USER"   # log out and back in for this to take effect
docker compose version            # confirm the plugin is there
```

Nginx and Certbot:

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

### 3.2 Firewall

Only SSH and HTTP/HTTPS. Nothing else is reachable from outside.

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
sudo ufw status verbose
```

> **`ufw` is not what protects PostgreSQL here.** Docker publishes ports
> through its own iptables rules, which sit _in front of_ ufw — a service
> published on `0.0.0.0` is reachable from the internet whether or not ufw is
> running. What protects the database is that `compose/docker-compose.prod.yml`
> gives PostgreSQL and Redis **no `ports:` entry at all**, and binds the three
> app services to `127.0.0.1`. Do not add a `ports:` mapping to either.

### 3.3 DNS

Point the records at the server before requesting a certificate — Certbot
verifies over HTTP and will fail otherwise.

| Record                    | Type | Value              |
| ------------------------- | ---- | ------------------ |
| `vintrax.example.com`     | A    | your server's IPv4 |
| `www.vintrax.example.com` | A    | your server's IPv4 |
| `m.vintrax.example.com`   | A    | your server's IPv4 |

Add `AAAA` records too if the server has IPv6. Confirm before continuing:

```bash
dig +short vintrax.example.com
```

### 3.4 Directory layout

```
/opt/vintrax/
├── compose/docker-compose.prod.yml   from this repository
├── env/vintrax.env                   real credentials, chmod 600
├── scripts/                          deploy, rollback, backup, restore
├── state/                            which version is deployed (written by deploy.sh)
└── backups/                          pg_dump output, chmod 600
```

```bash
sudo mkdir -p /opt/vintrax/{compose,env,scripts,state,backups}
sudo chown -R "$USER":"$USER" /opt/vintrax
```

Copy four things from the repository — you do **not** need to clone it here:

```bash
BASE=https://raw.githubusercontent.com/MohammadZakariaDehghani/Vintrax/main
curl -fsSL "$BASE/compose/docker-compose.prod.yml" -o /opt/vintrax/compose/docker-compose.prod.yml
for s in deploy rollback backup-db restore-db; do
  curl -fsSL "$BASE/scripts/$s.sh" -o "/opt/vintrax/scripts/$s.sh"
done
chmod +x /opt/vintrax/scripts/*.sh
curl -fsSL "$BASE/.env.production.example" -o /opt/vintrax/env/vintrax.env
```

### 3.5 Configuration

```bash
openssl rand -base64 48   # JWT_ACCESS_SECRET
openssl rand -base64 48   # JWT_REFRESH_SECRET  (must differ)
openssl rand -base64 32   # POSTGRES_PASSWORD
openssl rand -base64 32   # REDIS_PASSWORD

nano /opt/vintrax/env/vintrax.env
chmod 600 /opt/vintrax/env/vintrax.env
```

`deploy.sh` refuses to run if this file is not mode `600` or `400`, if a
required value is missing, or if the JWT secrets are still placeholders — the
API would refuse to start in production anyway, and failing here is a message
rather than a crash loop.

> **`POSTGRES_PASSWORD` only takes effect the first time PostgreSQL starts.**
> It initialises the role when the data directory is empty and ignores the
> variable on every later start. Changing it later means changing it _in the
> database_ with `ALTER ROLE`, and in `DATABASE_URL`, not just in this file.

### 3.6 Registry access

The images are private unless the packages are made public, so log in once:

```bash
# A classic personal access token with the `read:packages` scope.
echo "$GITHUB_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

Credentials land in `~/.docker/config.json`. If the packages are public
instead, skip this — anonymous pulls work.

### 3.7 First deployment

```bash
cd /opt/vintrax/scripts
./deploy.sh sha-a1b2c3d
```

The tag comes from the Actions run summary for the commit you want. `deploy.sh`
pulls first — so a bad tag or a registry outage fails before anything is
stopped — then applies migrations, then rolls the services and waits for their
health checks.

### 3.8 Nginx and TLS

```bash
sudo cp infrastructure/nginx/vintrax.conf.example /etc/nginx/sites-available/vintrax.conf
sudo sed -i 's/vintrax.example.com/your-real-domain.com/g' /etc/nginx/sites-available/vintrax.conf
sudo ln -s /etc/nginx/sites-available/vintrax.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Then the certificate. Install the config **first**: Certbot finds the
`server_name` in an existing block, obtains the certificate, and rewrites the
file to add the TLS directives and the port-80 redirect.

```bash
sudo certbot --nginx -d your-real-domain.com -d www.your-real-domain.com -d m.your-real-domain.com
systemctl list-timers | grep certbot     # renewal is automatic
sudo certbot renew --dry-run             # prove it
```

Finally, set `NEXT_PUBLIC_WS_URL` to `https://your-real-domain.com` as a
repository variable in GitHub and re-run the release workflow. WebSockets
cannot go through Next's rewrite proxy, so the browser connects to that origin
directly and Nginx proxies `/socket.io/` to the API. Until it is set, live
auctions will not connect.

---

## 4. Deploying a new version

A push to `main` does this on its own — see [section 4.1](#41-automatic-releases-from-main).
Everything below is the manual path, and it still works exactly as it did; the
automation runs these same commands over SSH rather than replacing them.

```bash
cd /opt/vintrax/scripts
./deploy.sh --list          # what is running, what it can roll back to
./deploy.sh sha-d4e5f6g
```

Always back up first — it takes a second and it is the difference between a bad
migration being an inconvenience and being an incident:

```bash
./backup-db.sh && ./deploy.sh sha-d4e5f6g
```

**`deploy.sh` refuses to deploy `latest`.** A moving tag leaves nothing to roll
back to and no way to say what is running.

### 4.1 Automatic releases from `main`

`.github/workflows/release.yml` ends with a `deploy` job. After CI passes and
all three images are pushed to GHCR, it opens an SSH session and runs the
command above — the same script, at the same path, with the tag that run just
published:

```bash
cd /opt/vintrax/scripts && ./deploy.sh sha-d4e5f6g
```

Nothing was installed on the server and nothing about it was reconfigured to
make this work. The job needs only the SSH access that already existed.

**Required repository secrets** — Settings → Secrets and variables → Actions:

| Secret                   | What it is                                                          |
| ------------------------ | ------------------------------------------------------------------- |
| `DEPLOY_HOST`            | Hostname or IP of the server                                        |
| `DEPLOY_USER`            | The existing SSH user that already runs `deploy.sh`                 |
| `DEPLOY_SSH_KEY`         | Private key for that user, whole file including the BEGIN/END lines |
| `DEPLOY_SSH_KNOWN_HOSTS` | The server's public host key — see below                            |

Two optional **variables**, on the same page, for a server that is not laid out
the default way: `DEPLOY_PORT` (default `22`) and `DEPLOY_PATH` (default
`/opt/vintrax`).

`DEPLOY_SSH_KNOWN_HOSTS` is not optional and is not a formality. Without a
pinned host key the runner would accept whatever answers on that address and
hand it a key with shell access to production. Produce it from a machine that
already trusts the server:

```bash
ssh-keyscan -p 22 your-server-hostname
```

Paste the whole output. The job fails with the missing names listed if any of
the four is absent, before it connects to anything.

**If the deploy job fails on SSH.** Nothing is deployed until a harmless
`echo` has made the round trip, so an SSH problem fails at the **Test the SSH
connection** step and the server is never touched. That step names which of
four things went wrong, because the exit code on its own cannot: ssh reserves
`255` for its own failures — a wrong key, a wrong host key and a server that is
not answering all produce it — and passes any other status straight through
from the remote command.

| The step says            | What to check                                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `HOST-KEY VERIFICATION`  | `DEPLOY_SSH_KNOWN_HOSTS` does not match this server. Re-run `ssh-keyscan` and paste it whole — see the note below.    |
| `AUTHENTICATION`         | The server refused the key. Compare the fingerprint the job prints with the deploy user's `authorized_keys`.          |
| `CONNECTION`             | The address does not resolve, or nothing is listening. Check `DEPLOY_HOST`, `DEPLOY_PORT`, and the server's firewall. |
| `REMOTE COMMAND FAILURE` | The login worked. Something in the deploy user's shell profile fails or writes to stderr on login.                    |

On an `AUTHENTICATION` failure the job prints the **public** fingerprint of the
key it loaded — never the key itself — which is the fastest way to tell "wrong
key" from "right key, wrong user":

```bash
# on the server, as DEPLOY_USER
ssh-keygen -lf ~/.ssh/authorized_keys
```

One of those lines must match the fingerprint in the log. If none does, the
key in `DEPLOY_SSH_KEY` is not installed for that account.

A `HOST-KEY VERIFICATION` failure is most often a spelling mismatch rather than
a changed server: a key scanned for the DNS name does not verify a connection
made to the IP address, or the other way round. Scan the server by the _same_
string `DEPLOY_HOST` holds. On a non-default port the entry is `[host]:port`,
which `ssh-keyscan -p` writes for you.

The preparation steps check their own secrets as they write them, so an empty
or malformed one fails naming the secret rather than surfacing three steps
later as a refused login. Each is a separate named step — creating `~/.ssh`,
writing the key, writing `known_hosts`, writing the client config — so the red
marker in the Actions UI names the thing that actually failed.

**The first automatic release, safely.** Add a required reviewer to the
`production` environment (Settings → Environments → production → Required
reviewers) before the first push to `main`. The job then waits for an approval
in the Actions run instead of going straight out, so you can read the resolved
tag and approve or cancel. Remove the reviewer once you have watched one run
end to end.

The job will not act on a tag that is not `sha-` followed by hex, will not run
unless all three images published, is serialised so two releases cannot overlap,
and is never cancelled part-way — a run killed between `prisma migrate deploy`
and `compose up` is the worst state to leave this server in. Afterwards it asks
the server, with `./deploy.sh --list`, whether it is really running that version
and fails if not.

Pushing a `v*` tag still publishes images but does not release automatically. A
tag can be cut from anywhere; deploy one by hand, or run the Release workflow
from `main` with **Run workflow**.

### If a deployment fails

It stops and prints the logs of whatever is unhealthy. It does **not** roll
back on its own: the migration has already been applied, and starting the
previous image against the new schema is how a bad deploy becomes data loss.

1. Read the logs. Most failures here are a wrong value in `vintrax.env`.
2. If the schema change is backward compatible — it added a table, a nullable
   column, or an index — `./rollback.sh`.
3. If it is not, restore the database first, then roll back.

---

## 5. Rollback

```bash
cd /opt/vintrax/scripts
./rollback.sh                 # to the recorded previous version
./rollback.sh sha-a1b2c3d     # to a specific one
./rollback.sh --list          # what is available
```

Moving between versions:

```
deploy.sh sha-AAA  →  deploy.sh sha-BBB  →  deploy.sh sha-CCC
                                              rollback.sh      → back on sha-BBB
                                              deploy.sh sha-CCC → forward again
```

`rollback.sh` asks one question before it moves: whether the newer version's
migrations are compatible with the older code. `prisma migrate deploy` only
rolls forward, so if a migration dropped or renamed something the older code
reads, restore the database before rolling back.

It skips the `migrate` service deliberately — running it would apply migrations
again, which is not what rolling back means.

---

## 6. Migrations

```
postgres healthy ──> migrate (one-shot) ──exit 0──> api starts
                          │
                       exit ≠ 0
                          │
                          └──> deployment stops, previous version still serving
```

Production runs **`prisma migrate deploy`**, which applies pending migrations
and nothing else: it never resets, never generates, never prompts, and never
asks about drift. `prisma migrate dev` — which does reset — is a development
command and is not used anywhere in this deployment.

A one-shot service rather than part of the API's start command, for two
reasons. With more than one API replica an inline migration races with itself.
And a failed migration should stop the deployment, not crash-loop a container
that keeps retrying a schema change against a live database.

Writing a migration stays a development task:

```bash
pnpm db:migrate:dev       # creates the migration file — development only
git add backend/prisma/migrations/
```

**The seed is not production data.** `pnpm db:seed` loads demo dealers,
vehicles and auctions, and the production images do not even contain `tsx` to
run it.

---

## 7. Backups

```bash
cd /opt/vintrax/scripts
./backup-db.sh                        # timestamped dump in /opt/vintrax/backups
./backup-db.sh --list                 # what is kept
./backup-db.sh --prune                # apply the retention policy
./backup-db.sh --prune --retention-days 30
```

Dumps are `pg_dump --clean --if-exists`, gzipped, mode 600, named
`vintrax-YYYYmmdd-HHMMSS.sql.gz`. They are written to `.partial` and renamed
only on success, so an interrupted dump can never be mistaken for a good one,
and a dump under 1 KB is rejected rather than kept — a backup of nothing is the
failure that goes unnoticed for a month.

**Nothing is ever deleted without `--prune`,** and even then the most recent
dump is kept however old it is.

Nightly, before the working day:

```bash
crontab -e
0 3 * * * /opt/vintrax/scripts/backup-db.sh --prune >> /var/log/vintrax-backup.log 2>&1
```

The dumps are on the same disk as the database, which protects against a bad
migration but not against losing the machine. Copy them off it:

```bash
0 4 * * * rclone copy /opt/vintrax/backups remote:vintrax-backups
```

### Restoring

```bash
./restore-db.sh --list
./restore-db.sh /opt/vintrax/backups/vintrax-20260911-030000.sql.gz
```

This **overwrites the database** — the dump drops every table before recreating
it, and everything written since the backup is gone. So it stops the API first,
takes a safety dump of the current state, and requires you to type `RESTORE`.
There is no `--force`.

If the restored schema is older than the running image expects:

```bash
docker compose --env-file /opt/vintrax/env/vintrax.env \
  -f /opt/vintrax/compose/docker-compose.prod.yml run --rm migrate
```

---

## 8. Data that must survive

Three named volumes:

| Volume                  | Holds                                       |
| ----------------------- | ------------------------------------------- |
| `vintrax_postgres-data` | the database                                |
| `vintrax_redis-data`    | queued jobs (AOF persistence)               |
| `vintrax_uploads-data`  | uploaded media, with `STORAGE_DRIVER=local` |

`docker compose down` stops and removes the containers and leaves all three
alone. The deployment survives it.

> **`docker compose down -v` deletes all three, permanently.** It is not part of
> any procedure here and no script in this repository passes it. The root
> `docker-compose.yml`'s `pnpm stack:down` does pass it, which is correct for a
> disposable local stack and would be catastrophic on a server.
>
> `docker system prune -a` is also never right on this machine: it removes the
> previous version's images, which is exactly what `rollback.sh` needs.

---

## 9. Logs

```bash
cd /opt/vintrax
COMPOSE="docker compose --env-file env/vintrax.env -f compose/docker-compose.prod.yml"

$COMPOSE logs                 # everything
$COMPOSE logs -f              # follow
$COMPOSE logs -f api          # one service
$COMPOSE logs --tail 200 web
$COMPOSE logs --since 30m api
$COMPOSE ps                   # status and health
```

Every service caps its logs at 5 files of 20 MB. Without a cap, container logs
grow until the disk is full and every service on the host fails at once — a
worse outage than the one that filled them.

The API logs errors, warnings and startup through Nest's logger. Request
logging is deliberately Nginx's job (`/var/log/nginx/access.log`), so it is not
duplicated.

---

## 10. Health

| Endpoint               | Answers                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `GET /api/health`      | readiness — 503 if PostgreSQL is unreachable; `degraded` if Redis or search is down |
| `GET /api/health/live` | liveness — is the process alive, regardless of dependencies                         |

The container health check uses `/api/health/live`, so a slow query cannot make
a working container look dead. A load balancer should use `/api/health`, which
is the one that knows whether the instance can actually serve.

```bash
curl -fsS http://127.0.0.1:3001/api/health | jq
docker compose -f compose/docker-compose.prod.yml ps   # web, mobile, postgres, redis health
```

---

## 11. Troubleshooting

**`deploy.sh` says the env file is mode 644.** It holds the database password
and both JWT secrets. `chmod 600 /opt/vintrax/env/vintrax.env`.

**`could not pull` a tag that exists.** The packages are private and this
machine is not logged in: `docker login ghcr.io` (§3.6). A token needs
`read:packages`.

**Migrations fail with `P1000: Authentication failed`.** `POSTGRES_PASSWORD` was
changed after the database was first created. PostgreSQL only reads it when
initialising an empty data directory. Either set `DATABASE_URL` back to the
original password, or change it in the database:

```bash
docker compose -f compose/docker-compose.prod.yml exec postgres \
  psql -U vintrax -d vintrax -c "ALTER ROLE vintrax WITH PASSWORD 'new-password';"
```

**The API exits immediately.** It validates its whole environment at startup and
refuses to boot half-configured. `docker compose logs api` names the variable.
It also refuses, in production, to start with the `.env.example` placeholder JWT
secrets or with both secrets set to the same value.

**Pages render but nothing loads in the browser.** Browser calls go to `/api`
on the page's own origin. Check that Nginx has the `/api/` block and is
reloaded: `curl -I https://your-domain/api/health`.

**Live auctions never connect.** `NEXT_PUBLIC_WS_URL` is compiled into the
bundle. If it is empty or wrong, the socket has nowhere to go and no restart
fixes it — set the repository variable and rebuild (§3.8). Also confirm Nginx's
`/socket.io/` block forwards `Upgrade` and `Connection`; without them the
connection silently degrades to polling that never upgrades.

**Uploaded images 404 after a deploy.** `uploads-data` was not mounted, or
`STORAGE_DRIVER` is `s3` without a reachable bucket. `docker volume ls | grep
uploads`.

**A 413 on upload.** Nginx's `client_max_body_size` is below the API's
`MAX_UPLOAD_BYTES`. Raise the Nginx value; it must be the larger of the two or
the API never gets to explain the limit.

**Out of disk.** Old images accumulate. Remove specific ones you no longer need
— never `docker system prune -a`, which takes the rollback target with it:

```bash
docker images | grep vintrax-
docker rmi ghcr.io/OWNER/vintrax-api:sha-OLD
```

---

## 12. Kubernetes and Terraform

`infrastructure/kubernetes/` and `infrastructure/terraform/` are reference
examples that were renamed alongside everything else. They are not the
deployment path described here and have not been applied to a live cluster.
