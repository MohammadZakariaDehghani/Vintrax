# Frontend

Next.js 15 App Router application for buyers, sellers, dealers, inspectors and
administrators.

- **Stack:** Next.js 15 · React 19 · TypeScript · Tailwind · TanStack Query ·
  Zustand · socket.io-client · Recharts
- **Rendering:** server components for public pages, client components for
  anything interactive

## Pages

### Public

| Route | Rendering | Purpose |
| --- | --- | --- |
| `/` | Server | Hero search, closing-soon auctions, recent inventory |
| `/vehicles` | Client | Search with filters, facets, sorting, pagination |
| `/vehicles/[slug]` | Server | Vehicle detail, gallery, inspection report, contact |
| `/auctions` | Client | Auction browse with live countdowns |
| `/auctions/[id]` | Client | Live auction room with real-time bidding |
| `/dealers/[slug]` | Server | Dealership profile and its published inventory |
| `/login`, `/register` | Client | Authentication |

### Buyer

`/dashboard` · `/dashboard/favorites` · `/dashboard/my-bids` ·
`/dashboard/purchases` · `/dashboard/purchases/[id]` (one order) ·
`/dashboard/messages` · `/dashboard/messages/[id]` (a thread) ·
`/dashboard/notifications`

### Dealer and seller

`/dealer/dashboard` (analytics) · `/dealer/inventory` (management) ·
`/dealer/inventory/[id]` (edit) · `/dealer/add-vehicle` ·
`/auctions/new` (schedule an auction)

Every one of these is reachable from the header or from a page that links to
it, and a test asserts that the reverse also holds — that no link in the app
points at a route that does not exist. Six did, once.

### Administration

| Route | Purpose |
| --- | --- |
| `/admin/dashboard` | Platform metrics, charts and the audit trail |
| `/admin/moderation` | The review queue — approve and publish, or send back with a reason |
| `/admin/dealers` | Dealer verification — grant or withdraw the verified badge |
| `/admin/users` | Search accounts, suspend, reinstate, deactivate |
| `/admin/revenue` | GMV, platform revenue, effective take rate, sales over time |

Every tile on the overview links to one of these, or to the marketplace and
auction pages the number describes. A count an administrator is meant to act on
is a dead end without a destination, and the two that had none — pending
dealers and listings awaiting review — were exactly the two that needed acting
on. `AdminNav` sits on all five screens so moving between them does not route
through the overview.

Approving is the only way a listing reaches `ACTIVE`; a seller cannot publish
their own.

## Two kinds of state

Keeping these separate removes most of the complexity a marketplace UI would
otherwise accumulate.

**Server state → TanStack Query.** Anything owned by the API is cached and never
copied into component state. Mutations invalidate the affected keys and the UI
re-renders from fresh data. Keys are hierarchical (`['vehicles']`,
`['vehicle', id]`, `['auction', id]`), so invalidation can be broad or narrow —
favouriting invalidates `['vehicles']` and every vehicle view refreshes at once.

No retry on 4xx: retrying a validation error or a 403 just repeats the same
rejection.

**URL state → the router.** All browse filters live in the query string.
`/vehicles?fuelType=ELECTRIC&sort=PRICE_ASC` fully describes what the user is
looking at, so a search is shareable, survives reload and works with the back
button. `lib/search-params.ts` is the only place that translates between the two
representations, and the round trip is covered by tests because a lossy
conversion would silently drop a filter.

**Session state → Zustand.** The session is read from deep in the tree — navbar,
route guards, bid forms — so a store avoids threading a provider value through
all of them.

Local component state is reserved for genuinely ephemeral things: text in a
search box before submission, which gallery thumbnail is selected.

## The API client

`lib/api-client.ts` is a thin fetch wrapper doing four jobs:

1. **Token attachment** from `localStorage`.
2. **Transparent refresh** — on a 401 it refreshes and retries once, so callers
   never see expiry.
3. **Deduplicated refresh** — concurrent 401s share one in-flight promise.
   Without this, three parallel requests would each rotate the refresh token and
   the losers would present a revoked one, tripping the server's replay
   detection and logging the user out.
4. **Structured errors** — failures become an `ApiError` carrying `status`, the
   `details` map and the `requestId`, so forms render messages next to the right
   inputs.

`serverFetch` is the server-component counterpart; it addresses the API by
absolute origin, because a server component cannot read `localStorage`.

## Live auctions

The auction room subscribes to a per-auction socket.io room for price updates,
with a 20-second poll as a backstop so a dropped socket degrades freshness
rather than freezing the page. The connection state is shown to the user.

**The socket is read-only.** Bids are placed over HTTP so they get the same
validation, rate limiting, auditing and serializable transaction as every other
write, through one code path rather than two.

The countdown recomputes from the server-supplied `endsAt` on every tick rather
than decrementing a local counter — a client with a wrong clock, or a
backgrounded tab that browsers throttle, would otherwise drift out of step with
the auction it is displaying. It announces to screen readers only in the final
minutes; a per-second live region would make the page unusable.

> **WebSockets do not pass through Next's rewrite proxy** — the upgrade
> handshake is not forwarded — so `NEXT_PUBLIC_WS_URL` points at the API origin
> directly, and that origin must appear in the API's `CORS_ORIGINS`.

## Design system

Colours are CSS custom properties consumed through `hsl(var(--token))`. Dark
mode is a token swap on the `html` element, so component classes never need a
`dark:` variant for colour, and a price cannot lose contrast because an override
lost on source order.

Component primitives live in `components/ui/index.tsx`: `Button`, `Card`,
`Badge`, `Input`, `Select`, `Textarea`, `Field`, `Spinner`, `EmptyState`,
`ErrorAlert`, `Skeleton`, `Pagination`.

`CardTitle` accepts an `as` prop. It defaults to `h3` because a card is usually a
subsection, but pages where the card carries the page's subject pass `as="h1"`
so the document keeps one top-level heading.

## Accessibility

- Skip link to `#main`; visible focus rings via `:focus-visible`
- Filter groups are `fieldset`/`legend`; every input has a real label
- Favourite buttons use `aria-pressed` and name the vehicle
- Result counts are `aria-live="polite"`; countdowns announce only when urgent
- Errors carry `role="alert"`; invalid inputs get `aria-invalid`
- `prefers-reduced-motion` disables animation
- Verified at 390px with no horizontal overflow, filters collapsed so results
  lead the page

## Testing

```bash
pnpm --filter @atlas/frontend test      # unit
pnpm --filter @atlas/frontend test:e2e  # Playwright
```

Unit tests cover `lib/` — URL round-tripping and display formatting, including
the countdown boundaries and acronym casing that look broken to a user when
wrong.
