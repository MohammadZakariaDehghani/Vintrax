# Atlas documentation

Everything written down about Project Atlas: what it is, how it is built, how to work on it, and
where it goes next.

## Start here

| If you are… | Read |
| --- | --- |
| New to the project | [Project Atlas HQ](./atlas-hq.md) |
| Setting up to develop | [Getting started](./guides/getting-started.md) |
| Trying to understand the system | [Architecture overview](./architecture/overview.md) |
| Integrating with the API | [API reference](./architecture/api-reference.md) |
| Wondering why something is the way it is | [Decision Log](./decision-log.md) |
| Planning the next phase | [Future work](./reference/future-work.md) |

## Product and direction

- **[Project Atlas HQ](./atlas-hq.md)** — vision, mission, phased roadmap, guiding principles,
  user groups, and open questions. The front door to the project.
- **[Decision Log](./decision-log.md)** — every significant accepted decision with its rationale
  and consequences, identified as `D-nnn` so later documents can cite one without reopening it.

## Architecture

- **[Overview](./architecture/overview.md)** — system shape, component responsibilities, request
  lifecycle, and the boundaries that exist so the auction product can be added later.
- **[Data model](./architecture/data-model.md)** — entities, relationships, indexes, and the
  invariants the schema enforces.
- **[API reference](./architecture/api-reference.md)** — every endpoint, its authorisation rule,
  request and response shape, and error semantics.
- **[Security model](./architecture/security.md)** — authentication, token handling, authorisation,
  input validation, and what is deliberately not yet addressed.
- **[Web app](./architecture/web-app.md)** — routing, server state, auth handling, styling, and the
  URL-as-state approach used for search.

## Guides

- **[Getting started](./guides/getting-started.md)** — from a clean machine to a running
  marketplace with demo data.
- **[Development workflow](./guides/development-workflow.md)** — branching, commits, CI, code
  review, database changes, and the shared-contract change process.
- **[Testing](./guides/testing.md)** — what is tested, at what level, and how to add tests.
- **[Configuration](./guides/configuration.md)** — every environment variable, its default, and its
  effect.
- **[Deployment](./guides/deployment.md)** — what production needs that local development does not.

## Reference

- **[Technology stack](./reference/technology-stack.md)** — every technology in use and why it was
  chosen over the obvious alternative.
- **[Implementation notes](./reference/implementation-notes.md)** — how the MVP was actually built,
  including the traps hit along the way and how to avoid repeating them.
- **[Future work](./reference/future-work.md)** — Phase 2 through Phase 4 in enough detail to plan
  against, plus the known limitations carried forward from Phase 1.

## Conventions used in these documents

Decisions are cited as **[D-006](./decision-log.md)** and link to the Decision Log. Where a document
describes something not yet built, it says so explicitly rather than describing an aspiration in the
present tense. Code references use `path/to/file.ts` relative to the repository root.
