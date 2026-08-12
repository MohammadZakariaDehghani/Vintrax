# Web app architecture

How `apps/web` is structured, how it manages state, and the conventions worth knowing before
changing it.

## Structure

```
apps/web/src/
├── main.tsx                  Entry: QueryClient, Router, AuthProvider
├── App.tsx                   Route table and the RequireAuth gate
├── styles.css                Design tokens and all component styles
├── auth/
│   └── auth-context.tsx      Session state, login/register/logout
├── lib/
│   ├── api-client.ts         Fetch wrapper, token storage, refresh handling
│   ├── format.ts             Currency, distance, dates, enum labels
│   ├── search-params.ts      URL ⇄ filter object translation
│   └── use-media-query.ts    Reactive breakpoint hook
├── components/
│   ├── Layout.tsx            Header, nav, unread badge, footer
│   ├── ListingCard.tsx       Result card with favourite toggle
│   ├── FilterPanel.tsx       Search filter sidebar
│   └── ui.tsx                Spinner, EmptyState, ErrorAlert, Field, Badge, Pagination
└── pages/
    ├── HomePage.tsx
    ├── SearchPage.tsx
    ├── ListingDetailPage.tsx
    ├── AuthPages.tsx         Login and Register
    ├── DashboardPage.tsx     Seller listing management
    ├── ListingFormPage.tsx   Create and edit
    ├── FavouritesPage.tsx
    └── MessagesPages.tsx     Inbox and thread
```

## Two kinds of state

The app deliberately keeps these separate, which removes most of the state-management complexity a
marketplace UI would otherwise accumulate.

### Server state → TanStack Query

Anything owned by the API — listings, conversations, the user record — is cached by TanStack Query
and never copied into component state. Mutations invalidate the affected query keys and the UI
re-renders from fresh data.

Query keys follow a hierarchy so invalidation can be broad or narrow:

| Key | Covers |
| --- | --- |
| `['listings']` | Every listing query |
| `['listings', 'search', <query string>]` | One search result page |
| `['listings', 'featured']` | Home page carousel |
| `['listing', id]` | One listing's detail |
| `['my-listings', status, page]` | Dashboard tabs |
| `['favourites', page]` | Saved listings |
| `['conversations']` | Inbox |
| `['conversation', id]` | One thread |
| `['unread-count']` | Navbar badge |

Invalidating `['listings']` refreshes every listing view at once, which is what favouriting does.

Defaults set in `main.tsx`: 30 second stale time, no refetch on window focus, and **no retry on 4xx**
— retrying a validation error or a 403 just repeats the same rejection.

### URL state → React Router

All search filters live in the query string, not in component state. `/listings?fuelType=ELECTRIC&sort=PRICE_ASC`
fully describes what the user is looking at.

This is a deliberate design choice with real consequences: a search is **shareable**, **survives
reload**, and **works with the browser back button** — all of which a marketplace needs and none of
which come free with `useState`.

`lib/search-params.ts` is the only place that translates between the two representations:

- `parseFilters(URLSearchParams)` → filter object, applying defaults and rejecting invalid values
- `filtersToParams(filters)` → `URLSearchParams`, **omitting defaults** so shared URLs stay short
- `filtersToApiQuery(filters, pageSize)` → the query string sent to the API

The round trip is covered by tests, since a lossy conversion would silently drop filters.

Local component state is reserved for genuinely ephemeral things: the text in a search box before
submission, which gallery thumbnail is selected, whether a delete confirmation is showing.

## The API client

`lib/api-client.ts` is a thin `fetch` wrapper doing four jobs.

**Token attachment.** Reads the access token from `localStorage` and sets the bearer header.

**Transparent refresh.** On a 401 with a refresh token present, it refreshes and retries the original
request once. Callers never see the expiry.

**Deduplicated refresh.** Concurrent 401s share one in-flight refresh promise:

```ts
inFlightRefresh ??= (async () => { /* ... */ })();
```

