# Future work

What Phase 1 deliberately left out, and what Phases 2 through 4 involve in enough detail to plan
against.

Phase definitions come from the [HQ document](../atlas-hq.md). This document adds implementation
detail; the HQ document remains the authority on direction.

## Carried forward from Phase 1

These are deliberate boundaries, not defects. Each has a note in the code or the README.

| Limitation | Impact | Effort to close |
| --- | --- | --- |
| `RELEVANCE` sort is recency | Keyword searches rank by date, not match quality | Medium |
| Keyword search is `ILIKE` substring | No word boundaries, no stemming; short terms skip descriptions | Medium |
| Uploads written to local disk | Breaks on more than one instance; lost on restart | Small |
| Messaging polls, no push | Up to 60s before a new message appears | Medium |
| No email delivery | No verification, password reset, or notifications | Medium |
| Tokens in `localStorage` | XSS can steal a session | Small |
| Rate limits in-memory | Ineffective across replicas | Small |
| Dealer verification is a DB flag | No admin UI | Medium |
| No moderation tooling | No way to action a report | Large |
| No caching | Every read hits PostgreSQL | Medium |
| No background jobs | Nothing can happen outside a request | Medium |

## Immediate hardening

Worth doing before real users, largely independent of phase.

### Authentication hardening

Move refresh tokens from `localStorage` into `HttpOnly; Secure; SameSite=Strict` cookies, keeping the
access token in memory only. This removes the XSS session-theft path, at the cost of CSRF protection
on refresh and logout, and a CORS credentials configuration.

Then, in rough priority: email verification, password reset, and 2FA — dealer accounts first, since
they carry the most inventory value.

### Distributed rate limiting

`@nestjs/throttler` supports a Redis storage provider. Without it, N instances means N times the
configured limit. Small change, necessary before scaling past one instance.

### Object storage

Replace `apps/api/src/modules/uploads/uploads.controller.ts` with an S3-compatible implementation.
The response contract is already `{ url }`, so **nothing else in the codebase changes** — that seam
was left deliberately. Add image resizing at upload time while you are there; listing cards currently
download full-size images.

### Observability

Request logging with correlation ids, error tracking, and metrics on latency, error rate, and
database pool saturation. Currently there is stdout logging and a health endpoint, which is not
enough to diagnose a production incident.

## Phase 2 — Marketplace growth

> Improve listing workflows, private-seller capabilities, saved searches, notifications,
> comparisons, trust features, dealer tools, and marketplace quality based on real usage.

### Search quality

The largest single improvement available.

Add a generated `tsvector` column with a GIN index:

```sql
ALTER TABLE "Listing" ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(make, '') || ' ' || coalesce(model, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(trim, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'C')
  ) STORED;

CREATE INDEX listing_search_idx ON "Listing" USING GIN (search_vector);
```

Prisma cannot express generated columns, so this needs a hand-written migration and `$queryRaw` for
the search path. In exchange: real `ts_rank` relevance, word-boundary matching (so `ev` stops
matching "Chevrolet"), stemming, and the removal of the three-character workaround.

Keep the enum term mapping — it is orthogonal and genuinely useful.

Follow-ons: typo tolerance via `pg_trgm`, and search suggestions from popular queries.

### Saved searches and alerts

Buyers save a filter set and receive notification when matching listings appear. Needs:

- A `SavedSearch` table storing the serialised filter object — the URL-as-state design already gives
  a canonical serialisation to reuse.
- A background job matching new listings against saved searches.
- Email delivery, and therefore a job queue.

This is the first feature that genuinely requires infrastructure Phase 1 does not have.

### Notifications

Email for new messages, saved-search matches, and listing status changes. Requires a transactional
email provider, templates, a queue, and per-user preferences with unsubscribe handling.

### Comparison

Side-by-side comparison of two to four listings. Mostly frontend; the URL-as-state approach extends
naturally (`/compare?ids=a,b,c`).

### Trust features

- **Listing quality scoring** — nudge sellers toward photos, VIN, and complete descriptions.
- **Seller ratings** after a completed transaction, which requires modelling transactions.
- **Reporting** for listings and messages, which requires moderation tooling to be worth anything.
- **VIN decoding** through a third-party service to auto-fill and cross-check specifications.

