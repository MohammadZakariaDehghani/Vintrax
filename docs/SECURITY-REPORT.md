# Vintrax — Security Report

This report accompanies [`SECURITY-PERFORMANCE-AUDIT.md`](./SECURITY-PERFORMANCE-AUDIT.md),
which has each finding in full: problem, location, impact, fix and risk. This
report covers what was fixed, what was not, what the production environment has
to provide, which secrets to rotate, and how everything was tested.

It contains no secrets. Where a value would appear, a placeholder or category
stands in for it.

**Status labels used below:**

- **Verified:** a test or measurement in this environment shows the behaviour.
- **Implemented:** the change is made, but only partly exercised here.
- **Requires production validation:** only someone with access to the live
  system can confirm it.

## 1. Vulnerabilities found and fixed

| ID  | Severity | Vulnerability                                                                                                                                                                 | Fix                                                                                       | Status                                                   |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| H1  | HIGH     | Sign-in timing revealed which emails have accounts. The dummy bcrypt hash was malformed, so an unknown email answered in about 1 ms, against about 350 ms for a real account. | A real cost-12 hash of a random password, computed at startup                             | Verified (test and timing)                               |
| H2  | HIGH     | `MAIL_DRIVER=log` (the compose default) wrote password-reset and verification links to production logs                                                                        | Bodies and recipients are never logged in production; a startup warning is logged         | Verified (test)                                          |
| H3  | HIGH     | The demo seed (admin account with a password published in this repository) could run against a production database                                                            | The seed refuses `NODE_ENV=production` unless `ALLOW_DEMO_SEED=true`                      | Implemented; **requires production validation** (see §5) |
| M1  | MEDIUM   | No per-account brute-force limit, only per IP                                                                                                                                 | 10 failures in 15 min lock sign-in for that account (Redis, keyed by a hash of the email) | Verified (test)                                          |
| M2  | MEDIUM   | A suspended account's access token kept working on routes that ask for no permission                                                                                          | The JWT strategy returns 401 for `SUSPENDED`                                              | Verified (tests)                                         |
| M3  | MEDIUM   | The upload type was taken from the client's header; bytes were never checked                                                                                                  | Magic-byte check for JPEG, PNG, WebP, AVIF, MP4 and PDF                                   | Verified (tests)                                         |
| M4  | MEDIUM   | FFmpeg read uploads with every demuxer and protocol (HLS/concat local-file-read class)                                                                                        | `-protocol_whitelist file -format_whitelist mov,mp4,…,matroska,webm`                      | Verified (test with a real ffmpeg)                       |
| M5  | MEDIUM   | `/_next/image` fetched and resized images from any https host                                                                                                                 | No remote hosts allowed; absolute-URL photos drawn unoptimised                            | Verified (400 for a foreign URL)                         |
| M6  | MEDIUM   | No CSP, frame protection or Permissions-Policy on web and mobile pages; `X-Powered-By` sent                                                                                   | Shared header set (`packages/shared/next/security-headers.mjs`); Nginx duplicates removed | Verified (browser, 0 CSP violations)                     |
| M7  | MEDIUM   | A reset link could be used twice concurrently; older links stayed valid                                                                                                       | Atomic claim; new links supersede old ones; using one link kills the rest                 | Verified (test)                                          |
| M8  | MEDIUM   | 10 moderate advisories (nodemailer, multer, js-yaml, qs, vitest)                                                                                                              | Upgrades and overrides                                                                    | Verified (`pnpm audit`: 0)                               |
| L1  | LOW      | Inspection reports readable for vehicles not publicly listed                                                                                                                  | Public only when the vehicle is public                                                    | Verified (test)                                          |
| L2  | LOW      | JWT accepted HS384 and HS512 as well as HS256                                                                                                                                 | Pinned to HS256 (HTTP, refresh, WebSocket)                                                | Verified (test)                                          |
| L3  | LOW      | `CHANGE_ME` JWT secrets accepted in production                                                                                                                                | Refused; secrets under 32 characters produce a warning                                    | Verified (test)                                          |
| L4  | LOW      | `/health` had no DB timeout and counted against the rate limit                                                                                                                | 3 s timeout; `@SkipThrottle`                                                              | Implemented                                              |
| L5  | LOW      | `/auth/refresh` and `/auth/email/verify` only had the global limit                                                                                                            | 30 per minute                                                                             | Implemented                                              |
| L6  | LOW      | The Nginx example's security headers were lost in some locations and duplicated in others                                                                                     | Removed; the apps set their own                                                           | Implemented                                              |

## 2. Findings not fixed, and why

