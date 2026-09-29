# Vintrax — Security, Performance, Reliability and SEO Audit

Scope: the NestJS API (`backend/`), the Next.js web app (`frontend/`), the
Next.js mobile web app (`mobile/`), the shared packages (`packages/`), and the
deployment files (`infrastructure/`, `compose/`, `scripts/`).

Method: I read the code, ran the existing and new test suites, did a
dependency audit and a secret scan, measured the running stack locally
(seeded Postgres and Redis in Docker, API and both Next.js apps as production
builds), and checked the web and mobile apps in a headless Chromium.

The audit made no design changes, framework migrations or API contract changes.
Companion reports:

- [`SECURITY-REPORT.md`](./SECURITY-REPORT.md) covers the fixes, the remaining
  risks, production configuration and secret rotation.
- [`PERFORMANCE-REPORT.md`](./PERFORMANCE-REPORT.md) has the before and after
  measurements.

**Severity scale:**

- **CRITICAL:** exploitable now for account takeover or data loss.
- **HIGH:** a realistic attack or leak of credentials or tokens.
- **MEDIUM:** a weakness that needs other conditions or gives partial impact.
- **LOW:** defence in depth.
- **INFO:** checked and found sound.

**Status labels:**

- **Verified:** a test or measurement shows the fix works.
- **Implemented:** the change is made but only partly exercised.
- **Not implemented:** the change was left out on purpose; the reason is given.

---

## CRITICAL

I found none in the code.

One operational question needs checking on the production server: whether
demo accounts were ever seeded there (see H3).

---

## HIGH

### H1. Sign-in timing reveals which email addresses have accounts

- **Problem:** For an unknown email, login compared the password against a
  "dummy" bcrypt hash so that it would take as long as a real check. That
  literal was 65 characters long, which bcrypt treats as malformed, and bcrypt
  returns immediately for a malformed hash. Measured before the fix: 1 ms
  against the dummy hash, 351 ms against a real cost-12 hash.
- **Location:** `backend/src/modules/auth/auth.service.ts` (`DUMMY_HASH`,
  `login`).
- **Why it matters:** Anyone can list which emails are registered (dealers,
  administrators) by timing `POST /api/auth/login`. That list feeds targeted
  phishing and password spraying.
- **Impact:** Account enumeration at 10 requests per minute per IP, which is
  unlimited across IPs.
- **Recommended fix:** Compare against a real, well-formed hash of a random
  password, computed at the same cost.
- **Risk of fix:** None functionally. It adds one bcrypt hash at startup,
  computed in the background.
- **Implemented?** Verified.
  - `auth.security.spec.ts` asserts that the hash used for an unknown email is
    a well-formed `$2…$12$` hash.
  - Measured after the fix: about 360 ms for unknown emails and about 377 ms
    for an account created at cost 12.

### H2. Production log driver wrote password-reset and verification links to the log

- **Problem:** `MAIL_DRIVER=log` logged the full body of every email.
  `compose/docker-compose.prod.yml` defaults to `${MAIL_DRIVER:-log}`, so a
  deployment that never set SMTP up wrote one-time reset links, which are
  bearer credentials, to the container log.
- **Location:** `backend/src/common/mail/mail.service.ts`.
- **Why it matters:** Anyone who can read logs (operators, log shipping, a
  compromised log store) could reset any user's password, admins included.
- **Impact:** Account takeover through log access.
- **Recommended fix:** In production, never log the body or the recipient.
  Warn at startup and on each send that mail is not being delivered.
- **Risk of fix:** None. Development still prints full messages, so the flows
  stay testable.
- **Implemented?** Verified (`mail.service.spec.ts`).

### H3. The demo seed could load a known admin password into a production database

- **Problem:** `prisma/seed.ts` creates `admin@vintrax.test` and other accounts
  with the password published in this repository. It did not check the
  environment.
  - `scripts/setup-ubuntu.sh` seeds by default. `--no-seed` is opt-in, and the
    script's help says it is the flag to use for a real deployment.
- **Location:** `backend/prisma/seed.ts`, `scripts/setup-ubuntu.sh`.
- **Why it matters:** A server installed with the default flags has a working
  administrator login that anyone can read on GitHub.
- **Impact:** Full administrative takeover, if it happened.
- **Recommended fix:**
  - Refuse to seed when `NODE_ENV=production` unless `ALLOW_DEMO_SEED=true`.
  - Have the setup script pass that flag explicitly and warn.
  - **Check production for `@vintrax.test` accounts and delete them.**
- **Risk of fix:** An operator who deliberately seeds a production-mode demo
  server now has to set a flag. The setup script sets it for them.
