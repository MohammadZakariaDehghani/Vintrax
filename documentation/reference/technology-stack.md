# Technology stack

Every technology in use, its role, and why it was chosen over the obvious alternative.

## At a glance

| Layer           | Choice                  | Version              |
| --------------- | ----------------------- | -------------------- |
| Language        | TypeScript              | 5.7                  |
| Runtime         | Node.js                 | ≥ 20.11 (CI runs 22) |
| Package manager | pnpm workspaces         | 10.33                |
| API framework   | NestJS                  | 11                   |
| ORM             | Prisma                  | 6                    |
| Database        | PostgreSQL              | 16                   |
| Validation      | Zod                     | 3.24                 |
| Auth            | Passport JWT + bcryptjs | —                    |
| Web framework   | React                   | 19                   |
| Build tool      | Vite                    | 6                    |
| Routing         | React Router            | 7                    |
| Server state    | TanStack Query          | 5                    |
| Styling         | Hand-written CSS        | —                    |
| API tests       | Jest + ts-jest          | 29                   |
| Web tests       | Vitest                  | 3                    |
| CI              | GitHub Actions          | —                    |

## Foundation

### TypeScript everywhere

Strict mode, plus `noUncheckedIndexedAccess`, which forces array and record access to be
null-checked. It is occasionally irritating and it catches real bugs.

One language across the API, the web app, and the shared contracts is what makes
`packages/shared` possible at all — the same Zod schema validates a request server-side and a form
client-side.

### pnpm workspaces

Chosen over npm or Yarn workspaces for strict dependency isolation: pnpm's non-flat `node_modules`
means a package cannot import something it did not declare. In a monorepo where two apps share one
package, that discipline prevents accidental coupling.

Also chosen over Nx or Turborepo. Those add build caching and task orchestration that a three-package
workspace does not need yet; plain pnpm scripts stay obvious. Revisit if the workspace grows.

`packageManager` in the root `package.json` pins the version, so everyone and CI use the same pnpm.

### PostgreSQL 16

Relational is the right shape here — listings, sellers, conversations, and favourites are all
relationships, and search filters across many dimensions at once.

Postgres specifically for enum types, partial and composite indexes, and, when search relevance
becomes real work, native full-text search with `tsvector` and `ts_rank`. That last one is the
reason not to reach for a separate search service yet.

## API

### NestJS

Chosen over Express or Fastify directly.

A marketplace API needs authentication, role-based authorisation, request validation, uniform error
mapping, and dependency injection. With bare Express those are assembled by hand and drift apart.
Nest supplies guards, pipes, filters, and modules as first-class concepts, so cross-cutting concerns
are declared once and applied globally — `JwtAuthGuard` is registered in one place and every route is
authenticated by default.

The cost is decorators and a DI container, which is why the compiler choice below matters.

