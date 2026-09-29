# Vintrax — Performance Report

Every number here was measured in this environment:

- a Linux sandbox;
- Postgres 16 and Redis in local Docker containers, holding the seeded demo
  data;
- the API run as `node dist/main.js` (production build, development
  `NODE_ENV`);
- both Next.js apps run as production standalone builds.

Anything not measured is marked **Not measured in this environment**. The
sandbox has no real network, CDN, TLS or production traffic, so absolute
timings are not a forecast of production timings. The before/after
_differences_ are what these numbers show.

"Before" is the branch head before the audit changes (commit `c3b4fb9`).
"After" is the same tree with the audit changes.

## Summary

| Metric                                             | Before                           | After                            | Change         | Notes                                                                |
| -------------------------------------------------- | -------------------------------- | -------------------------------- | -------------- | -------------------------------------------------------------------- |
| Web: total first-load JS, summed over 48 routes    | 8,533 kB                         | 6,979 kB                         | −18%           | `next build` route table (compressed sizes as Next reports them)     |
| Web: home page `/` first-load JS                   | 213 kB                           | 189 kB                           | −11%           |                                                                      |
| Web: `/vehicles` (search) first-load JS            | 187 kB                           | 150 kB                           | −20%           |                                                                      |
| Web: `/vehicles/[slug]` first-load JS              | 176 kB                           | 152 kB                           | −14%           |                                                                      |
| Web: `/dealer/dashboard` first-load JS             | 288 kB                           | 168 kB                           | −42%           | recharts now loads after the page                                    |
| Web: `/admin/dashboard` first-load JS              | 279 kB                           | 136 kB                           | −51%           | recharts now loads after the page                                    |
| Mobile: total first-load JS, summed over 16 routes | 2,579 kB                         | 2,116 kB                         | −18%           |                                                                      |
| Mobile: `/browse` first-load JS                    | 177 kB                           | 142 kB                           | −20%           |                                                                      |
| JS shared by all pages (framework)                 | 102 kB                           | 102 kB                           | 0              | React and Next runtime; unchanged                                    |
| Routes whose first-load JS grew                    | —                                | 0                                | —              | web and mobile                                                       |
| API: median of 10 endpoints                        | see table                        | see table                        | within ±0.7 ms | no API performance change was intended; the differences are noise    |
| Views recorded per vehicle page load               | 1                                | 1                                | —              | checked that metadata and page share one fetch                       |
| Failed sign-in, unknown email                      | ~1 ms bcrypt compare             | ~360 ms end to end               | security fix   | intentional: now as slow as a real account (see the security report) |
| LCP / CLS / INP / TTFB (Core Web Vitals)           | Not measured in this environment | Not measured in this environment | —              | needs a real browser on a real network (Lighthouse or RUM)           |
| Lighthouse score                                   | Not measured in this environment | Not measured in this environment | —              |                                                                      |
| Database query plans under load                    | Not measured in this environment | Not measured in this environment | —              | index review only; see below                                         |
| Docker image sizes                                 | Not measured in this environment | web 328 MB, mobile 322 MB        | —              | after only; see "Docker" below                                       |

## What changed and why

1. **Dashboard charts load on demand.**
   - Recharts (374,668 bytes raw in one chunk) was imported statically by
     `/admin/dashboard` and `/dealer/dashboard`, so it was parsed before the
     dashboard could respond.
   - The four charts now go through one `SeriesChart` component
     (`frontend/src/components/charts/`), loaded with `next/dynamic` into a box
     that already has the chart's height. The numbers render first, the charts
     follow, and nothing below them moves.
   - Checked in Chromium: the dealer dashboard draws its chart and the admin
     dashboard draws both.
2. **The shared packages are tree-shakeable.**
   - `@vintrax/shared` and `@vintrax/client` are resolved from TypeScript source
     through each app's `tsconfig` paths. Neither was marked side-effect free,
     so webpack kept every module their barrel re-exports.
   - The effect: the root layout (every page) carried all zod schemas (the zod
     chunk was 78,982 bytes raw) and the whole shared package (55,050 bytes raw).
   - `"sideEffects": false` in both `package.json` files lets webpack drop the
     modules a page does not use. Neither package has import-time side effects.
     Both apps were checked in the browser with zero console errors.
3. **No image-optimiser round trips for remote images on mobile.** Photos on an
   absolute URL are drawn directly (`unoptimized`); the API has already made
   their sized WebP/AVIF variants. The main reason for this change is security
   (see M5 in the audit).