| ID  | Severity | Finding                                                          | Why not now                                                                                                                                                                       | Mitigation in place                                                                                                   |
| --- | -------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| M9  | MEDIUM   | Access and refresh tokens are stored in `localStorage`           | Moving them to `HttpOnly` cookies changes the authentication architecture of the API and both apps, and adds CSRF handling. The brief was to keep authentication unless required. | The CSP now blocks script and connection origins other than the app's own; refresh tokens rotate with reuse detection |
| M10 | MEDIUM   | The rate limiter is in memory, per process                       | Production runs one API replica; a Redis store is needed only when scaling out                                                                                                    | The per-account lockout (M1) is in Redis already                                                                      |
| L7  | LOW      | The CSP allows `'unsafe-inline'` scripts                         | Next.js inlines hydration data; nonces would force dynamic rendering of every page                                                                                                | The other CSP directives still apply                                                                                  |
| L8  | LOW      | Two simultaneous refreshes with one token can both succeed       | Making the second fail would sign out users whose tabs refresh at once                                                                                                            | Reuse after rotation still revokes the whole token family                                                             |
| L9  | LOW      | Registration answers 409 when an email already exists            | Changing it means a new "check your email" flow (UX change)                                                                                                                       | Registration is throttled to 10 per minute per IP                                                                     |
| L10 | LOW      | Seeded demo accounts use bcrypt cost 10, so their timing differs | Demo data only                                                                                                                                                                    | API-created accounts use cost 12                                                                                      |

## 3. Remaining risks

1. **XSS still means account takeover** because tokens are in `localStorage`
   (M9). The React code base has no `dangerouslySetInnerHTML` apart from the new
   JSON-LD block, which is escaped and tested, and no `eval`. Admin-entered link
   URLs are validated against `javascript:`. So the exposure is small, but one
   bug would be severe.
2. **Rate limits are per process** (M10). Behind more than one API replica they
   multiply.
3. **`trust proxy` is set to 1 hop.** If a second proxy or a CDN is put in front
   of Nginx, per-IP limits will see the CDN's address. `trust proxy` must be
   raised to match, or the CDN's client-IP header used.
4. **The locking in M1 can be used to annoy a known user.** Someone who knows an
   email can keep that account from signing in, 15 minutes at a time. Password
   reset still works.
5. **No malware scanning of uploads.** Images and videos are re-encoded, which
   neutralises most payloads. PDFs (vehicle documents) are stored as uploaded
   and only served to the owner or an admin, with `nosniff` and their real
   content type.
6. **CSP `img-src` and `media-src` allow any https origin**, because the S3/CDN
   host is deployment configuration. If it is fixed, narrow them to it.

## 4. Production configuration checklist

Environment for the API:

| Variable                                  | Required value                                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                | `production`                                                                                                                                      |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Two different values, each from `openssl rand -base64 48` (the API refuses placeholders and warns under 32 characters)                            |
| `MAIL_DRIVER`                             | `smtp`, with `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`. With `log`, no email is sent: the API warns, and password reset cannot work. |
| `APP_URL`                                 | The public https origin of the web app. It is also passed to the web container as `SITE_URL` for canonical links and the sitemap.                 |
| `CORS_ORIGINS`                            | Exactly the web and mobile https origins, and nothing else                                                                                        |
| `REDIS_URL`                               | With a password (compose already sets `requirepass`). Redis now also holds the login-failure counters.                                            |
| `STORAGE_DRIVER`                          | `s3` if running more than one API replica or on ephemeral disks                                                                                   |
| `ALLOW_DEMO_SEED`                         | Unset                                                                                                                                             |

At the edge (Nginx):

- TLS via certbot, then uncomment the HTTPS redirect.
- HSTS is now sent by both apps and the API. Only add `preload` once every
  subdomain is on HTTPS.
- Keep `client_max_body_size 16m` and `X-Forwarded-For` forwarding.
- Do **not** add security headers in Nginx; the apps send them.

Build arguments for the web and mobile images:

- `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` should stay same-origin
  (`/api`, empty). If they point at another origin, that origin is added to the
  CSP's `connect-src` at build time.

## 5. Actions for the operator (requires production access)

1. **Check for demo accounts.** Run
   `SELECT email, role FROM "User" WHERE email LIKE '%@vintrax.test';`
   If any exist in production, delete them or at least reset their passwords,
   and check the audit log (`AuditLog`) for actions by them.
2. **Check the mail driver.** If production ever ran with `MAIL_DRIVER=log`,
   treat the container logs as holding live reset tokens:
   - Purge or restrict the logs.
   - Consider forcing password resets for accounts that asked for one in that
     period. Tokens expire after 1 hour, so only logs read soon after were
     exploitable.
3. **Check the JWT secrets.** Confirm both are generated values of at least 32
   characters. The API now logs a warning at startup if not.

## 6. Secrets that need rotating

The audit found **no real secret committed** to the repository or its history.
It scanned tracked files and the full git log for:

- private keys;
- AWS access keys;
- GitHub, Slack, Google and Anthropic API tokens;
- credentialed database and Redis URLs.

Every hit was a placeholder (`CHANGE_ME`, `${…}` interpolation), a development
default in an example file, or an obviously fake test value. So nothing _must_
be rotated because of the repository.

Rotate these secret categories if the matching condition applies:

