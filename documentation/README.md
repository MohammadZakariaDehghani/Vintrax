# Atlas documentation

Everything written down about the Atlas platform: what it is, how it is built,
how to work on it, and where it goes next.

## Start here

| If you are… | Read |
| --- | --- |
| Setting up to develop | [Developer guide](./developer-guide.md) |
| Understanding the system | [Architecture](./architecture.md) |
| Integrating with the API | [API reference](./api-reference.md) |
| Working on the API | [Backend](./backend.md) |
| Working on the UI | [Frontend](./frontend.md) |
| Working on the mobile app | [Mobile](./mobile.md) |
| Deploying | [Deployment](./deployment.md) |
| Wondering why something is the way it is | [Decision Log](./decision-log.md) |
| Planning what comes next | [Future work](./reference/future-work.md) |

## Core documents

- **[Architecture](./architecture.md)** — system shape, request lifecycle, the
  bid path, and the boundaries kept open on purpose.
- **[Backend](./backend.md)** — modules, authentication, authorisation, the
  auction engine, background jobs.
- **[Frontend](./frontend.md)** — pages, state management, live auctions, the
  design system, accessibility.
- **[Mobile](./mobile.md)** — the installable PWA: screens, touch constraints,
  live bidding, camera capture, offline behaviour.
- **[Brand](./brand.md)** — the mark, the palette, and why red is not a brand
  colour here.
- **[API reference](./api-reference.md)** — every endpoint, its authorisation
  rule, and error semantics.
- **[Deployment](./deployment.md)** — Docker, Kubernetes, cloud, and what is
  still missing before production.
- **[Developer guide](./developer-guide.md)** — setup, demo accounts, workflows,
  CI, troubleshooting.

## Product and direction

- **[Project Atlas HQ](./atlas-hq.md)** — vision, phased roadmap, principles.
- **[Decision Log](./decision-log.md)** — every accepted decision with rationale
  and consequences, identified as `D-nnn`.

## Deeper reference

### Architecture detail
- [Overview](./architecture/overview.md) · [Data model](./architecture/data-model.md)
- [Security model](./architecture/security.md) · [Web app internals](./architecture/web-app.md)
- [API contract detail](./architecture/api-reference.md)

### Guides
- [Getting started](./guides/getting-started.md) · [Development workflow](./guides/development-workflow.md)
- [Testing](./guides/testing.md) · [Configuration](./guides/configuration.md)
- [Deployment notes](./guides/deployment.md)

### Reference
- [Technology stack](./reference/technology-stack.md) — every technology and the
  alternative it was chosen over
- [Implementation notes](./reference/implementation-notes.md) — how it was built
  and the traps hit along the way
- [Future work](./reference/future-work.md) — roadmap and the technical debt
  register

## Conventions

Decisions are cited as **[D-006](./decision-log.md)**. Where a document
describes something not yet built, it says so explicitly rather than describing
an aspiration in the present tense. Code references use `path/to/file.ts`
relative to the repository root.