- **Implemented?** Implemented. Checking production data needs someone with
  production access.

---

## MEDIUM

### M1. No per-account limit on password guessing

- **Problem:** Sign-in was limited to 10 attempts per minute per IP only. Many
  IPs could guess one account's password without limit.
- **Location:** `auth.controller.ts`, `auth.service.ts`.
- **Why it matters:** Credential stuffing and distributed brute force.
- **Impact:** Weak passwords get compromised.
- **Recommended fix:**
  - Count failures per account (keyed by a SHA-256 of the email) in Redis.
  - After 10 failures in 15 minutes, refuse with 429 until the window passes.
  - Clear the count on a successful sign-in.
  - Fail open when Redis is down.
- **Risk of fix:** An attacker can lock a known account for 15 minutes.
  Password reset still works, and the message says so.
- **Implemented?** Verified (`auth.security.spec.ts`).

### M2. Suspended accounts kept access until their token expired

- **Problem:** Suspension revokes refresh tokens. But the JWT strategy only
  rejected `DEACTIVATED` accounts, and the permissions guard only checks status
  on routes that declare a requirement. A suspended user could keep sending
  messages, editing their profile and so on for up to 15 minutes.
- **Location:** `backend/src/modules/auth/jwt.strategy.ts`.
- **Why it matters:** Moderation takes effect late.
- **Impact:** Limited: at most 15 minutes of continued use.
- **Recommended fix:** Treat `SUSPENDED` like `DEACTIVATED` in the strategy.
  The client then gets a 401, its refresh fails, and it signs out. Public
  routes are unaffected because they treat the user as anonymous.
- **Risk of fix:** Low.
- **Implemented?** Verified: `auth.security.spec.ts` and
  `test/security.api.spec.ts`.

### M3. Uploads trusted the client's declared content type

- **Problem:** `StorageService.upload` picked the stored extension, and so the
  served `Content-Type`, from the multipart `mimetype` alone. The bytes were
  never checked.
- **Location:** `backend/src/common/storage/storage.service.ts`.
- **Why it matters:** An HTML page or script could be stored as `….png` on
  Vintrax's origin. `nosniff` stops browsers rendering it, but the file is still
  hosted and served by Vintrax.
- **Impact:** Hosting of malicious files. Polyglot files could reach other
  consumers.
- **Recommended fix:** Check magic bytes for every allowed type (JPEG, PNG,
  WebP, AVIF, MP4, PDF) before storing.
- **Risk of fix:** A corrupt file that used to be accepted is now refused. That
  is the intent.
- **Implemented?** Verified (`file-signature.spec.ts`).

### M4. FFmpeg read uploaded videos with every demuxer and protocol enabled

- **Problem:** Promo-tile videos are transcoded with `ffmpeg -i <upload>` and
  no whitelists. A crafted upload that ffmpeg reads as an HLS or concat
  playlist can pull other local files, or URLs, into the output video, which
  the site then serves.
- **Location:** `backend/src/common/media/video-processor.ts`.
- **Why it matters:** This is a well-known class of local-file-read and SSRF
  bugs in media pipelines.
- **Impact:** Uploads need `content:manage`, so only admins can reach this.
  Temp files have generated names, and ffmpeg 7 already declines HLS without an
  `.m3u8` extension. So this is defence in depth, but the image's Alpine ffmpeg
  version is not pinned.
- **Recommended fix:** `-protocol_whitelist file -format_whitelist
mov,mp4,m4a,3gp,3g2,mj2,matroska,webm` before `-i`.
- **Risk of fix:** Uploads in other containers (AVI, for example) are refused.
  The UI already asks for MP4, MOV or WebM.
- **Implemented?** Verified.
  - `video-processor.spec.ts` shows MP4, MOV and WebM still transcode.
  - A playlist named `.m3u8` is refused. I also confirmed that the same
    playlist _is_ read without the whitelist.

### M5. The Next.js image optimiser proxied any https image on the internet

- **Problem:** `images.remotePatterns: [{ protocol: 'https', hostname: '**' }]`
  in both apps. Anyone could call `/_next/image?url=https://anything` and make
  the server fetch, decode and resize it.
- **Location:** `frontend/next.config.mjs`, `mobile/next.config.mjs`.
- **Why it matters:** An open image proxy costs CPU and bandwidth, can be used
  to fetch attacker-chosen URLs from the server's network, and abuses Vintrax's
  reputation.
- **Impact:** Resource exhaustion and an SSRF-style fetch primitive (GET only,
  images only).
- **Recommended fix:**
  - Allow no remote hosts.
  - The web app only uses `next/image` for its bundled logo.
  - The mobile app draws absolute-URL photos (S3/CDN) with `unoptimized`. The
    API has already produced sized variants.