### Dealer tools

- **Bulk inventory import** via CSV and dealer management system feeds. The HQ document lists this as
  an open question; it is usually the deciding factor in dealer onboarding.
- **Listing analytics** — views, enquiries, and conversion per listing.
- **Multi-user dealership accounts**, which means a real permission model rather than one role per
  user.

### Administration

An admin interface for user management, dealer verification, listing moderation, and reports.
Currently `ADMIN` bypasses role checks but has no interface. Add an audit log at the same time —
moderation without a trail is not defensible.

## Phase 3 — Differentiation

> Introduce carefully selected intelligence and convenience features only where they solve validated
> user problems.

Deliberately thin, per [D-003](../decision-log.md): features need a validated problem, not novelty.

**Natural-language search** — "reliable AWD SUV under $30k for winter driving" mapped onto structured
filters. The enum term mapping is a primitive first step in this direction.

**Pricing guidance** — where a listing sits against comparable vehicles. Needs enough inventory
density to be credible; wrong guidance is worse than none.

**Recommendations** — from browsing and favourite behaviour.

**Seller assistance** — description drafting, photo quality feedback, pricing suggestions.

Each should be gated on evidence that the problem is real, and should stay reviewable by humans per
guiding principle 8.

## Phase 4 — Auctions and ecosystem

> Launch the auction application and consider additional services.

### The auction application

Per [D-006](../decision-log.md), a separate application sharing foundational services. The current
architecture was built with this in mind:

| Shared | Status |
| --- | --- |
| Accounts and authentication | Ready — the API is standalone |
| Vehicle data | Ready — listings are already a service |
| Images | Ready once object storage lands |
| Messaging | Threads key on `(listingId, buyerId)`; auction lots would need a generalised subject |
| Notifications | Does not exist yet |

New concerns auctions bring that the marketplace does not have:

- **Timed bidding** with server-authoritative clocks, anti-sniping extensions, and concurrency
  control on bid placement. This is genuinely hard and is the main reason for keeping it separate.
- **Real-time updates** — an auction without live bid updates is not an auction. This is where
  WebSockets become necessary, unlike messaging.
- **Payments, deposits, and settlement.**
- **Legal and licensing requirements**, which vary by province and remain an open question in the HQ
  document.

Open: subdomain versus separate brand and domain.

### Ecosystem

Inspection booking, financing partner connections, transportation quotes, and mobile applications.
Each is primarily a partner integration; the API-first architecture is what makes a mobile client a
matter of calling existing endpoints.

## Technical debt register

Known compromises, with the condition that should trigger revisiting.

| Item | Revisit when |
| --- | --- |
| No caching layer | Search latency becomes noticeable, or database load climbs |
| Facets cost 3 queries per search | Search traffic makes it measurable |
| Images replaced wholesale on update | Listings routinely carry many more images |
| Cascade deletes everywhere | Retention or dispute resolution needs soft deletion |
| No connection pooler | More than a handful of API instances |
| SPA with no server rendering | SEO becomes a real acquisition channel |
| Two test runners | Neither is a real inconvenience — probably never |
| Single `styles.css` | The design surface outgrows one legible file |
| Upload MIME type trusted, not sniffed | Any hardening pass |
| `ADMIN` bypasses all checks | A real permission model is needed |

## Open product questions

Still open from the [HQ document](../atlas-hq.md), and each has architectural consequences:

- **Launch market.** Affects provincial legal requirements and inventory strategy.
- **Strongest reason to choose Atlas.** Should drive Phase 2 prioritisation more than this document
  does.
- **Free versus paid.** Payments infrastructure is a large, unstarted piece of work.
- **Seller verification requirements.** Determines identity-verification integration.
- **Essential messaging capabilities.** Whether attachments and phone reveal are needed.
- **Auction legal rules.** Blocks Phase 4 scoping entirely.
- **Inventory import methods.** Usually the deciding factor in dealer onboarding.
- **MVP success criteria.** Without these, "growth based on real usage" has nothing to measure.
