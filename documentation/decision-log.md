# Project Atlas Decision Log

## Purpose

This document records significant product, business, architecture, and operating decisions for Project Atlas. Each decision receives a permanent identifier so future documents and discussions can reference it without reopening the full history.

## Decision Status

Accepted means the decision is currently authoritative. A decision may later be superseded, but its original record should remain in this log.

## D-001 — Internal Codename: Project Atlas

**Status:** Accepted

**Decision:** The internal codename for the project is Project Atlas.

**Rationale:** A stable codename gives the project a consistent identity during discovery, planning, design, and development before a final public brand is selected.

**Consequences:** Internal documents, folders, planning discussions, and early technical references should use Project Atlas unless a later decision replaces it. The codename is not assumed to be the final customer-facing brand.

## D-002 — Develop and Release the Product in Phases

**Status:** Accepted

**Decision:** Project Atlas will be planned, built, tested, and released in deliberate phases rather than attempting to launch the entire long-term vision at once.

**Rationale:** A phased approach reduces technical and financial risk, limits feature creep, allows earlier validation with real users, and creates opportunities to adjust priorities based on evidence.

**Consequences:** Each phase must have a defined purpose, scope, success criteria, and exit conditions. Features that do not support the current phase should normally remain outside its implementation scope.

## D-003 — Build a Better Marketplace, Not an AutoTrader Clone

**Status:** Accepted

**Decision:** Project Atlas may study and learn from AutoTrader and other established marketplaces, but it will not reproduce any competitor feature for feature.

**Rationale:** Copying an incumbent would inherit its complexity and weaknesses without creating a compelling reason for users to switch. Atlas should preserve familiar marketplace patterns where they help users while improving problems that are poorly solved today.

**Consequences:** Competitor features are inputs to research, not automatic requirements. New features must be justified by a real user problem, strategic advantage, legal requirement, or operational need.

## D-004 — Support Dealerships and Private Sellers

**Status:** Accepted

**Decision:** The long-term marketplace will support both professional dealerships and ordinary private vehicle sellers.

**Rationale:** Buyers benefit from broader inventory, while the two seller groups create complementary supply. Supporting both also positions Atlas as a complete vehicle marketplace rather than a dealer-only advertising platform.

**Consequences:** Product requirements, account models, listing workflows, pricing, verification, moderation, analytics, and support processes must recognize that dealerships and private sellers have different needs. The exact phase in which private sellers enter the public product remains an open scope decision.

## D-005 — Messaging Is a Core Marketplace Capability

**Status:** Accepted

**Decision:** Buyers should be able to message sellers directly from vehicle listings, and messaging should be treated as a foundational marketplace capability rather than an optional add-on.

**Rationale:** Many buyers hesitate to make an immediate phone call. Messaging lowers the barrier to first contact, keeps conversations connected to listings, and creates a more natural path from browsing to inquiry.

**Consequences:** Buyer accounts will generally be required so conversations can be saved, synchronized, protected from abuse, and connected to marketplace features. The first version should favour reliable asynchronous messaging over a complex real-time chat system.

## D-006 — Auctions Will Be a Separate Application with Shared Foundations

**Status:** Accepted

**Decision:** Vehicle auctions will be developed as a separate application rather than being mixed directly into the initial marketplace experience. The auction and marketplace products should share foundational platform services where practical.

**Rationale:** Marketplace browsing and timed bidding are different user experiences with different legal, operational, payment, trust, and technical requirements. Separating them keeps each product clearer while avoiding unnecessary duplication behind the scenes.

**Consequences:** Auctions are outside the initial marketplace MVP. Future architecture should allow shared accounts, vehicle data, images, notifications, permissions, and potentially messaging. The public domain and branding structure for the auction product remains undecided.

---

The decisions below were made while implementing the Phase 1 marketplace MVP. D-001 to D-006 are product and direction decisions; these are technical decisions that constrain how the product is built.

## D-007 — Monorepo with a Shared Contract Package

**Status:** Accepted

**Decision:** The marketplace web application, the API, and a shared contract package live in one pnpm workspace. The shared package holds the domain vocabulary, request validation schemas, and response types, and is imported by both applications.