- **Risk of fix:** Low. Relative `/uploads/…` images are still optimised.
- **Implemented?** Verified. `/_next/image?url=https://example.com/a.png` now
  returns 400, and the browser check showed mobile pages still render their
  images.

### M6. No security headers on the web and mobile pages

- **Problem:** The API sends helmet headers. The HTML pages from the two Next.js
  apps sent no CSP, no `X-Frame-Options`, no `Permissions-Policy`, and
  advertised `X-Powered-By: Next.js`. The Nginx example added only
  `nosniff` and `Referrer-Policy`, and those were silently dropped in locations
  that set their own `add_header`.
- **Location:** `frontend/next.config.mjs`, `mobile/next.config.mjs`,
  `infrastructure/nginx/vintrax.conf.example`.
- **Why it matters:** Clickjacking of the dealer and admin portals, and no
  limit on where an injected script could load from or send data to.
- **Impact:** Raises the impact of any XSS; clickjacking.
- **Recommended fix:** One header set shared by both apps,
  `packages/shared/next/security-headers.mjs`, containing:
  - a CSP that allows only the origins the apps use: self, Google Maps
    embeds, YouTube no-cookie, https images and media, and the configured
    API/WebSocket origin;
  - `frame-ancestors 'self'` and `X-Frame-Options`;
  - `nosniff`;
  - `Referrer-Policy`;
  - `Permissions-Policy`, with the camera allowed only on mobile, for the
    dealer viewfinder;
  - `COOP`;
  - HSTS in production;
  - `poweredByHeader: false`.

  Remove the duplicate headers from Nginx.

- **Risk of fix:** A CSP can break pages. I checked 11 web pages, both portals
  and 4 mobile pages in Chromium with a `securitypolicyviolation` listener:
  zero violations and zero console errors.
- **Implemented?** Verified.

### M7. A password-reset link could be used twice, and older links stayed valid

- **Problem:** `resetPassword` checked `consumedAt`, then marked the token
  consumed later in a batch transaction, so two concurrent requests with one
  link could both succeed. Requesting a new link did not invalidate earlier
  ones.
- **Location:** `auth.service.ts` (`requestPasswordReset`, `resetPassword`).
- **Why it matters:** A leaked older link (in an inbox, forwarded mail or a
  log) stayed usable for an hour after a newer one was issued.
- **Impact:** Account takeover in narrow circumstances.
- **Recommended fix:**
  - Claim the token with a conditional `updateMany` inside an interactive
    transaction.
  - Supersede outstanding reset links on each new request, as email
    verification already did.
  - Invalidate the account's other reset links once one is used.
- **Risk of fix:** Low.
- **Implemented?** Verified (`auth.security.spec.ts`).

### M8. Vulnerable dependencies

- **Problem:** `pnpm audit` reported 10 moderate advisories:
  - `nodemailer` below 10.0.2: two advisories, a production dependency;
  - `multer` below 2.4.0: DoS through orphaned writes, production;
  - `js-yaml` 5.0–5.4.0: through `@nestjs/swagger`, production;
  - `qs`: through supertest, dev only;
  - `vitest` / `@vitest/mocker`: dev only.
- **Location:** `package.json` overrides, `backend/package.json`,
  `frontend/package.json`, `mobile/package.json`.
- **Why it matters:** Known and published issues.
- **Impact:** DoS against uploads; nodemailer TLS servername reuse and
  recipient-parser bypass.
- **Recommended fix:**
  - `nodemailer` ^10.0.12;
  - overrides: `multer` ^2.4.0, `js-yaml@5` ^5.4.1, `qs` ^6.16.0;
  - `vitest` ^4.1.11.
- **Risk of fix:** These are major version bumps for nodemailer and vitest. The
  backend typechecks, all 662 backend tests pass, and the frontend and mobile
  vitest suites pass on vitest 4.
- **Implemented?** Verified. `pnpm audit` now reports "No known
  vulnerabilities found".

### M9. Access and refresh tokens are kept in `localStorage`

- **Problem:** `packages/client/src/api-client.ts` stores both tokens in
  `window.localStorage`.
- **Why it matters:** Any XSS can read them. A 30-day refresh token is a
  long-lived credential.
- **Impact:** XSS leads to account takeover.
- **Recommended fix:** Move the refresh token to an `HttpOnly; Secure;
SameSite=Strict` cookie scoped to `/api/auth`, and keep the access token in
  memory. That needs CSRF handling for the refresh endpoint and changes to both
  apps and the API contract.