| Secret category                | Rotate if                                                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| JWT access and refresh secrets | Shorter than 32 characters, ever shared outside the server, or production ever ran the example values                              |
| Demo account passwords         | Demo accounts exist in production (§5.1)                                                                                           |
| SMTP credentials               | They were ever placed in a file that is committed or shipped in an image                                                           |
| Database and Redis passwords   | Production uses the development defaults from `.env.example` or `docker-compose.yml`                                               |
| S3 access keys                 | Shared with anything other than the API                                                                                            |
| AI provider key (`AI_API_KEY`) | It was ever set in a build argument, where it would be baked into an image layer; it belongs only in the API's runtime environment |

## 7. Testing performed

### Automated

All commands below were run in this environment. Each result is its final state.

| Command                                     | Result                                                                                                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint` (all packages)                  | Pass                                                                                                                                                       |
| `pnpm typecheck` (all packages)             | Pass                                                                                                                                                       |
| `FFMPEG_PATH=… pnpm test`                   | Pass: backend 662 tests in 47 suites; web 227 in 28 files; mobile 37 in 6 files                                                                            |
| `pnpm audit`                                | No known vulnerabilities                                                                                                                                   |
| `next build` (web and mobile)               | Pass                                                                                                                                                       |
| `nest build` (API)                          | Pass                                                                                                                                                       |
| Prettier check on changed files             | Pass. `pnpm-lock.yaml` is not Prettier-formatted, and the same is true on `main`.                                                                          |
| Secret scan (tracked files and git history) | No real secrets                                                                                                                                            |
| `docker build` web and mobile images        | Pass. Run with sandbox-only proxy settings; the repository Dockerfiles are unchanged.                                                                      |
| `docker build` API image                    | Compiled through all build stages. The final `apk add ffmpeg` was blocked by the sandbox network (HTTP 403 from the Alpine mirror). **Not verified here.** |
| Web image run                               | Home and vehicle page 200, headers present, Docker health `healthy`                                                                                        |

One note on the backend suite: `promo-video-uploads.api.spec.ts` failed once
during a full parallel run and passed on every rerun, alone and in the suite.
It encodes real video with ffmpeg, so it is sensitive to CPU contention. It is
recorded here rather than hidden. Nothing in this change touches it.

### New security tests

`backend/test/security.api.spec.ts` runs over HTTP with the real guards in
AppModule's order. It checks that:

- a protected route refuses a request with no token (401);
- a valid HS256 token is accepted;
- tokens are refused when they:
  - are signed with another secret;
  - use `alg: none`;
  - use HS512;
  - have expired;
  - belong to a suspended account;
- a bad token on a public route is treated as anonymous;
- admin routes refuse buyers and dealers, and dealer routes refuse buyers;
- a forged `role` claim is ignored;
- registration refuses `role: ADMIN`;
- the 11th sign-in attempt in a minute from one IP gets 429 with
  `Retry-After`;
- CORS works for the allowed origin, and refuses other origins on both simple
  and preflight requests.

`backend/src/modules/auth/auth.security.spec.ts` covers:

- the dummy hash is well-formed;
- lockout after 10 failures, and reset of the count on success;
- no plaintext email in Redis;
- reset tokens stored only as digests;
- single use under concurrency;
- older reset links superseded;
- sessions revoked on reset;
- no disclosure for unknown emails;
- the JWT strategy's handling of `ACTIVE`, `SUSPENDED` and `DEACTIVATED`.

The other new spec files:

- `backend/src/common/storage/file-signature.spec.ts`: magic bytes for each
  type, and HTML, SVG or EXE refused under an image or PDF type.
- `backend/src/common/media/video-processor.spec.ts`: whitelist arguments, and
  a real `.m3u8` playlist refused.
- `backend/src/modules/inspections/inspections.visibility.spec.ts`: public,
  owner, admin and inspector access to reports for each vehicle status.
- `backend/src/common/mail/mail.service.spec.ts`: no tokens or addresses in
  production logs.
- `backend/src/config/env.spec.ts`: placeholder secrets refused in production
  only.
- `frontend/src/lib/seo.spec.ts`: robots rules, which do not block
  `/dealers/…`; structured data; JSON-LD escaping.

These existing tests already cover dealer isolation, IDOR and admin actions:

- `vehicle-costs.api.spec.ts`
- `dealer-inventory.spec.ts`
- `vehicles.ownership.spec.ts`
- `users.admin.spec.ts`
- `admin-page-sizes.spec.ts` (pagination limits)

### Manual and browser checks (Chromium)

- Web: `/`, `/vehicles`, a vehicle page, `/contact` (Google Maps iframe),
  `/blog`, `/tools/car-value` and a dealer page.
- Dealer: sign-in, then dashboard (chart rendered), inventory, add-vehicle.
- Admin: sign-in, then dashboard (both charts rendered).
- Mobile: `/`, `/browse`, a vehicle page, `/login`.
- Result: **0 console errors and 0 CSP violations**, observed with a
  `securitypolicyviolation` listener.
- One vehicle page load raised its `viewCount` by exactly 1.
- Failed sign-in timing: about 360 ms for unknown emails and about 377 ms for
  a cost-12 account.

### Not tested here

- Real SMTP delivery through the new pooled transport.
- S3 storage.
- Behaviour behind a real TLS-terminating Nginx or a CDN.
- Multiple API replicas.
- Load, penetration testing by a third party, and mobile Safari.
