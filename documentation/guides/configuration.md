# Configuration

Every environment variable, what it does, and what happens if it is wrong.

Configuration is validated at boot by a Zod schema in `apps/api/src/config/env.ts`. A missing or
malformed value **stops the process with a readable report** rather than surfacing later as a
runtime 500.

## Where configuration is read from

The API loads, in order of precedence:

1. Real environment variables
2. `apps/api/.env`
3. `.env` at the repository root

The root fallback means one file can drive both applications in local development. Never commit a
real `.env` — `.gitignore` covers it. `.env.example` is the template and is committed.

## API variables

### `NODE_ENV`

`development` (default) · `test` · `production`

Beyond the usual framework effects, this gates two things: Swagger UI is only mounted outside
production, and the placeholder-secret check below only applies in production.

### `API_PORT`

Integer 1–65535. Default `3000`.

If you change it, update `VITE_API_PROXY_TARGET` for the web dev server too, or the proxy will point
at nothing.

### `DATABASE_URL` — required

PostgreSQL connection string.

```
postgresql://atlas:atlas@localhost:5432/atlas_dev?schema=public
```

Read by both the Prisma CLI (migrations, seeding) and the runtime client. In production, append
connection-pool settings appropriate to your deployment, for example
`?connection_limit=10&pool_timeout=20`.

### `JWT_ACCESS_SECRET` — required

Minimum 16 characters. Signs short-lived access tokens.

### `JWT_REFRESH_SECRET` — required

Minimum 16 characters. Signs refresh tokens.

**Must differ from `JWT_ACCESS_SECRET`** — the schema rejects identical values. Separate secrets mean
a leaked access secret cannot be used to mint refresh tokens.

In production, the schema also **refuses to start** if either secret still holds its `.env.example`
placeholder. Generate real ones:

```bash
openssl rand -base64 48
```

Rotating either secret invalidates every existing token of that type, signing all users out.

### `JWT_ACCESS_TTL`

Default `15m`. Any [ms](https://github.com/vercel/ms) duration — `15m`, `1h`, `900s`.

Short by design: the JWT strategy re-reads the user on every request, so a role change or deletion
takes effect immediately, but the token itself should still be cheap to lose.

### `JWT_REFRESH_TTL`

Default `30d`. How long a user stays signed in without re-entering credentials.

### `CORS_ORIGINS`

Comma-separated allowlist. Default `http://localhost:5173`.

```
CORS_ORIGINS="https://atlas.example.com,https://www.atlas.example.com"
```

Not a wildcard. Include the scheme; exclude the trailing slash. Every origin that will call the API
from a browser must be listed — the web app, and later the auction application.

### `UPLOAD_DIR`

Default `./uploads`, resolved relative to the API's working directory.

Listing photos are written to `<UPLOAD_DIR>/listings/` and seed images to `<UPLOAD_DIR>/seed/`. The
directory is created at boot if missing and served as static assets under `/uploads`.

In production this must be persistent storage, not container-local disk — or better, replaced with
object storage. See [deployment](./deployment.md#file-storage).

### `MAX_UPLOAD_BYTES`

Default `5242880` (5 MB). Minimum 1024. Per-file ceiling for listing photos.

## Web variables

Vite only exposes variables prefixed with `VITE_` to the browser bundle. **Never put a secret in
one** — they are compiled into the JavaScript and readable by anyone.

### `VITE_API_URL`

Default `/api`.

The relative default is deliberate: the dev server proxies `/api` to the API, keeping the browser on
one origin so listing image URLs resolve without rewriting and CORS is not exercised in development.

Set an absolute URL only when the API is on a different origin in production, in which case that
origin must appear in `CORS_ORIGINS`.

### `VITE_API_PROXY_TARGET`

Default `http://127.0.0.1:3000`. Dev server only — where `/api` and `/uploads` are proxied. Change
it if you changed `API_PORT`.

## Complete example

Local development — this is `.env.example`:

```bash
DATABASE_URL="postgresql://atlas:atlas@localhost:5432/atlas_dev?schema=public"

API_PORT=3000
NODE_ENV=development

JWT_ACCESS_SECRET="dev-only-access-secret-change-me"
JWT_REFRESH_SECRET="dev-only-refresh-secret-change-me"
JWT_ACCESS_TTL="15m"
JWT_REFRESH_TTL="30d"

CORS_ORIGINS="http://localhost:5173"

UPLOAD_DIR="./uploads"
MAX_UPLOAD_BYTES=5242880

VITE_API_URL="http://localhost:3000/api"
```

Production:

```bash
NODE_ENV=production
API_PORT=3000

DATABASE_URL="postgresql://atlas:<password>@db.internal:5432/atlas?schema=public&connection_limit=10"

JWT_ACCESS_SECRET="<openssl rand -base64 48>"
JWT_REFRESH_SECRET="<a different openssl rand -base64 48>"
JWT_ACCESS_TTL="15m"
JWT_REFRESH_TTL="30d"

CORS_ORIGINS="https://atlas.example.com"

UPLOAD_DIR="/var/lib/atlas/uploads"
MAX_UPLOAD_BYTES=5242880
```

## When validation fails

The process exits with a report naming each problem:

```
Invalid environment configuration:
  - DATABASE_URL: DATABASE_URL is required
  - JWT_ACCESS_SECRET: JWT_ACCESS_SECRET must be at least 16 characters
```

Common causes:

| Message | Cause |
| --- | --- |
| `DATABASE_URL is required` | No `.env`, or the variable is absent |
| `must be at least 16 characters` | Secret too short |
| `must be different values` | Both JWT secrets are the same string |
| `Refusing to start in production with the example…` | `.env.example` placeholder left in a production deploy |

## Adding a variable

1. Add it to the schema in `apps/api/src/config/env.ts` with a default where sensible.
2. Add it to `.env.example` with a comment.
3. Document it here.
4. If CI needs it, add it to the `env` block in `.github/workflows/ci.yml`.

Read it through `ConfigService` rather than `process.env`, so it stays typed and validated:

```ts
const value = this.config.get('MY_VARIABLE', { infer: true });
```
