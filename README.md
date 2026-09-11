# Vintrax

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


| URL                                |                                  |
| ---------------------------------- | -------------------------------- |
| <http://localhost:3000>            | Marketplace                      |
| <http://localhost:3002>            | Vintrax Mobile (installable PWA) |
| <http://localhost:3001/api/docs>   | Swagger API documentation        |
| <http://localhost:3001/api/health> | Dependency readiness             |


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


## Documentation

|                                                                    |                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------ |
| [Architecture](./documentation/architecture.md)                    | System shape, request lifecycle, the bid path          |
| [Backend](./documentation/backend.md)                              | Modules, auth, the auction engine, jobs                |
| [Frontend](./documentation/frontend.md)                            | Pages, state, live auctions, design system             |
| [Mobile](./documentation/mobile.md)                                | The PWA: screens, live bidding, camera, offline        |
| [Brand](./documentation/brand.md)                                  | The mark, the palette, and the rules behind them       |
| [Roles and transaction flows](./documentation/transaction-flow.md) | What each role can do, and how every process moves     |
| [Security audit](./documentation/security-audit.md)                | Findings, evidence, what was fixed, what is still owed |
| [API reference](./documentation/api-reference.md)                  | Every endpoint                                         |
| [Docker and production deployment](./documentation/docker.md)      | Images, GHCR, Ubuntu, Nginx, TLS, backups, rollback    |
| [Deployment](./documentation/deployment.md)                        | Docker, Kubernetes, cloud                              |
| [Developer guide](./documentation/developer-guide.md)              | Setup, workflows, CI, troubleshooting                  |
| [Decision Log](./documentation/decision-log.md)                    | Why things are the way they are                        |
| [Future work](./documentation/reference/future-work.md)            | Roadmap and technical debt                             |


## Known limitations

Deliberate boundaries, documented rather than hidden:

- **Payments are recorded, not processed.** There is no gateway integration —
  `POST /orders/:id/payment` records a reference something else must produce.
  Only the seller on the order or an administrator may record it, but nothing
  verifies that the money actually moved.
- **WebSocket scaling needs a Redis adapter** before running more than one API
  replica; socket rooms are per-process today.
- **Rate limits are per-instance and in-memory.**
- **The Kubernetes manifests and Terraform have not been applied** to a live
  cluster; they are reference examples. The container path in
  [docker.md](./documentation/docker.md) has been built and run end to end.
- **Tokens live in `localStorage`**, which is XSS-exposed; moving refresh tokens
  to `HttpOnly` cookies is planned hardening.

The full register is in
[future work](./documentation/reference/future-work.md).
