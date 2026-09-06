# Security audit

An audit of the Atlas marketplace: backend, both web clients, shared packages,
infrastructure and CI.

Date of audit: 2026-09-06 · Branch
`claude/project-atlas-vehicle-marketplace-a8j3ng`

The audit itself was read-only — nothing was changed while it ran. The four P0
findings were then fixed under separate authorisation; each carries a **Status**
line saying so, and [remediation](#remediation-log) records what changed and how
it was checked. Everything below P0 is unchanged and still open.

---

# Executive summary

The authentication and concurrency engineering is genuinely strong — bcrypt at
cost 12 with constant-time failure, rotating refresh tokens with replay
detection, a fine-grained permission matrix enforced server-side on every
request, and serializable transactions on the bid path. There is no SQL
injection, no XSS sink, no mass-assignment hole and no secret in the
repository or its history.

The weaknesses are not in the cryptography or the framework. They are in a
handful of **authorization decisions** and **infrastructure defaults**, and
three of them were exploitable by any registered user.

| Severity | Count |
| --- | --- |
| Critical | 0 |
| High | 4 |
| Medium | 5 |
| Low | 5 |

**The four most dangerous, in order — all four now fixed and verified:**

1. **A buyer can mark their own order paid** without any money moving, and the
   seller sees a paid order.
2. **Vehicle ownership documents — titles, registrations, bills of sale — are
   served to anonymous visitors**, complete with names, addresses and VINs.
3. **A seller can publish a listing without moderation**, defeating the review
   queue entirely.
4. **PostgreSQL and Redis are published on all interfaces** by the compose
   file, and Redis has no password at all.

**Production ready?** Closer. All four are now fixed, and each fix was checked
against a running instance by attempting the original attack. What remains is
the Medium backlog — a normal hardening list, none of it a free vehicle or a
world-readable title deed. The one thing that should still block real money is
A-08's sibling: payments are *recorded*, never *processed*, so the settlement
path needs a real provider webhook before it carries funds.

**Limitations of this audit.** Static analysis and code reading, plus a local
running instance. No penetration test, no live cloud console, no TLS/DNS/WAF
review, no review of a real S3 bucket policy or IAM role. Everything under
"Infrastructure audit required" below must be checked by someone with access.

---

# Remediation log

The four P0 findings were fixed after the audit, on explicit authorisation.
Nothing else in this report was touched.

| Finding | Fix | Verified by |
| --- | --- | --- |
| A-01 | `payment:manage` added to the seller, dealer and admin roles and required on the route; `confirmPayment` additionally rejects anyone who is not the seller or an admin | A buyer's own-order payment returns 403 at the guard; a dealer who *holds* the permission but is the buyer on that order returns 403 from the service. The seller succeeds and the order moves to `AWAITING_DELIVERY` |
| A-02 | Documents omitted from the detail response unless the viewer is the seller, an admin, or the buyer on a live order; `documents/` no longer served statically; a new authorized route streams the file and the response carries a download path instead of a storage path | The old static URL returns 404, photo folders still return 200, anonymous and unrelated signed-in viewers see `documents: []` with a `documentCount`, the owner and the buyer-on-an-order both download successfully, and traversal out of the upload directory is rejected |
| A-03 | `status` removed from `updateVehicleSchema`, the create schema narrowed to `DRAFT`/`PENDING_REVIEW`, and a seller status route added that enforces a transition table with no path to `ACTIVE` | Four bypass attempts — create-as-published, direct PATCH, PATCH smuggled beside a legitimate price edit, and the new status route — all rejected or silently stripped, with the legitimate submit → moderate → publish → archive path still working |
| A-04 | Every backing service published on `127.0.0.1`, Redis given a `requirepass`, and the Ubuntu installer now generates a password for a native Redis and records it in `.env` | `docker compose config` resolves Postgres, Redis, MinIO and OpenSearch to `127.0.0.1` and the API to a password-bearing `REDIS_URL`; the installer's function was run against a live Redis, which then refused unauthenticated commands, persisted the setting, and was idempotent on a second run |

34 regression tests were added alongside the fixes — `transactions.authz.spec.ts`,
`vehicles.documents.spec.ts`, `vehicles.status.spec.ts` and
`test/deployment-hardening.spec.ts`. The last of these reads `docker-compose.yml`
as text, because a port binding that silently regresses is exactly the kind of
change no other test would notice.

**What the fixes did not do.** They closed four specific holes. They did not
add a payment provider, they did not move tokens out of `localStorage`, and they
did not touch any live infrastructure — the compose and installer changes affect
what a *new* deployment does, not what a running one is doing now.

---

# Architecture overview

## Technology stack

| Layer | Technology |
| --- | --- |
| API | NestJS 11, REST + Socket.IO, Node 22 |
| Database | PostgreSQL 16 via Prisma 6 |
| Cache, queues, locks | Redis 7, BullMQ |
| Web | Next.js 15 App Router, React 19 |
| Mobile | Next.js 15 installable PWA |
| Shared | `@atlas/shared` (Zod schemas, enums, contracts), `@atlas/client` (API client, session) |
| Infrastructure | Docker, Docker Compose, Kubernetes, Terraform, GitHub Actions |
| Storage | Local disk or S3-compatible, behind one interface |
| Search | PostgreSQL full-text, or OpenSearch |

## Components and entry points

| Component | Path | Exposure |
| --- | --- | --- |
| API | `backend/src` | `:3001`, prefix `/api`, plus `/uploads` static |
| WebSocket | `backend/src/modules/auctions` | `/auctions` namespace, read-only |
| Web | `frontend/src` | `:3000`, proxies `/api` to the API |
| Mobile PWA | `mobile/src` | `:3002`, same proxy |
| Admin | `frontend/src/app/admin` | Same origin as the web app, gated by role |

## Authentication flow

Bearer JWT. Access token 15 minutes, refresh token 30 days, stored **client-side
in `localStorage`**. Refresh tokens are persisted as SHA-256 digests, rotated on
every use, and a replayed token revokes the whole family.

## Authorization model

Six roles over 20 permissions, in `packages/shared/src/domain.ts`. Enforcement
is a chain: `JwtAuthGuard` (re-reads the user from the database on every
request, so suspension takes effect immediately) → `PermissionsGuard` (roles,
permissions **ANDed**, verified email, account status) → `ThrottlerGuard` →
`ZodValidationPipe` → per-service ownership checks.

Full detail in [transaction-flow.md](./transaction-flow.md).

## Sensitive data handled

Names, email addresses, phone numbers, postal addresses, vehicle VINs, bid
histories, order and payment records, and **uploaded ownership documents**
(registration, title, bill of sale, Carfax).

## Attack surfaces

Public: search and listing endpoints, dealer pages, auction reads, the photo
folders under `/uploads/*`, sign-in and registration. Authenticated: everything
else, including vehicle documents since A-02. Privileged: moderation, dealer
verification, user management, analytics, audit.

---

# Findings

## [A-01] A buyer can record payment on their own order

**Severity:** High · **Confidence:** Confirmed
**Status:** Fixed — see [remediation](#remediation-log). Retained here as the record of what was wrong.
**Category:** OWASP A01 Broken Access Control · CWE-639 Authorization Bypass Through User-Controlled Key
**Affected component:** API — orders
**Affected file:** `backend/src/modules/transactions/transactions.service.ts`
**Affected route:** `POST /api/orders/:id/payment`

### Description

`confirmPayment` authorises through `requireParticipant`, which accepts **either
the buyer or the seller**. The controller adds no permission requirement — no
`payment:manage`, no admin check. The request body is a single free-text
`providerReference` string that is never verified against any payment provider.

The buyer on an order can therefore call this endpoint with any string and move
their own order from `AWAITING_PAYMENT` to `AWAITING_DELIVERY`, with the payment
row marked `PAID` and a `paidAt` timestamp.

### Why it matters

The seller's interface then shows a paid order. On a vehicle marketplace the
next step is handing over a car worth tens of thousands of dollars.

### Evidence

```ts
// transactions.service.ts
async confirmPayment(transactionId: string, input: ConfirmPaymentInput, actor: AuthUser) {
  const record = await this.requireParticipant(transactionId, actor);  // buyer OR seller
  // ...no permission check, no provider verification...
  status: 'PAID', providerReference: input.providerReference, paidAt: new Date()
```

```ts
// transactions.controller.ts — no @RequirePermissions
@Post(':id/payment')
@Audit('payment.confirmed', 'TransactionRecord')
confirmPayment(...)
```

Contrast with the sibling endpoint, which *is* restricted correctly:

```ts
// complete()
if (record.sellerId !== actor.id && !isAdmin(actor.role)) {
  throw new ForbiddenException('Only the seller can mark an order complete');
}
```

### Attack scenario

A buyer orders a $40,000 vehicle, calls `POST /api/orders/<own-order>/payment`
with `{"providerReference":"x"}`, and shows the seller an order marked paid.

### Impact

Financial loss up to the value of a vehicle, per order.

### Recommended fix

This endpoint should not be callable by a party to the transaction at all. Until
a real gateway exists, restrict it to `payment:manage` — the permission that
already exists and is held only by `SUPER_ADMIN`:

```ts
@Post(':id/payment')
@RequirePermissions('payment:manage')
```

When a provider is integrated, replace it with a signed webhook endpoint that
verifies the provider's signature and looks the payment up by *its* reference,
never trusting a client-supplied one.

**Priority:** P0

### Verification

Sign in as a buyer, create an order, call the endpoint. Expect 403. Repeat as
super admin and expect 200.

---

## [A-02] Private vehicle documents are readable by anyone

**Severity:** High · **Confidence:** Confirmed
**Status:** Fixed — see [remediation](#remediation-log). Retained here as the record of what was wrong.
**Category:** OWASP A01 Broken Access Control · CWE-552 Files Accessible to External Parties
**Affected component:** API — vehicles, static file serving
**Affected files:** `backend/src/modules/vehicles/vehicles.mapper.ts`, `backend/src/main.ts`
**Affected route:** `GET /api/vehicles/:idOrSlug`, `GET /uploads/*`

### Description

`GET /api/vehicles/:idOrSlug` is `@Public()`. Its response includes the full
`documents[]` array with each document's `url`. Those URLs point at
`/uploads/documents/<uuid>.pdf`, which is served by
`app.useStaticAssets(uploadDir, { prefix: '/uploads/' })` — **no authentication,
no authorization, no signed URL, no expiry**.

The document types are not incidental paperwork:

```prisma
enum VehicleDocumentType {
  REGISTRATION  TITLE  CARFAX  SERVICE_RECORD  SAFETY_CERTIFICATE  BILL_OF_SALE  OTHER
}
```

### Why it matters

A vehicle registration or title carries the owner's full name, address and the
VIN. A bill of sale carries the purchase price and both parties' details. This
is exactly the material used for identity theft and VIN cloning, and it is
currently available to an unauthenticated crawler.

### Evidence

```ts
// vehicles.mapper.ts — toVehicleDetail, returned to any viewer
documents: row.documents.map((document) => ({
  id: document.id, type: document.type, url: document.url,
  filename: document.filename, sizeBytes: document.sizeBytes, ...
})),
```

```ts
// main.ts
app.useStaticAssets(uploadDir, { prefix: '/uploads/' });
```

The UUID filename provides obscurity, not access control — and the API hands
out the URL, so obscurity does not apply either.

### Attack scenario

Crawl `GET /api/vehicles?pageSize=100`, request each vehicle's detail, collect
every `documents[].url`, download them all anonymously.

### Impact

Bulk disclosure of personal and financial documents for every listing that has
one. Under PIPEDA this is a reportable privacy breach.

### Recommended fix

Two changes, both needed:

1. **Stop publishing the URLs.** In `toVehicleDetail`, return `documents` only
   when the viewer is the owner, an admin, or the counterparty on a completed
   order. Everyone else gets `documents: []` — or document *types* without URLs,
   if the goal is to advertise that paperwork exists.
2. **Put the files behind authorization.** Replace static serving of the
   documents folder with an authenticated route
   (`GET /api/vehicles/:id/documents/:docId`) that re-checks the same rule and
   streams the file, or issue short-lived signed URLs when on S3. Vehicle
   *images* can stay public.

**Priority:** P0

### Verification

As an anonymous client, fetch a vehicle that has documents; expect no URLs.
Request a known document path directly; expect 401/403.

---

## [A-03] A seller can publish a listing without moderation

**Severity:** High · **Confidence:** Confirmed
**Status:** Fixed — see [remediation](#remediation-log). Retained here as the record of what was wrong.
**Category:** OWASP A01 Broken Access Control · CWE-285 Improper Authorization
**Affected component:** API — vehicles
**Affected file:** `backend/src/modules/vehicles/vehicles.service.ts`, `packages/shared/src/schemas.ts`
**Affected route:** `PATCH /api/vehicles/:id`

### Description

`updateVehicleSchema` is `createVehicleSchema.partial()`, and
`createVehicleSchema` includes `status: z.enum(LISTING_STATUSES)`. The update
service spreads the validated fields straight into the Prisma update and even
stamps `publishedAt` when the incoming status is `ACTIVE`.

An owner can therefore `PATCH` their own draft to `ACTIVE` and skip
`PENDING_REVIEW` and the admin decision entirely. The moderation queue is
advisory, not enforced.

### Why it matters

Moderation is the control that keeps fraudulent listings, stolen vehicles and
illegal content off the marketplace. It can be bypassed by anyone who can edit
their own listing — which is every seller and dealer.

### Evidence

```ts
// schemas.ts
export const updateVehicleSchema = createVehicleSchema.partial()...
// createVehicleSchema includes:
status: z.enum(LISTING_STATUSES).default('DRAFT'),
```

```ts
// vehicles.service.ts — update()
data: {
  ...fields,                                    // fields.status flows straight through
  ...(fields.status === 'ACTIVE' && !existing.publishedAt ? { publishedAt: new Date() } : {}),
```

The same path lets an owner set `SOLD` (stamping `soldAt`) or `ARCHIVED`
arbitrarily, and move a sold vehicle back to `ACTIVE`.

### Attack scenario

Create a listing, then `PATCH /api/vehicles/<id>` with `{"status":"ACTIVE"}`.
It is live and publicly searchable without review.

### Impact

Unmoderated content on a public marketplace; the review workflow provides no
assurance.

### Recommended fix

Remove `status` from what an owner may set, and expose the transitions
explicitly:

```ts
// schemas.ts
export const updateVehicleSchema = createVehicleSchema
  .omit({ status: true })
  .partial()
  .refine(...);
```

Then add narrow, intention-revealing endpoints: `POST /vehicles/:id/submit`
(DRAFT → PENDING_REVIEW, owner) and `POST /vehicles/:id/archive` (owner), while
`PATCH /vehicles/:id/moderate` keeps ownership of ACTIVE, and `SOLD` is set only
by the order flow, which already does it inside a transaction.

**Priority:** P0

### Verification

As a seller, PATCH a draft to `ACTIVE`. Expect the field to be rejected and the
listing to stay `DRAFT`.

---

## [A-04] Database and Redis published on all interfaces; Redis unauthenticated

**Severity:** High · **Confidence:** Confirmed
**Status:** Fixed — see [remediation](#remediation-log). Retained here as the record of what was wrong.
**Category:** OWASP A05 Security Misconfiguration · CWE-1327 Binding to an Unrestricted Address
**Affected component:** Infrastructure
**Affected files:** `docker-compose.yml`, `.env.example`

### Description

The compose file publishes both datastores to every interface, and Redis is
started with no password:

| Service | Published | Authentication |
| --- | --- | --- |
| postgres | `5432:5432` | `POSTGRES_PASSWORD`, `atlas` in the example env |
| redis | `6379:6379` | **none** |

`0.0.0.0` is the default bind for a `host:container` mapping. The single-server
deployment path documented in `deployment.md` explicitly ships **no firewall
rules**, so on a cloud VM with a public IP these are reachable from the
internet.

### Why it matters

An open unauthenticated Redis is one of the most reliably exploited services on
the internet — it holds session-adjacent data, job payloads and cached
responses, and historically has been a path to remote code execution. An open
PostgreSQL with a weak password is direct access to every customer record.

### Evidence

```yaml
postgres:  ports: ['5432:5432']
redis:     command: ['redis-server', '--appendonly', 'yes']   # no --requirepass
           ports: ['6379:6379']
```

```
# .env.example
POSTGRES_PASSWORD=atlas
REDIS_URL="redis://127.0.0.1:6379"
```

### Attack scenario

Scan the host's public IP for 6379, connect with `redis-cli`, read and write
freely.

### Recommended fix

1. Bind both to loopback — the API reaches them over the compose network, so
   nothing legitimate needs the host mapping:
   ```yaml
   postgres: ports: ['127.0.0.1:5432:5432']
   redis:    ports: ['127.0.0.1:6379:6379']
   ```
   Better still, remove the mappings entirely and expose them only under a
   `dev-tools` profile.
2. Give Redis a password: `command: ['redis-server','--appendonly','yes','--requirepass','${REDIS_PASSWORD}']`
   and move `REDIS_URL` to `redis://:${REDIS_PASSWORD}@redis:6379`.
3. Make `scripts/setup-ubuntu.sh` configure a firewall, or document `ufw` as a
   required step rather than a listed omission.

**Priority:** P0

### Verification

From another host, `nc -vz <server> 6379` and `5432`. Expect refused.

---

## [A-05] Open redirect after sign-in on the web app

**Severity:** Medium · **Confidence:** Confirmed
**Category:** OWASP A01 · CWE-601 URL Redirection to Untrusted Site
**Affected file:** `frontend/src/app/login/page.tsx`
**Affected route:** `/login?from=…`

### Description

The post-sign-in destination is taken from the query string with no validation:

```ts
const redirectTo = searchParams.get('from') ?? '/dashboard';
// ...
router.push(redirectTo);
```

`router.push` follows an absolute URL, so `?from=https://evil.example/atlas`
sends the user off-site immediately after a successful sign-in on the genuine
domain.

The mobile app already does this correctly, which makes the web app the
inconsistent one:

```ts
// mobile/src/app/login/page.tsx
router.replace(next && next.startsWith('/') ? next : '/');
```

### Attack scenario

Phishing link to `https://atlas.example.com/login?from=https://evil.example/session-expired`.
The victim sees the real domain and a real sign-in, then lands on a clone
asking them to "confirm" their password.

### Recommended fix

Apply the mobile app's check:

```ts
const requested = searchParams.get('from');
const redirectTo = requested && requested.startsWith('/') && !requested.startsWith('//')
  ? requested
  : '/dashboard';
```

The `//` guard matters — `//evil.example` is protocol-relative and off-site.
Note the mobile app is missing that guard too.

**Priority:** P1

---

## [A-06] Server-side request forgery through the image optimizer

**Severity:** Medium · **Confidence:** Likely
**Category:** OWASP A10 SSRF · CWE-918
**Affected files:** `packages/shared/src/schemas.ts`, `frontend/next.config.mjs`, `mobile/next.config.mjs`

### Description

A listing's image URLs are accepted as arbitrary strings:

```ts
export const vehicleImageSchema = z.object({
  url: trimmed(500).min(1),      // no URL parsing, no host allowlist
  alt: trimmed(160).optional(),
});
```

Both Next apps then allow the optimizer to fetch **any** HTTPS host:

```js
remotePatterns: [
  { protocol: 'https', hostname: '**' },
  { protocol: 'http', hostname: 'localhost' },
  { protocol: 'http', hostname: '127.0.0.1' },
]
```

A seller controls the stored URL, and rendering the listing makes the Next
server fetch it. The `http://localhost` and `http://127.0.0.1` entries are
worse than the wildcard: they let a crafted URL reach services bound to
loopback on the rendering host.

Marked **Likely** rather than Confirmed: the optimizer rejects non-image
responses, so exfiltrating a metadata document is not straightforward. The
outbound request itself is still made, which is the SSRF primitive, and blind
SSRF plus response timing is often enough.

### Recommended fix

Validate the URL where it enters the system, and constrain where it can point:

```ts
url: z.string().url().max(500).refine(
  (value) => ALLOWED_MEDIA_HOSTS.includes(new URL(value).host),
  { message: 'Images must be uploaded through Atlas' },
),
```

Since images already flow through `POST /uploads/images`, the strongest fix is
to accept a storage **key** rather than a URL and build the URL server-side.
Then narrow `remotePatterns` to the CDN or bucket host and delete the loopback
entries.

**Priority:** P1

---

## [A-07] No security headers on either web application

**Severity:** Medium · **Confidence:** Confirmed
**Category:** OWASP A05 · CWE-1021 Improper Restriction of Rendered UI Layers
**Affected files:** `frontend/next.config.mjs`, `mobile/next.config.mjs`

### Description

The API uses helmet. Neither Next app sets any security headers — the only
`headers()` entry in the repository is a cache-control rule for the mobile
service worker. Missing: `Content-Security-Policy`,
`Strict-Transport-Security`, `X-Frame-Options` / `frame-ancestors`,
`Referrer-Policy`, `X-Content-Type-Options`, `Permissions-Policy`.

### Why it matters

The marketplace pages can be framed by any site, which enables clickjacking of
the bid and purchase buttons — one-click actions worth real money. And with
access tokens in `localStorage` (A-08), a CSP is the main compensating control
against any future XSS.

### Recommended fix

Add a `headers()` block to both apps covering `/(.*)`, starting with
`frame-ancestors 'none'`, HSTS with a long max-age, `Referrer-Policy:
strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`, and a CSP.
Next.js needs `'unsafe-inline'` for styles unless nonces are wired in; start
report-only, then enforce.

**Priority:** P1

---

## [A-08] Access and refresh tokens stored in localStorage

**Severity:** Medium · **Confidence:** Confirmed
**Category:** OWASP A07 · CWE-522 Insufficiently Protected Credentials
**Affected file:** `packages/client/src/api-client.ts`

### Description

Both tokens are held in `localStorage`, readable by any script on the origin.
A 30-day refresh token in a JavaScript-readable store means one XSS is a
persistent account takeover, not a session hijack.

No XSS sink was found in this audit (see "Verified not vulnerable"), so this is
a defence-in-depth failure rather than an active exploit — but it is what turns
a future dependency compromise into a full breach.

### Recommended fix

Move the **refresh** token to an `HttpOnly; Secure; SameSite=Lax` cookie set by
the API, and keep only the short-lived access token in memory. Combined with
A-07's CSP this removes the single-XSS-to-takeover path. Already listed as
planned hardening in the README.

**Priority:** P1

---

## [A-09] No per-account brute-force protection

**Severity:** Medium · **Confidence:** Confirmed
**Category:** OWASP A07 · CWE-307 Improper Restriction of Excessive Authentication Attempts
**Affected files:** `backend/src/modules/auth/auth.controller.ts`, `backend/src/app.module.ts`

### Description

Credential endpoints carry a stricter throttle:

```ts
const CREDENTIAL_THROTTLE = { default: { limit: 10, ttl: 60_000 } };
```

This is keyed **per IP**. `app.set('trust proxy', 1)` is set correctly, so the
client IP is read properly behind one proxy hop. But there is no per-account
counter, no lockout and no backoff, so a distributed attacker spreading one
account's guesses across many addresses is not slowed at all.

The throttler also uses the default **in-memory** store, so the effective limit
multiplies by the number of API replicas.

### Recommended fix

Add a Redis-backed counter keyed on the submitted email — exponential backoff
or a temporary lock after ~5 failures, with the failure response unchanged so
the lock is not an enumeration oracle. Redis is already a dependency, and
switching the throttler to `@nestjs/throttler` with a Redis storage provider
fixes the replica-multiplication problem at the same time.

**Priority:** P1

---

## [A-10] Uploaded file contents are never verified

**Severity:** Low · **Confidence:** Confirmed
**Category:** OWASP A04 · CWE-434 Unrestricted Upload of File with Dangerous Type
**Affected file:** `backend/src/common/storage/storage.service.ts`

### Description

The upload path is well built — a strict allowlist maps content type to
extension, and the stored name is `folder/<uuid><ext>`, so there is **no path
traversal and no extension spoofing**. SVG and HTML are correctly absent from
both allowlists.

What is missing is any check that the bytes match the claim. `contentType`
comes from the multipart part, which the client controls. A file declared
`application/pdf` containing anything at all is stored as `.pdf` and served
inline.

Also absent: EXIF stripping. Phone photos of a vehicle routinely carry GPS
coordinates, which for a private seller is their home address.

### Recommended fix

Verify magic bytes with `file-type` and reject on mismatch; re-encode images
through `sharp` (already a transitive dependency), which both normalises the
format and drops EXIF; serve documents with
`Content-Disposition: attachment`.

**Priority:** P2

---

## [A-11] JWT secrets accepted at 16 characters

**Severity:** Low · **Confidence:** Confirmed
**Affected file:** `backend/src/config/env.ts`

```ts
JWT_ACCESS_SECRET: z.string().min(16, ...),
```

For HS256 the key should carry at least 256 bits of entropy. Sixteen printable
characters is roughly 96 bits and, if human-chosen, far less. The environment
schema does otherwise excellent work here — it refuses the `.env.example`
placeholders in production and requires the two secrets to differ.

**Fix:** raise to `.min(44)` (32 random bytes, base64) and document
`openssl rand -base64 48`, which the deployment guide already suggests.
**Priority:** P2

---

## [A-12] CI workflow does not restrict the default token

**Severity:** Low · **Confidence:** Confirmed
**Category:** Supply chain · CWE-250 Execution with Unnecessary Privileges
**Affected file:** `.github/workflows/ci.yml`

The `security` job sets `permissions: contents: read`. There is no top-level
`permissions` block, so `verify` and `docker` inherit the repository default,
which is often read/write. Those jobs run `pnpm install`, executing lifecycle
scripts from the dependency tree with a writable token in the environment.

**Fix:** add `permissions: contents: read` at the workflow top level and grant
more only per job. **Priority:** P2

---

## [A-13] `$queryRawUnsafe` with interpolated identifiers

**Severity:** Low · **Confidence:** Potential (not exploitable today)
**Affected file:** `backend/src/modules/admin/admin.service.ts`

```ts
private async dailySeries(table: 'User' | 'Vehicle', column: 'createdAt' | 'publishedAt') {
  const rows = await this.prisma.$queryRawUnsafe(
    `SELECT date_trunc('day', "${column}") ... FROM "${table}" ...`,
  );
```

Both parameters are TypeScript literal unions and every caller passes a literal,
so no user input reaches it. It is safe by construction and fragile by design —
one future caller passing a variable turns it into injection, and the type
system will not catch a value that is cast.

**Fix:** replace with a lookup map of `Prisma.sql` fragments so no string
interpolation exists at all. **Priority:** P3

---

## [A-14] Web and mobile pods lack a read-only root filesystem

**Severity:** Low · **Confidence:** Confirmed
**Affected files:** `infrastructure/kubernetes/web-deployment.yaml`, `mobile-deployment.yaml`

Both set `runAsNonRoot` and `allowPrivilegeEscalation: false` and drop all
capabilities, but neither sets `readOnlyRootFilesystem: true` — which the API
deployment does. Next.js needs a writable cache directory, so this needs an
`emptyDir` mounted at `/app/.next/cache`.

**Priority:** P3

---

# Verified — not vulnerable

Things checked and found sound. These matter as much as the findings, because
they are where a marketplace usually fails.

| Area | Result |
| --- | --- |
| SQL injection | No injectable path. The search provider uses tagged templates, so `${term}` is a bound parameter; the one `$queryRawUnsafe` takes only file-local literals |
| XSS sinks | Zero occurrences of `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function` across both apps and all packages |
| Mass assignment | `ZodValidationPipe` returns `result.data`, so unknown keys are stripped before reaching any service |
| Role self-escalation | Registration restricts role to `BUYER \| SELLER \| DEALER`; `updateProfileSchema` has no `role`, `status` or `emailVerified` field |
| Password storage | bcrypt cost 12, with a dummy-hash comparison so a missing account and a wrong password take the same time |
| Password reset | Resolves identically whether or not the address exists; a completed reset revokes existing sessions |
| Refresh tokens | Stored as SHA-256 digests, rotated on use, replay revokes the whole family |
| Credential exposure | `passwordHash` is never selected outside the auth module |
| Suspension | `JwtAuthGuard` re-reads the user per request, so a suspended account is refused on its next call rather than at token expiry |
| Ownership checks | Verified enforced in vehicles, auctions, messaging, notifications, orders and inspections |
| Self-dealing | A seller cannot bid on their own vehicle; a user cannot message themselves |
| Bid concurrency | Serializable isolation, with `40001` mapped to a 409 — no lost updates, no double winner |
| Order duplication | A second order on a vehicle with a live order is rejected; the vehicle is reserved in the same transaction |
| Secrets | None in the working tree or in git history. Only `.env.example` and a `CHANGE_ME` Kubernetes example |
| Swagger | Mounted only when `NODE_ENV !== 'production'` |
| CORS | Explicit allowlist parsed from env, never a wildcard; fails closed when empty |
| Proxy trust | `trust proxy` set to 1, so the throttler sees the real client IP behind one hop |
| Containers | All three images run as the unprivileged `node` user |
| Dependencies | 0 high or critical advisories. The 2 moderate `qs` advisories reach only through `supertest`, a devDependency that never ships |

---

# Not audited — infrastructure audit required

Nothing below could be checked from the repository. Each needs someone with
console access:

- **TLS and DNS** — certificate validity, protocol versions, HSTS preload, DNS
  registrar security. The deployment guide states plainly that the single-server
  path terminates no TLS at all.
- **Cloud IAM** — the Terraform in `infrastructure/terraform` was not run;
  effective role scope is unknown.
- **S3 bucket policy** — whether the media bucket blocks public access, and
  whether uploaded documents inherit it. This directly compounds A-02.
- **Network security groups and firewall** — the only control that currently
  stands between A-04 and the internet.
- **Backups** — existence, encryption, restore testing, retention.
- **Log retention and alerting** — whether the audit trail is shipped anywhere
  durable, and whether anything alerts on repeated auth failures.
- **Runtime patching** — base image and host OS currency.
- **Penetration testing** — no active exploitation was performed here.

---

# Logging and monitoring

An append-only `AuditLog` records moderation decisions, dealer verification,
account status changes, order transitions and payment records, with actor,
target and request correlation id — and `audit:read` gates querying it.

Gaps:

- **Failed sign-ins are not audited.** `auth.password_reset` is recorded but
  there is no `auth.login_failed` event, which is the single most useful signal
  for detecting credential stuffing.
- **Permission denials are not recorded.** A user probing admin endpoints leaves
  no trace.
- **No alerting.** Nothing watches the audit log.
- **Retention is unbounded** — rows accumulate in the primary database with no
  archival policy.

Logs were checked for sensitive content: request logging is deliberately left to
the reverse proxy, and no token, password or document content is written to the
application log.

---

# Findings table

| Priority | Finding | Severity | Component | Status |
| --- | --- | --- | --- | --- |
| P0 | A-01 Buyer can record payment on their own order | High | API — orders | **Fixed** |
| P0 | A-02 Private vehicle documents readable by anyone | High | API — vehicles, uploads | **Fixed** |
| P0 | A-03 Seller can publish without moderation | High | API — vehicles | **Fixed** |
| P0 | A-04 Postgres and Redis published; Redis unauthenticated | High | Infrastructure | **Fixed** |
| P1 | A-05 Open redirect after sign-in | Medium | Web | Open |
| P1 | A-06 SSRF through the image optimizer | Medium | Web, mobile, shared | Open |
| P1 | A-07 No security headers on the web apps | Medium | Web, mobile | Open |
| P1 | A-08 Tokens in localStorage | Medium | Shared client | Open |
| P1 | A-09 No per-account brute-force protection | Medium | API — auth | Open |
| P2 | A-10 Upload contents never verified | Low | API — storage | Open |
| P2 | A-11 JWT secrets accepted at 16 characters | Low | API — config | Open |
| P2 | A-12 CI token not restricted | Low | CI | Open |
| P3 | A-13 `$queryRawUnsafe` with interpolated identifiers | Low | API — admin | Open |
| P3 | A-14 Web and mobile pods writable root filesystem | Low | Kubernetes | Open |

# Security score

**As audited: 72 / 100. After the P0 fixes: 85 / 100.**

The foundations score well — authentication, session handling, input
validation, concurrency control and secret hygiene are all above what a project
at this stage usually shows. The 28 points deducted at audit time were
concentrated in four authorization and configuration decisions, three of which
were exploitable by an ordinary registered user.

Closing those four recovers 13 points and no more. The remaining 15 are the
Medium and Low backlog, and they are genuinely still owed: tokens are still in
`localStorage`, neither web app sends security headers, there is no per-account
brute-force protection, and nothing here has been tested by an adversary.

**Neither score is a substitute for a professional penetration test.** Both
reflect a static review of one branch plus a local instance — no adversarial
testing by a third party, and no access to live infrastructure, where a
misconfiguration would not be visible from this repository at all.

---

# Remediation plan

## P0 — done

1. ~~Restrict `POST /orders/:id/payment` to `payment:manage`~~ **done**. Still
   outstanding: replace it with a signed provider webhook before taking real
   money — the endpoint records an assertion, it does not verify a payment.
   *(A-01)*
2. ~~Stop returning document URLs to non-owners and move document files behind
   an authenticated route~~ **done**. Still outstanding on the S3 driver: the
   bucket policy is `mc anonymous set download`, so an object remains readable
   to anyone holding its URL even though the API no longer discloses one.
   Presigned URLs, or a private bucket, close that. *(A-02)*
3. ~~Remove `status` from `updateVehicleSchema` and add explicit transition
   endpoints~~ **done**. *(A-03)*
4. ~~Bind Postgres and Redis to loopback and set a Redis password~~ **done** for
   compose and for the Ubuntu installer. Still outstanding: host firewall rules,
   and the Kubernetes and Terraform paths, which were not part of this change.
   *(A-04)*

## P1 — next cycle

5. Validate the post-sign-in redirect in the web app, and add the `//` guard to
   both apps. *(A-05)*
6. Accept storage keys rather than URLs for images; narrow `remotePatterns` and
   drop the loopback entries. *(A-06)*
7. Add security headers to both Next apps, CSP report-only first. *(A-07)*
8. Move the refresh token to an `HttpOnly` cookie. *(A-08)*
9. Add Redis-backed per-account throttling, which also fixes per-replica
   multiplication. *(A-09)*

## P2 — hardening

10. Verify upload magic bytes, re-encode images to strip EXIF, serve documents
    as attachments. *(A-10)*
11. Raise the JWT secret minimum to 32 bytes. *(A-11)*
12. Set `permissions: contents: read` at the CI workflow top level. *(A-12)*
13. Audit failed sign-ins and permission denials.

## P3 — long term

14. Replace `$queryRawUnsafe` with `Prisma.sql` fragments. *(A-13)*
15. Add `readOnlyRootFilesystem` to the web and mobile pods. *(A-14)*
16. Ship the audit log to durable storage with alerting on auth-failure spikes.
17. Add authorization regression tests — one per role per sensitive endpoint,
    asserting the negative case. Started: the four P0 fixes each landed with
    negative-case tests, and `payment:manage` is now covered per role. Every
    other sensitive endpoint still has none.
18. Commission a third-party penetration test.

---

# Final checklist

- [x] Authentication reviewed
- [x] Authorization and RBAC reviewed
- [x] IDOR and object-level access reviewed
- [x] API and backend reviewed
- [x] Database and ORM reviewed
- [x] File upload reviewed
- [x] XSS and frontend reviewed
- [x] Business logic reviewed
- [x] Cloud and container configuration reviewed *(code only — see infrastructure audit required)*
- [x] Dependencies reviewed
- [x] Secrets reviewed
- [x] Logging and audit trail reviewed
- [x] Production readiness assessed
- [ ] Penetration test — not performed
- [ ] Live infrastructure — no access