**Rationale:** The API and the web app must agree on the shape of every request and response. Expressing that agreement once, as code both sides compile against, turns a contract mismatch into a build failure instead of a runtime bug found by a user. A monorepo makes a contract change and its two consumers a single reviewable commit.

**Consequences:** A change to a shared enum must be made in the shared package and the database schema together, with a migration, or the API will accept values the database rejects. Both applications are versioned and released together. Splitting an application out later means publishing the shared package to a registry.

## D-008 — Standalone REST API Rather Than a Full-Stack Framework

**Status:** Accepted

**Decision:** Business logic and persistence live in a standalone REST API. The web application is a client of that API and holds no business rules.

**Rationale:** [D-006](#d-006--auctions-will-be-a-separate-application-with-shared-foundations) commits to an auction application sharing accounts, vehicle data, images, and potentially messaging, and the roadmap anticipates mobile clients. Logic embedded in a web framework's server routes has to be extracted before a second product can consume it, and extraction under deadline pressure is where shortcuts get taken.

**Consequences:** More initial setup than a single full-stack application, and the marketplace forgoes server-side rendering, which has a real cost for search-engine visibility on listing pages. A second client is a matter of calling existing endpoints. Server rendering should be revisited when organic search becomes a measured acquisition channel rather than an assumption.

## D-009 — PostgreSQL with Prisma

**Status:** Accepted

**Decision:** PostgreSQL 16 is the datastore, accessed through Prisma.

**Rationale:** The domain is relational — listings belong to sellers, conversations join buyers to listings, favourites join users to listings — and search filters across many dimensions simultaneously, which relational indexing handles well. PostgreSQL additionally offers native full-text search, which is the intended path for real search relevance without adding a separate search service. Prisma derives static types from the schema, so a query returns a type containing exactly the fields selected.

**Consequences:** Schema changes require reviewed migrations. Prisma's abstraction limits control over generated SQL, so performance-critical paths such as relevance ranking will need raw queries. Full-text search work is deferred rather than designed around a search engine.

## D-010 — Store Money as Integer Canadian Dollars

**Status:** Accepted

**Decision:** Vehicle prices are stored as an integer number of whole Canadian dollars.

**Rationale:** Floating-point representation accumulates rounding error and is unsuitable for money. Vehicle prices in this marketplace have no sub-dollar component, so whole dollars lose no information while keeping arithmetic and comparison exact.

**Consequences:** Any future requirement for sub-dollar amounts — fees, taxes, instalment calculations — needs a migration to a decimal type rather than a change in application code. Formatting to currency happens only at the display layer.

## D-011 — JWT Access Tokens with Rotating, Hashed Refresh Tokens

**Status:** Accepted

**Decision:** Authentication uses short-lived JWT access tokens and long-lived refresh tokens signed with a separate secret. Refresh tokens are stored as SHA-256 digests, are rotated on every use, and presenting an already-revoked token revokes every token for that user.

**Rationale:** Short access tokens limit the window a leaked token is useful. Rotation means a stolen refresh token can only be used until the legitimate client next refreshes, at which point the reuse is detected. Storing a digest means a database leak yields nothing replayable; an unsalted digest is used rather than a password hash because the token is already high-entropy and the stored value must remain directly queryable for revocation.

**Consequences:** Every refresh writes to the database. Concurrent refreshes must be deduplicated client-side or a client will trigger its own replay detection and sign itself out. Tokens are currently held in browser local storage, which is vulnerable to cross-site scripting; moving refresh tokens to `HttpOnly` cookies is planned hardening.

## D-012 — Unpublished Listings Return 404, Not 403

**Status:** Accepted

**Decision:** A listing that is not publicly visible returns 404 to anyone other than its owner or an administrator, rather than 403.

**Rationale:** A 403 confirms that a resource exists. Iterating identifiers against a marketplace would let a competitor map unreleased inventory and infer a dealer's pipeline. Returning 404 makes an unpublished listing indistinguishable from one that never existed.

**Consequences:** Applies to drafts and archived listings. The same reasoning drives the identical error message for an unknown email and a wrong password at login. Genuine 404s and permission failures are indistinguishable in logs, so debugging access issues relies on server-side logging rather than the response.

## D-013 — One Conversation per Buyer per Listing

**Status:** Accepted

**Decision:** A buyer has exactly one message thread per listing, enforced by a database constraint. Messaging the same listing again continues the existing thread. The seller is always derived from the listing, never supplied by the client.

**Rationale:** Fragmenting a negotiation across several threads loses history for both parties and makes an inbox unusable. Deriving the recipient from the listing prevents a caller addressing arbitrary accounts, which would turn the marketplace into a spam relay.

**Consequences:** A buyer cannot deliberately start a second, separate conversation about the same vehicle. The conversation model is keyed to marketplace listings, so reusing it for auction lots will require generalising the subject of a thread.

## D-014 — Asynchronous Messaging Before Real-Time

**Status:** Accepted

**Decision:** The first messaging implementation is request-response with periodic polling for unread counts, not a real-time transport.

**Rationale:** This implements [D-005](#d-005--messaging-is-a-core-marketplace-capability), which favours reliable asynchronous messaging over a complex live-chat system in the first version. Polling requires no additional infrastructure, no connection-state handling, and no sticky sessions, and matches how buyers and sellers actually use marketplace messaging — replies arrive in hours, not seconds.

**Consequences:** A new message may take up to a minute to surface. Polling cost grows with concurrent signed-in users and will eventually justify a push transport. Auctions are expected to need genuine real-time updates regardless, so that infrastructure will likely arrive with Phase 4 and could then be adopted by messaging.

## D-015 — Auctions Are Built Into the Platform, Superseding D-006

**Status:** Accepted

**Supersedes:** [D-006](#d-006--auctions-will-be-a-separate-application-with-shared-foundations)

**Decision:** Vehicle auctions are implemented inside the Atlas platform rather than as a separate application. Auction listings, bidding, settlement and live updates share the same API, database, accounts and notification infrastructure as the fixed-price marketplace.

**Rationale:** D-006 separated auctions to keep each product clear and to avoid entangling different legal, payment and trust requirements. That reasoning still holds in principle, but the platform owner directed that auctions form part of the single product. Building them in one codebase removes the account, inventory and messaging duplication that a separate application would have required, and a vehicle can move between fixed-price and auction sale channels without being re-created.

**Consequences:** Vehicles carry a `saleChannel`, and `IN_AUCTION` is a listing status rather than a separate entity type, so a vehicle has one identity across both ways of selling. The auction-specific concerns D-006 warned about are now internal boundaries instead of application boundaries: bidding runs in its own module with its own concurrency model, and settlement shares the transaction and payment records used by direct purchases. The legal, deposit and dispute questions the HQ document raises for auctions remain open and are now questions for this platform rather than a future one. If auctions later need to diverge — a separate brand, different jurisdictions, distinct compliance — the module boundary is the seam to extract along.

## D-016 — Search and Storage Behind Provider Interfaces

**Status:** Accepted

**Decision:** Vehicle search and file storage are accessed through provider interfaces with more than one implementation, selected by environment variable. Search defaults to PostgreSQL full-text; storage defaults to the local filesystem. OpenSearch and S3-compatible object storage are the production implementations.

**Rationale:** Requiring a search cluster and an object store to run the platform makes local development heavy, makes continuous integration slow and fragile, and couples every developer to infrastructure they do not need. PostgreSQL full-text search with `ts_rank` and trigram fallback is genuinely good at the catalogue sizes this platform will see for some time, so the simple path is also a legitimate production option rather than a toy.

**Consequences:** The platform boots with only PostgreSQL and Redis. Adding a search cluster is a configuration change, not a code change, and the OpenSearch provider falls back to PostgreSQL when the cluster is unreachable, so a search outage degrades relevance rather than breaking browse. The cost is that two search implementations must be kept behaviourally consistent, and the interface constrains both to what each can express. The same reasoning applies to background jobs, which have a Redis-backed and an in-process driver, and to email.

## D-017 — The Dependency Audit Is the Security Gate; Scanning Reports

**Status:** Accepted

**Decision:** Continuous integration fails on a high or critical dependency advisory, and advisories in transitive packages are resolved by pinning the patched version in the `pnpm.overrides` block of the root `package.json`. The Trivy filesystem scan for vulnerabilities, secrets and misconfiguration runs alongside it but does not fail the build; its report is kept as a build artifact. Trivy is invoked from its published container image at a pinned version rather than through a marketplace action.

**Rationale:** A gate is only useful if a red build means something specific and actionable. `pnpm audit` produces exactly that: a named package, a vulnerable range and a patched range, which an override fixes in one line. Trivy's misconfiguration rules cover the deployment manifests, where a finding is often a deliberate trade-off rather than a defect, so treating every one of them as a build failure would train people to ignore the job. Findings would ideally go to code scanning, but SARIF upload requires GitHub Advanced Security, which this repository does not have — an artifact keeps them retrievable without pretending the integration exists. Pinning the scanner image rather than an action removes a dependency on a wrapper's release tags, which is what broke this job originally.

**Consequences:** Every override is technical debt with a visible expiry: it exists because a parent package has not yet released a fix, and it should be removed when it does, otherwise the pin silently holds a dependency back. Trivy findings need someone to read them, since nothing forces the issue. The scanner version is explicit in the workflow and must be bumped deliberately, which is the intent — a scanner that changes underneath the build makes failures hard to attribute.

## D-018 — A Single-Server Install Path Alongside the Container Path

**Status:** Accepted

**Decision:** Atlas ships `scripts/setup-ubuntu.sh`, which provisions an Ubuntu machine directly — Node, pnpm, PostgreSQL, Redis, the database, environment files, migrations, an optional seed, a build, and either a foreground run or systemd units. It stands beside the Docker, Compose and Kubernetes artefacts rather than replacing them.

**Rationale:** The container path assumes a working Docker daemon, a registry, and someone who knows both. That is the right target for a real deployment and the wrong first step for evaluating the platform, onboarding a developer, or standing up a demo on a virtual machine. Two paths also cost less than they appear to: the script drives the same `pnpm` scripts and the same migrations that CI and the images use, so it exercises the ordinary path rather than inventing a parallel one. Writing it also surfaced a genuine defect — the documented setup could not run migrations, because the Prisma CLI reads `.env` from `backend/` and the repository keeps it at the root.

**Consequences:** The script must be updated whenever setup changes shape — a new service dependency, a new environment variable, a new build step — or it silently produces a half-configured machine, which is worse than no script. It is deliberately not a hardened deployment: no TLS, no reverse proxy, no firewall, no dedicated service account, and one machine only, all stated in the deployment guide so nobody mistakes it for a production baseline. Generated secrets and an existing `.env` are treated as sacred: re-running never rotates the JWT secrets, because that would sign every issued token out. `backend/.env` is now a symlink to the root `.env`, so there is one file to edit rather than two that drift.

## D-019 — Atlas Mobile Is a Separate Application Over a Shared Client

**Status:** Accepted

**Decision:** The mobile experience is a separate workspace application, `mobile/`, built on the same stack as the web app and consuming the same API. The behaviour both clients must agree on — the API client, token refresh, session store, auction socket protocol and display formatting — moves into `packages/client`, which both import. No backend, database, schema or authentication change was made.

**Rationale:** The web application is already responsive and usable on a phone, so the case for a second application is not "it does not fit" but "it is not designed for a thumb". A bidder standing on a lot needs the price, the countdown and a bid button without pinching; a dealer photographing a trade-in needs the camera two taps from the home screen; both need targets a thumb hits while walking. Retrofitting that onto a layout designed for a cursor would have meant either compromising the desktop experience or scattering breakpoint-specific branches through it. The shared package is what keeps the cost honest: the parts where two implementations could silently disagree — when a session ends, what a 409 means, what a price looks like — exist once.

**Consequences:** A third application to build, test and deploy, on its own port and behind its own host, because a PWA's service worker cannot claim a scope above its own path. Anything in `packages/client` now has two consumers, so a change there has to be checked against both — the web app's existing tests exercise it through that app's own import paths, which is the guard. The mobile app deliberately does not cover every screen the web app has: administration, moderation and inspection authoring stay on the desktop, where they belong. Offline support stops at an application shell; there is no write queue, because a bid replayed silently minutes later is worse than one that visibly failed.

## D-020 — Navy Carries the Interface; Red Is Reserved

**Status:** Accepted

**Supersedes:** the blue-and-amber palette used before the brand lockup existed.

**Decision:** The palette follows the Atlas lockup: navy for actions, links and headers; red as a brand accent; the lockup's grey for secondary text. Red is not used for buttons or for the auction price flash, and `--destructive` is a darker, less saturated red than the brand red.

**Rationale:** The brand red and the colour of a rejected bid are both red, and they meet on the one screen where the distinction matters most — a live auction, where "your bid failed" has to be unmistakable within a second. Separating them by hue alone would be wishful thinking at a glance, on a phone, outdoors. So they are separated by role instead: the interface has no red controls at all, which means a red element is never something to click and is almost always something to read. The price flash moved to amber for the same reason, having previously sat two elements above a red rejection message.

**Consequences:** Red appears sparingly — the mark, the live-auction badge, the rule beneath the hero — which is roughly the proportion it occupies in the lockup, and that restraint is load-bearing rather than aesthetic. Anyone adding a red control reintroduces the ambiguity, so the rule is written into the brand document. Error states must continue to pair colour with an icon and explicit wording; colour is never the only signal. The mark's colours are fixed hex rather than theme tokens, because tokens swap in dark mode and an inverted mark stops matching the app icon.

## D-021 — Bilingual Interface, Unilingual Listings

**Status:** Accepted

**Decision:** The web application ships English and French. The locale lives in a cookie, so server-rendered pages and client components resolve the same language. Interface copy is translated; listings, descriptions and messages written by sellers are not.

**Rationale:** A Canadian marketplace that only speaks English excludes a fifth of the country, and the lockup already says *Canada's auto marketplace*. The cookie is what makes it work rather than half-work: the home and listing pages are server components, and a locale the server could not read would leave those pages in English while the header around them switched to French — worse than not translating at all. Seller-written content is left alone deliberately. Machine-translating a description of a vehicle's condition creates a liability where a mistranslated "no frame damage" is a legal problem, not a cosmetic one.

**Consequences:** Adding a string means adding it in both languages; the dictionary's French type is derived from the English object, so a missing key fails the build rather than surfacing an English word mid-sentence. Reading a cookie opts those routes out of static rendering, which costs nothing here because they already fetch live inventory uncached. Language is not in the URL, so the two versions are not separately addressable or separately indexable — a real cost for search visibility, and the thing to change first if organic search in French matters. A third language is a third dictionary and no new machinery.

## D-022 — Authorization Is Decided by the Service, Not by the Schema

**Status:** Accepted

**Decision:** Three of the four high findings in the [security audit](./security-audit.md) shared one root cause, and are fixed the same way. A permission on the route is a floor, never the whole rule: `POST /orders/:id/payment` requires `payment:manage` *and* that the caller is the seller on that order. A field the caller must not control is removed from the schema rather than ignored in the handler, and the schema is strict so that sending it anyway is refused rather than dropped: `updateVehicleSchema` omits `status` and rejects it by name, and status moves through `PATCH /vehicles/:id/status` against an explicit transition table. Data whose audience is narrower than its parent resource is withheld by default: `toVehicleDetail` returns no documents unless a caller passes `includeDocuments`, and the value is computed from who is asking.

**Rationale:** Each of the three had a correct sibling a few lines away — `complete()` checked the seller, `moderate` was properly gated, images really are public — so the failure was not ignorance of the rule but the absence of a place that forces it to be stated. Zod strips unknown keys, which makes the schema the real authority over what a handler can write, and `data: { ...fields }` turns every accepted key into a writable one; a comment saying "sellers should not set status" would not have survived. Defaulting document visibility to false means a new call site that forgets the question leaks nothing, and the compiler asks the question at every call.

**Consequences:** Silently discarding input is not a safe default — Zod strips unknown keys, so the first cut of this left an edit form whose status dropdown reported a successful save and changed nothing, and the dealer inventory's Publish button posting to an endpoint that no longer accepted it. Both were found by clicking, not by a test. Anywhere a field is removed for a security reason, the schema is now strict so the refusal is visible. Route guards and service checks also overlap deliberately, and the overlap is the point: a dealer holding `payment:manage` who is the buyer on an order is refused by the second check, not the first. Publication has exactly one door, so a seller-facing "publish" button is not implementable without moderation, which is intended. `VehicleDetail` gained `documentCount` so a page can say paperwork exists without disclosing it, and document links became fetches with an `Authorization` header rather than `<a href>`, since the bytes are no longer a static file. Each fix landed with a negative-case test; the wider goal in [future work](./reference/future-work.md) — one such test per role per sensitive endpoint — is still mostly unmet.

## D-023 — Marketplace Conventions, Atlas's Own Identity

**Status:** Accepted

**Decision:** The buying surface — the home page and search results — follows the layout and interaction conventions of large vehicle marketplaces: a short hero whose purpose is a make/model/budget/province search rather than a picture, body-type entry points carrying live inventory counts, and results as dense horizontal rows with a persistent filter rail, a result count, sort, and a list/grid toggle. The palette, mark and wording stay Atlas's own. No competitor's colours, typography or copy are reproduced.

**Rationale:** Asked to make Atlas look exactly like a named competitor, the layout half of that request is the half worth having and is free to take: a photo on the left, the deciding facts in the middle, price on the right is a convention because it works, not because anyone owns it — it fits eight vehicles on a screen instead of three and puts the same field at the same horizontal position on every row, which is what makes a column scannable. The visual identity half is the opposite: it is the part that is legally theirs, it would make Atlas read as a clone in a market where its pitch is independent inspections and live auctions, and it would discard [D-020](#d-020--navy-carries-the-interface-red-is-reserved) a week after it was made. [D-003](#d-003--build-a-better-marketplace-not-an-autotrader-clone) already said this.

**Consequences:** The hero search is an elevated card overlapping the band rather than sitting inside it, so the first thing on the page is a control. Its tabs are Atlas's own cuts — all vehicles, buy now, auctions, inspected — not the vehicle categories the reference uses, because Atlas does not sell boats and a tab leading nowhere is worse than no tab. Its submit button carries the live result count, which is the one idea here worth taking wholesale: it turns narrowing a search from guessing into choosing, and says "No matches" before the click rather than after. Body-type shortcuts were drawn as SVG silhouettes rather than photographs, and where the reference shows manufacturer logos Atlas showed make names as text chips; both were overcautious and are superseded by [D-024](#d-024--real-photographs-from-real-inventory-real-marks-for-real-makes). Search results default to rows; the card grid survives behind a toggle for people shopping on looks, remembered per browser in `localStorage`. Listings now show a financing estimate, which is how buyers actually compare, so the assumptions — 72 months at 7.99%, nothing down, taxes extra — live in one exported constant next to the calculation and are printed beside every figure rather than buried. The hero shrank from 24rem to about 12, which is the change that puts inventory above the fold. Every hero field maps to a filter the API already supports; there is no postal-code box, because distance search does not exist and a control that silently does nothing is worse than its absence.

## D-024 — Real Photographs from Real Inventory, Real Marks for Real Makes

**Status:** Accepted. Supersedes two consequences of [D-023](#d-023--marketplace-conventions-atlass-own-identity).

**Decision:** The body-type shortcuts show a photograph of a vehicle Atlas actually has of that shape, taken from the newest page of live inventory the home page already fetches. The drawn silhouette remains only as the fallback for a shape nothing is listed under. The "popular makes" shortcuts carry each maker's own mark, extracted from `simple-icons` at build time by `scripts/generate-brand-logos.mjs`; a make with no icon there gets a lettermark, so the catalogue never blocks on the asset.

**Rationale:** Both of the substitutions D-023 made were wrong, for different reasons. A silhouette is a drawing of the *idea* of a wagon; a photograph of the wagon on the lot is the thing itself, and it is what the shopper is about to look at. Sourcing it from inventory rather than from stock photography answers the licensing objection outright — Atlas already has the rights to display these images, they cost nothing extra to serve, and a picture drawn from the catalogue can never advertise a shape the site cannot sell. On the marks: labelling a link to a maker's actual in-stock vehicles with that maker's mark is nominative use, the ordinary and expected way every marketplace labels a make filter. Declining to do it did not avoid a risk; it removed the visual anchor that makes a make grid scannable and left a wall of identical text chips.

**Consequences:** The home page fetches a wider page of listings (60 rather than 10) and slices it two ways: the first ten fill the "recently listed" list, and all sixty are scanned for a photographed example of each body type. That is one query, not nine — a round trip per body type would be nine extra searches for nine thumbnails. Only the small derived map crosses into the client component, not the sixty summaries. A shape with no photographed listing still renders, as the silhouette, so a fresh deployment with an empty catalogue gets a legible row rather than nine grey boxes. `simple-icons` stays a devDependency and its 3,500 icons never ship: the generated module holds the two dozen paths Atlas names, is committed, and a build never runs the generator. Eleven makes have no icon in that package — BMW, Mercedes-Benz, Lexus and others — and take a monogram instead, which is why the component treats a missing mark as ordinary rather than as an error. The marks are their owners' trademarks, used to identify their own vehicles and nothing else; the generated file says so at the top, and adding a make to the grid must not turn into implying an endorsement.

## D-025 — Operators Own the Storefront Pictures, and `content:manage` Is Why

**Status:** Accepted. Extends [D-024](#d-024--real-photographs-from-real-inventory-real-marks-for-real-makes).

**Decision:** An administrator can upload a photograph for each body-type shortcut, at `/admin/body-types`. The shortcut resolves in three steps — the picture an operator set, then the newest photographed listing of that shape, then the drawn silhouette — so nothing is required and the row always renders. The capability is a new permission, `content:manage`, held by ADMIN and SUPER_ADMIN. `settings:manage` stays with super admins alone.

**Rationale:** Inventory photographs are real but they are not a set: nine listings shot by nine sellers point different ways, sit on different backgrounds and crop differently, and the row reads as nine unrelated pictures rather than as a menu of shapes. That is exactly the gap an operator should be able to close, and only an operator — a dealer who could put a picture on the home page would have bought the most valuable placement on the site for the price of an upload. The new permission exists because the obvious alternative was to grant ADMIN the existing `settings:manage`, and a test already pinned that as super-admin-only. That test was right: changing a picture on the home page and changing a fee schedule are different powers, and the permission matrix exists so a capability can be granted without either inventing a role or widening an unrelated one.

**Consequences:** The write is two steps — bytes to `POST /uploads/body-type-images`, which validates the type and generates the filename, then the returned URL to `PUT /admin/body-type-images/:bodyType` — and the second step refuses any URL the storage service did not issue. That check is the point of the split: an operator pasting a third-party address would put a request to someone else's server into every visitor's first paint, leaking the referer and inheriting an outage Atlas cannot fix. The body type is the path and never the payload, and the schema is strict, so sending it in both places is a 400 rather than a silent write to the wrong row. The read is public and cached for ten minutes, invalidated by both writes, because every home page render needs it and it changes almost never. Adding `body-types` to `PUBLIC_UPLOAD_FOLDERS` was a required second step and the allowlist caught the omission exactly as [its comment predicts](../backend/src/main.ts) — a new folder that nobody registers returns 404, which someone notices, rather than serving something private. Removing a photograph drops the row and leaves the file: an operator who deletes the wrong one can re-point at it, and an orphan costs bytes rather than correctness. Body-type labels are plural now (`BODY_TYPE_PLURAL_LABELS`), because a shortcut leads to every SUV rather than to one, and the pictures are contained rather than cropped — a body type *is* a silhouette, and filling the box cuts off the nose or the tail, which is the part that tells a wagon from a hatchback.

## Decision Log Rules

1. Assign the next sequential identifier to every significant approved decision.
2. Record the decision, rationale, status, and important consequences.
3. Do not delete superseded decisions. Mark them as superseded and reference the replacing decision.
4. Keep exploratory ideas and unresolved questions outside this log until a decision is approved.
5. Update related project documents when a logged decision changes their direction.