4. **SEO.** Added:
   - `robots.txt` and `sitemap.xml`, the sitemap listing 30 URLs with the seed
     data;
   - `metadataBase`, so Open Graph image URLs are absolute;
   - canonical URLs;
   - schema.org `Car` JSON-LD on vehicle pages;
   - a fix for the doubled "· Vintrax" in blog and page titles.

   None of this changes how fast a page loads.

## Frontend build (web) — first-load JS per route

From `next build` (Next.js 15.5.25, production), before and after.

| Route                            | Before | After  | Change |
| -------------------------------- | ------ | ------ | ------ |
| `/`                              | 213 kB | 189 kB | -11%   |
| `/_not-found`                    | 102 kB | 102 kB | +0%    |
| `/admin/blog`                    | 175 kB | 138 kB | -21%   |
| `/admin/blog/[slug]`             | 177 kB | 139 kB | -21%   |
| `/admin/blog/new`                | 171 kB | 133 kB | -22%   |
| `/admin/body-types`              | 175 kB | 137 kB | -22%   |
| `/admin/contact`                 | 175 kB | 139 kB | -21%   |
| `/admin/dashboard`               | 279 kB | 136 kB | -51%   |
| `/admin/dealers`                 | 175 kB | 138 kB | -21%   |
| `/admin/footer`                  | 177 kB | 160 kB | -10%   |
| `/admin/home-features`           | 177 kB | 159 kB | -10%   |
| `/admin/make-logos`              | 201 kB | 164 kB | -18%   |
| `/admin/moderation`              | 176 kB | 138 kB | -22%   |
| `/admin/pages`                   | 171 kB | 134 kB | -22%   |
| `/admin/pages/[slug]`            | 177 kB | 139 kB | -21%   |
| `/admin/pages/new`               | 171 kB | 133 kB | -22%   |
| `/admin/partners`                | 175 kB | 137 kB | -22%   |
| `/admin/promo-tiles`             | 177 kB | 160 kB | -10%   |
| `/admin/users`                   | 177 kB | 140 kB | -21%   |
| `/auctions`                      | 177 kB | 139 kB | -21%   |
| `/auctions/[id]`                 | 175 kB | 151 kB | -14%   |
| `/auctions/new`                  | 172 kB | 155 kB | -10%   |
| `/blog`                          | 159 kB | 134 kB | -16%   |
| `/blog/[slug]`                   | 121 kB | 121 kB | +0%    |
| `/compare`                       | 174 kB | 136 kB | -22%   |
| `/contact`                       | 162 kB | 157 kB | -3%    |
| `/dashboard`                     | 178 kB | 141 kB | -21%   |
| `/dashboard/favorites`           | 177 kB | 140 kB | -21%   |
| `/dashboard/messages`            | 171 kB | 134 kB | -22%   |
| `/dashboard/messages/[id]`       | 172 kB | 135 kB | -22%   |
| `/dashboard/my-bids`             | 171 kB | 134 kB | -22%   |
| `/dashboard/notifications`       | 173 kB | 136 kB | -21%   |
| `/dealer/add-vehicle`            | 191 kB | 176 kB | -8%    |
| `/dealer/costs`                  | 184 kB | 168 kB | -9%    |
| `/dealer/costs/[vehicleId]`      | 184 kB | 169 kB | -8%    |
| `/dealer/dashboard`              | 288 kB | 168 kB | -42%   |
| `/dealer/inventory`              | 198 kB | 185 kB | -7%    |
| `/dealer/inventory/[id]`         | 191 kB | 175 kB | -8%    |
| `/dealer/inventory/[id]/sticker` | 170 kB | 135 kB | -21%   |
| `/dealer/inventory/import`       | 182 kB | 169 kB | -7%    |
| `/dealers/[slug]`                | 169 kB | 145 kB | -14%   |
| `/login`                         | 172 kB | 135 kB | -22%   |
| `/pages/[slug]`                  | 121 kB | 121 kB | +0%    |
| `/register`                      | 167 kB | 129 kB | -23%   |
| `/tools/budget`                  | 171 kB | 133 kB | -22%   |
| `/tools/car-value`               | 179 kB | 141 kB | -21%   |
| `/vehicles`                      | 187 kB | 150 kB | -20%   |
| `/vehicles/[slug]`               | 176 kB | 152 kB | -14%   |

## Frontend build (mobile) — first-load JS per route