> **NestJS requires `emitDecoratorMetadata`.** esbuild cannot emit it, so esbuild-based runners
> (`tsx`, plain SWC) break dependency injection in a way that is hard to diagnose — the container
> silently injects `undefined`. The API therefore builds and runs through the Nest CLI, which uses
> `tsc`. See [implementation notes](./implementation-notes.md#the-decorator-metadata-trap).

### Prisma

Chosen over TypeORM, Drizzle, or raw SQL.

Its generated types are derived from the schema, so a `select` returns a type containing exactly the
fields selected — `row.description` is a compile error if description was not selected. Combined
with `satisfies Prisma.ListingSelect` on shared select objects, this catches a whole class of "field
is undefined at runtime" bugs.

Migrations are first-class and reviewable as SQL before committing.

The trade-off is less control over generated queries. Where that matters — real relevance ranking —
the plan is `$queryRaw` with `ts_rank` rather than fighting the query builder.

Drizzle would give tighter SQL control with a thinner abstraction; it was passed over because
Prisma's migration tooling and type ergonomics were worth more for a greenfield schema.

### Zod

Runtime validation that produces static types, so a schema is both the validator and the type
definition — they cannot drift.

Chosen over `class-validator`, which is Nest's default pairing. `class-validator` needs decorated
classes, and classes do not travel well into a browser bundle. Zod schemas are plain values that both
the API and the web app import from `@vintrax/shared`. That is the whole reason the contract package
works, so it drove the choice.

The cost is losing automatic Swagger schema generation from decorators. Acceptable: the shared
package documents the contract more precisely than generated schemas would.

Version 3.24 rather than 4.x, for stability.

### bcryptjs

Pure JavaScript, so no native compilation and no build-toolchain surprises across platforms.

The native `bcrypt` package is faster, and `argon2` is the stronger modern choice. Both need
`node-gyp`. At current scale, cost-12 bcryptjs is comfortably fast enough; argon2 is worth revisiting
when login volume justifies the build complexity.

### Passport JWT, Helmet, Throttler

`@nestjs/passport` with `passport-jwt` for token extraction and verification — the well-trodden path,
integrating cleanly with Nest guards.

`helmet` for standard protective headers. `@nestjs/throttler` for rate limiting, in-memory today,
which is a real limitation at more than one instance.

## Web

### React 19

Chosen over Vue, Svelte, or Angular mostly for ecosystem depth and hiring pool. Nothing in the app
depends on React-specific behaviour; the architecture would port.

### Vite 6

Fast dev server, straightforward production builds, and a dev proxy that keeps the browser on one
origin so image URLs resolve without rewriting and CORS is not exercised locally.

Chosen over Next.js deliberately. Next.js would give server rendering — which a public marketplace
genuinely wants for SEO on listing pages — but it blurs the client/server boundary that
[D-006](../decision-log.md) depends on: the auction application must consume the same API, and an
API that exists partly as Next.js route handlers is harder to share. SPA now, with server rendering
revisited when SEO becomes a real constraint rather than a hypothetical one.

### React Router 7

Client-side routing, but more importantly `useSearchParams`, which is what makes URL-as-state
practical. Search filters live in the query string so a search is shareable, survives reload, and
works with the back button.

### TanStack Query 5

Server state — caching, deduplication, invalidation, loading and error states — without a global
store. The alternative was Redux or Zustand plus hand-written fetch logic, which reimplements caching
badly.

Its most valuable property here is the hierarchical query key. Favouriting a listing invalidates
`['listings']` and every listing view refreshes from one line.

### Hand-written CSS

No Tailwind, no CSS-in-JS, no component library.

One `styles.css` with custom properties. Rationale: the design system is small enough that a token
block plus component classes is legible in one file, it adds no build step or runtime, and theming
is native CSS variables. Dark mode is roughly forty lines of token overrides.

The cost is discipline — nothing stops a stray inline style. Worth revisiting if the surface grows
substantially, though the ordering trap documented in [web app architecture](../architecture/web-app.md#token-layering)
is a genuine footgun of this approach.

## Testing

**Jest with ts-jest** for the API, because it handles decorators and `emitDecoratorMetadata`
correctly — the same reason the API does not build with esbuild.

**Vitest** for the web app, because it reads `vite.config.ts` directly, so the `@vintrax/shared` alias
applies automatically and tests import exactly what the app imports.

Two runners is mild inconsistency; each is the right tool for its side.

## Tooling

**GitHub Actions** for CI, with a PostgreSQL service container so migrations are proven against an
empty database on every change.

**Prettier** for formatting: 100 columns, single quotes, trailing commas.

**Docker Compose** for local PostgreSQL only. Neither application is containerised yet — see
[deployment](../guides/deployment.md).

## Considered and not chosen

| Technology             | Instead of         | Why not                                                  |
| ---------------------- | ------------------ | -------------------------------------------------------- |
| Next.js                | Vite + React       | Blurs the API boundary [D-006](../decision-log.md) needs |
| Express/Fastify alone  | NestJS             | Cross-cutting concerns assembled by hand                 |
| Drizzle                | Prisma             | Weaker migration tooling for a greenfield schema         |
| TypeORM                | Prisma             | Weaker type inference                                    |
| Tailwind               | Plain CSS          | Extra build step for a small design system               |
| Redux / Zustand        | TanStack Query     | Server state is not client state                         |
| `class-validator`      | Zod                | Decorated classes do not travel to the browser           |
| argon2 / native bcrypt | bcryptjs           | Native build complexity, not yet justified               |
| Elasticsearch          | Postgres full-text | Premature at this catalogue size                         |
| Nx / Turborepo         | pnpm scripts       | Orchestration a three-package workspace does not need    |
| GraphQL                | REST               | No client-shaped-query problem to solve yet              |
| WebSockets             | Polling            | [D-005](../decision-log.md) chose async messaging first  |