Without this, three parallel requests failing together would each rotate the refresh token, and the
last two would present an already-revoked token — triggering the replay detection described in the
[security model](./security.md#refresh-token-rotation) and logging the user out.

**Structured errors.** Failures become an `ApiError` carrying `status` and the `details` map, so
forms can render messages next to the right inputs:

```tsx
<Field label="Email" htmlFor="email" error={apiError?.fieldError('email')}>
```

When refresh fails outright, the client calls a session-expired handler that the auth context
registers — the client cannot import React state, so this callback is the seam between them.

## Authentication flow

`AuthProvider` owns the session:

1. On mount, if an access token exists, it calls `GET /auth/me` to restore the session. `isLoading`
   stays true until this settles.
2. `login` and `register` store the returned tokens and invalidate all queries, since anonymous
   cached responses (missing favourite flags) are now stale.
3. `logout` best-effort revokes the refresh token server-side, then clears tokens and the query cache
   regardless of the response.

`RequireAuth` in `App.tsx` **waits for `isLoading` to settle before deciding**. Without that, a page
refresh on a protected route would bounce a signed-in user to the login page before the session was
restored. It preserves the attempted path in router state so login can return the user there.

`sellersOnly` routes render an explanatory panel rather than redirecting, because a buyer landing on
`/dashboard` benefits from knowing *why* they cannot list a vehicle.

## Styling

A single hand-written `styles.css` with CSS custom properties. No framework — the dependency and
build surface stays minimal, and the whole visual system is one file to edit.

### Token layering

```
:root                                  Light theme tokens
@media (prefers-color-scheme: dark)    Dark theme token overrides ONLY
… component rules …
@media (prefers-color-scheme: dark)    Dark component overrides (MUST be last)
```

**The ordering is load-bearing.** Dark-mode rules that target the same single-class selectors as
component rules only win on source order, so they live at the end of the file. An early attempt put
them near the top and prices rendered near-invisible in dark mode — dark navy on a dark surface.

Where a colour differs between themes, prefer a **semantic token** over a component override:

```css
:root { --price-color: var(--brand-900); }
@media (prefers-color-scheme: dark) { :root { --price-color: #7db3ea; } }
.listing-price { color: var(--price-color); }
```

Tokens are immune to ordering problems. Reach for a late override only when the property is not a
colour, such as the skeleton gradient.

### Responsive approach

Layout differences belong in CSS. The exception is when the **component tree** should differ, which
is what `use-media-query.ts` is for.

The search page uses it: below 900px the filter sidebar becomes a collapsed disclosure behind a
"Show filters" button. Rendering the full panel and merely restyling it would push the first vehicle
below roughly 24 checkboxes on a phone — results have to lead the page.

## Accessibility

Not exhaustive, but deliberate:

- A skip link to `#main`.
- Visible focus rings on every interactive element via `:focus-visible`.
- Filter groups are `<fieldset>`/`<legend>`; every input has a real `<label>`, visually hidden where
  the design has no room.
- The favourite button uses `aria-pressed` and a label naming the vehicle, so it is not an unlabelled
  heart to a screen reader.
- Result counts are `aria-live="polite"`, announcing filter changes.
- Errors carry `role="alert"`; invalid inputs get `aria-invalid`.
- `prefers-reduced-motion` disables animation and transitions.
- Dashboard status tabs use `role="tablist"` with `aria-selected`.

## Build

Vite with the React plugin.

```ts
resolve: {
  alias: { '@atlas/shared': '../../packages/shared/src/index.ts' },
}
```

**`@atlas/shared` resolves to TypeScript source, not its compiled output.** The first version used
`optimizeDeps.include` to pre-bundle the linked package, which caches it once — edits to the shared
contracts were then served stale until the cache was manually cleared. Aliasing to source removes
that class of bug entirely and gives correct HMR. `tsconfig.json` mirrors the alias in `paths` so
typechecking reads the same files.

The dev server proxies `/api` and `/uploads` to the API, keeping the browser on one origin so image
URLs resolve without rewriting and CORS is not exercised in development.

## Conventions

- **Named exports** everywhere; no default exports.
- **Pages own data fetching**; presentational components take props. `ListingCard` is the deliberate
  exception — it owns its favourite mutation so every listing grid gets the behaviour for free.
- **Format at the edge.** Currency, distances, and dates are formatted only at render, via
  `lib/format.ts`. Raw numbers flow through the app.
- **Enum labels come from `@atlas/shared`**, not local maps, so "Certified pre-owned" reads
  identically everywhere.
- **Optional fields are omitted, not blanked.** Sending `""` for an optional string fails a
  `min(1)` check; the forms strip empties before submitting.