- **Risk of fix:** Medium to high; it touches authentication in every client.
- **Implemented?** Not implemented. It changes the authentication architecture,
  which the brief said to leave unless required. The new CSP reduces the chance
  of exploitation (no external script or connect origins), but it keeps
  `'unsafe-inline'` (see L7). This is the top remaining risk.

### M10. The rate limiter is in memory, per process

- **Problem:** `@nestjs/throttler` uses its default in-memory storage.
- **Why it matters:** Limits reset when the API restarts and are not shared
  between replicas.
- **Impact:** Limits are only as strong as a single instance. Production runs
  one API container today.
- **Recommended fix:** A Redis `ThrottlerStorage` when the API is scaled out.
  The new per-account lockout (M1) is already in Redis.
- **Risk of fix:** Low.
- **Implemented?** Not implemented. The single-replica deployment makes it
  unnecessary for now; this is documented.

---

## LOW

| #   | Problem                                                                                                                                                                                                              | Location                                                              | Fix                                                                                                                                                                                | Implemented?                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| L1  | Inspection reports for vehicles still under review, rejected or withdrawn were readable through the public `GET /inspections/vehicle/:id` and `GET /inspections/:id`. That revealed listings the vehicle page hides. | `inspections.service.ts`                                              | Public only when the report is complete **and** the vehicle is publicly visible. Otherwise only the seller, inspectors and admins can read it.                                     | Verified (`inspections.visibility.spec.ts`)                                                                                 |
| L2  | JWT verification accepted HS256, HS384 and HS512 (the library default).                                                                                                                                              | `jwt.strategy.ts`, `auth.service.ts` (refresh), `auctions.gateway.ts` | Pin `algorithms: ['HS256']`.                                                                                                                                                       | Verified: an HS512 token is refused (`security.api.spec.ts`)                                                                |
| L3  | `CHANGE_ME` placeholder JWT secrets from `.env.production.example` and the Kubernetes example were accepted in production. Only the dev placeholders were refused.                                                   | `config/env.ts`, `main.ts`                                            | Refuse any `change-me` style value in production. Log a warning for secrets under 32 characters rather than refuse them, so an existing deployment keeps booting while it rotates. | Verified (`env.spec.ts`)                                                                                                    |
| L4  | `/health` ran `SELECT 1` with no timeout, so a hung pool hung the probe. The probe also counted against visitors' rate limit.                                                                                        | `health.controller.ts`                                                | 3-second timeout on the DB and search checks; `@SkipThrottle()`.                                                                                                                   | Implemented                                                                                                                 |
| L5  | `POST /auth/refresh` and `/auth/email/verify` only had the global limit of 300 per minute.                                                                                                                           | `auth.controller.ts`                                                  | 30 per minute.                                                                                                                                                                     | Implemented                                                                                                                 |
| L6  | Nginx example: server-level `add_header` lines were lost in `/uploads/` and `/_next/static/`, and duplicated the apps' own headers.                                                                                  | `infrastructure/nginx/vintrax.conf.example`                           | Removed; the apps own their headers.                                                                                                                                               | Implemented                                                                                                                 |
| L7  | The CSP keeps `script-src 'unsafe-inline'`. Next.js writes hydration data inline, and nonces would force every page to render dynamically.                                                                           | `security-headers.mjs`                                                | Documented. Revisit with nonces if static rendering is not needed.                                                                                                                 | Not implemented                                                                                                             |
| L8  | Refresh rotation marks the token revoked in a separate update. Two concurrent refreshes with the same token can both succeed.                                                                                        | `auth.service.ts` (`refresh`)                                         | A conditional update would make the second one fail, but that would sign out users whose tabs refresh at the same moment.                                                          | Not implemented. Documented; low value against a stolen-token scenario because reuse detection still fires on the next use. |
| L9  | Registration answers 409 for an email that already exists.                                                                                                                                                           | `auth.service.ts` (`register`)                                        | Generic response plus an email to the address, which changes the UX.                                                                                                               | Not implemented (UX trade-off)                                                                                              |
| L10 | Seeded demo accounts use bcrypt cost 10, not 12, so their failed sign-ins answer in about 100 ms rather than 360 ms.                                                                                                 | `prisma/seed.ts`                                                      | Demo data only; accounts created through the API use cost 12.                                                                                                                      | Not implemented                                                                                                             |
| L11 | The SMTP transport was created per email, a new TCP and TLS handshake each time.                                                                                                                                     | `mail.service.ts`                                                     | One pooled transport per process.                                                                                                                                                  | Implemented. Not exercised against a real SMTP server here.                                                                 |

---

## INFO (checked, no change needed)