| Route                   | Before | After  | Change |
| ----------------------- | ------ | ------ | ------ |
| `/`                     | 175 kB | 140 kB | -20%   |
| `/_not-found`           | 103 kB | 103 kB | +0%    |
| `/account`              | 159 kB | 123 kB | -23%   |
| `/account/bids`         | 168 kB | 133 kB | -21%   |
| `/auctions`             | 174 kB | 138 kB | -21%   |
| `/auctions/[id]`        | 171 kB | 148 kB | -13%   |
| `/browse`               | 177 kB | 142 kB | -20%   |
| `/dealer/inventory`     | 174 kB | 139 kB | -20%   |
| `/dealer/inventory/new` | 173 kB | 157 kB | -9%    |
| `/login`                | 162 kB | 126 kB | -22%   |
| `/messages`             | 168 kB | 133 kB | -21%   |
| `/messages/[id]`        | 166 kB | 130 kB | -22%   |
| `/offline`              | 102 kB | 102 kB | +0%    |
| `/register`             | 156 kB | 120 kB | -23%   |
| `/saved`                | 175 kB | 140 kB | -20%   |
| `/vehicles/[slug]`      | 176 kB | 142 kB | -19%   |

## API response times

Method: `scratchpad/api-bench.sh`, one sequential client on the same machine.
For each endpoint, 3 warm-up requests, then the median of 20. Authenticated
endpoints use a dealer token. No API query was changed; this run confirms the
security changes (per-account lockout, stricter JWT checks, health timeouts)
did not slow requests down.

| Endpoint                                       | Before (median) | After (median) | Response size |
| ---------------------------------------------- | --------------- | -------------- | ------------- |
| `GET /api/vehicles` (search, 24 results)       | 14.7 ms         | 14.3 ms        | 17,191 B      |
| `GET /api/vehicles?make=Toyota&sort=PRICE_ASC` | 12.6 ms         | 11.9 ms        | 2,814 B       |
| `GET /api/vehicles/:slug` (detail)             | 9.1 ms          | 8.5 ms         | 3,969 B       |
| `GET /api/home-features`                       | 2.5 ms          | 2.1 ms         | 698 B         |
| `GET /api/admin/footer`                        | 2.4 ms          | 2.4 ms         | 2,209 B       |
| `GET /api/articles/masthead`                   | 2.4 ms          | 2.3 ms         | 449 B         |
| `GET /api/car-value/makes`                     | 2.3 ms          | 2.2 ms         | 367 B         |
| `GET /api/dealer/inventory` (auth, 20 rows)    | 11.2 ms         | 11.6 ms        | 12,717 B      |
| `GET /api/dealer/inventory/stats` (auth)       | 6.6 ms          | 6.7 ms         | 309 B         |
| `GET /api/auth/me` (auth)                      | 6.1 ms          | 5.5 ms         | 700 B         |

Throughput under concurrent load: **Not measured in this environment.**

## Database

Indexes were reviewed against the queries the hot paths run:

- search by status with date, price, make/model or province;
- seller-scoped inventory;
- conversation and message pages;
- notifications, auctions and bids;
- the audit log.

Every one has a composite index that leads with its filter columns, so no
migration was added. `EXPLAIN ANALYZE` under production-sized data: **Not
measured in this environment.** The seed has only a few dozen vehicles, and
Postgres picks sequential scans at that size whatever indexes exist.

## Caching

Unchanged and checked:

- vehicle photos are served `public, max-age=31536000, immutable` (UUID keys);
- `/_next/static` is immutable;
- `sw.js` is `no-cache`;
- other uploads are private and cached for 1 h in the Nginx example.

Redis caches the read-mostly settings endpoints.

## Docker

- The **web** and **mobile** images built successfully with the audit changes.
  The builds used sandbox-only copies of the Dockerfiles that add this
  sandbox's proxy CA certificate; nothing in the repository was changed for
  this. Sizes as built: web 328 MB, mobile 322 MB. Before-audit sizes were not
  built, so there is no comparison.
- I ran the web image against the local API:
  - home and vehicle pages returned 200;
  - the security headers, `robots.txt` and the canonical link were present;
  - the production CSP carried `connect-src 'self'`;
  - Docker reported the container `healthy`.
- The **API** image compiled through its dependency and build stages. The final
  `apk add ffmpeg` step failed because this sandbox's network policy blocks the
  Alpine package mirror (HTTP 403). That is an environment limit, not a code
  problem; CI builds the image with normal network access.

## Recommended next measurements (production)

1. Run Lighthouse (mobile preset) on `/`, `/vehicles`, one vehicle page and the
   dealer inventory. Record LCP, CLS, INP and TBT before and after deploying
   this change.
2. Turn on real-user monitoring for Core Web Vitals, for example
   `useReportWebVitals` posting to an endpoint you already log.
3. Run `EXPLAIN (ANALYZE, BUFFERS)` on vehicle search with production data,
   including keyword search.
4. Load-test `GET /api/vehicles` and the vehicle page at the concurrency you
   expect. The in-memory throttler (300 requests per minute per IP) will limit
   a single-IP load generator, so allowlist it or raise the limit for the test.