- **RBAC:** `PermissionsGuard` has no admin bypass; `ROLE_PERMISSIONS` is the
  only authority. Registration's schema rejects `role: ADMIN` (tested in
  `security.api.spec.ts`). The role is re-read from the database on every
  request, so a forged `role` claim does nothing (tested).
- **Dealer isolation and IDOR:** these services scope by owner and have
  existing tests:
  - vehicle costs, dealer inventory: `vehicle-costs.api.spec.ts`,
    `dealer-inventory.spec.ts`;
  - vehicles: `vehicles.ownership.spec.ts`;
  - messaging (`assertParticipant`), notifications and addresses.
- **Uploads:**
  - storage keys are fresh UUIDs, and the client filename is discarded;
  - `resolveStored` blocks path traversal;
  - the `documents/` folder is never mounted publicly and is served through an
    access-checked route;
  - sharp re-encodes vehicle photos with a pixel budget (decompression-bomb
    guard);
  - multer allows one file per request with a size cap.
- **CSV:** export escapes formula-leading cells (`= + - @ \t \r`); import has a
  byte cap.
- **Errors:** the global filter returns generic messages; stacks are only
  logged. Swagger is disabled in production.
- **CORS:** an explicit allowlist from `CORS_ORIGINS`, with credentials. The
  WebSocket gateway checks the origin too. Tested: another origin gets no
  `Access-Control-Allow-Origin`, on simple requests and preflights.
- **Docker:**
  - multi-stage builds; `USER node`; healthchecks;
  - production compose binds ports to 127.0.0.1;
  - Postgres and Redis are internal only, and Redis requires a password;
  - migrations run as a one-shot before the API starts.
- **Database indexes:** vehicle search is covered by
  - `status+publishedAt`, `status+priceCad`, `status+make+model`,
    `status+province`;
  - seller-scoped composites;
  - messaging, notifications, auctions and audit log have matching composites.

  No change was needed.

- **Secrets:** no private keys, cloud keys or API tokens in tracked files or in
  git history. Connection strings in the example and CI files are placeholders
  or dev-only values.

---

## Performance and SEO findings

| #   | Severity | Problem                                                                                                                                                                                                                   | Fix                                                                                                                                                                                                                                      | Implemented?                                                                                              |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| P1  | HIGH     | The admin and dealer dashboards shipped recharts (374 KB raw) in their first load.                                                                                                                                        | Charts moved into one `SeriesChart`, loaded with `next/dynamic` into a fixed-height box so layout doesn't shift.                                                                                                                         | Verified: 279→136 kB and 288→168 kB first-load JS; charts render in Chromium                              |
| P2  | HIGH     | `@vintrax/shared` and `@vintrax/client` were not marked side-effect free, so webpack kept every module of the barrel. That put all zod schemas (~79 KB) and the whole shared package (~55 KB) in every page's first load. | `"sideEffects": false` in both packages.                                                                                                                                                                                                 | Verified: first-load JS fell on 45 of 48 web routes (3–51%) and 14 of 16 mobile routes (9–23%); none grew |
| P3  | MEDIUM   | No `robots.txt`, no sitemap, no canonical URLs, no structured data, no `metadataBase` (Open Graph images were relative, which crawlers ignore).                                                                           | `robots.ts`, dynamic `sitemap.ts` (vehicles, dealers, posts, fixed pages), canonical links on vehicle, dealer, post and page routes, schema.org `Car` JSON-LD from real listing data only, and `metadataBase` from `SITE_URL`/`APP_URL`. | Verified in the browser and in `seo.spec.ts`                                                              |
| P4  | LOW      | Blog and page titles doubled the brand ("X — Vintrax · Vintrax") because of the layout's title template.                                                                                                                  | Removed the manual suffix.                                                                                                                                                                                                               | Verified                                                                                                  |
| P5  | LOW      | `/vehicles` and other client-rendered pages use the default site title.                                                                                                                                                   | Would need a server wrapper per page to export metadata.                                                                                                                                                                                 | Not implemented (documented)                                                                              |
| P6  | INFO     | The vehicle page calls `serverFetch` in both `generateMetadata` and the page, which could double-count views.                                                                                                             | Checked: Next memoises the fetch; one page load raised `viewCount` by exactly 1.                                                                                                                                                         | No change                                                                                                 |
| P7  | INFO     | The API has no compression middleware.                                                                                                                                                                                    | Nginx `gzip` (with `gzip_proxied any`) covers `/api` in the deployed topology.                                                                                                                                                           | No change                                                                                                 |

See [`PERFORMANCE-REPORT.md`](./PERFORMANCE-REPORT.md) for all numbers.
