# Project Vintrax Decision Log

## Purpose

This document records significant product, business, architecture, and operating decisions for Project Vintrax. Each decision receives a permanent identifier so future documents and discussions can reference it without reopening the full history.

## Decision Status

Accepted means the decision is currently authoritative. A decision may later be superseded, but its original record should remain in this log.

## D-001 — Internal Codename: Project Vintrax

**Status:** Accepted

**Decision:** The internal codename for the project is Project Vintrax.

**Rationale:** A stable codename gives the project a consistent identity during discovery, planning, design, and development before a final public brand is selected.

**Consequences:** Internal documents, folders, planning discussions, and early technical references should use Project Vintrax unless a later decision replaces it. The codename is not assumed to be the final customer-facing brand.

## D-002 — Develop and Release the Product in Phases

**Status:** Accepted

**Decision:** Project Vintrax will be planned, built, tested, and released in deliberate phases rather than attempting to launch the entire long-term vision at once.

**Rationale:** A phased approach reduces technical and financial risk, limits feature creep, allows earlier validation with real users, and creates opportunities to adjust priorities based on evidence.

**Consequences:** Each phase must have a defined purpose, scope, success criteria, and exit conditions. Features that do not support the current phase should normally remain outside its implementation scope.

## D-003 — Build a Better Marketplace, Not an AutoTrader Clone

**Status:** Accepted

**Decision:** Project Vintrax may study and learn from AutoTrader and other established marketplaces, but it will not reproduce any competitor feature for feature.

**Rationale:** Copying an incumbent would inherit its complexity and weaknesses without creating a compelling reason for users to switch. Vintrax should preserve familiar marketplace patterns where they help users while improving problems that are poorly solved today.

**Consequences:** Competitor features are inputs to research, not automatic requirements. New features must be justified by a real user problem, strategic advantage, legal requirement, or operational need.

## D-004 — Support Dealerships and Private Sellers

**Status:** Accepted

**Decision:** The long-term marketplace will support both professional dealerships and ordinary private vehicle sellers.

**Rationale:** Buyers benefit from broader inventory, while the two seller groups create complementary supply. Supporting both also positions Vintrax as a complete vehicle marketplace rather than a dealer-only advertising platform.

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

**Decision:** Vehicle auctions are implemented inside the Vintrax platform rather than as a separate application. Auction listings, bidding, settlement and live updates share the same API, database, accounts and notification infrastructure as the fixed-price marketplace.

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

**Decision:** Vintrax ships `scripts/setup-ubuntu.sh`, which provisions an Ubuntu machine directly — Node, pnpm, PostgreSQL, Redis, the database, environment files, migrations, an optional seed, a build, and either a foreground run or systemd units. It stands beside the Docker, Compose and Kubernetes artefacts rather than replacing them.

**Rationale:** The container path assumes a working Docker daemon, a registry, and someone who knows both. That is the right target for a real deployment and the wrong first step for evaluating the platform, onboarding a developer, or standing up a demo on a virtual machine. Two paths also cost less than they appear to: the script drives the same `pnpm` scripts and the same migrations that CI and the images use, so it exercises the ordinary path rather than inventing a parallel one. Writing it also surfaced a genuine defect — the documented setup could not run migrations, because the Prisma CLI reads `.env` from `backend/` and the repository keeps it at the root.

**Consequences:** The script must be updated whenever setup changes shape — a new service dependency, a new environment variable, a new build step — or it silently produces a half-configured machine, which is worse than no script. It is deliberately not a hardened deployment: no TLS, no reverse proxy, no firewall, no dedicated service account, and one machine only, all stated in the deployment guide so nobody mistakes it for a production baseline. Generated secrets and an existing `.env` are treated as sacred: re-running never rotates the JWT secrets, because that would sign every issued token out. `backend/.env` is now a symlink to the root `.env`, so there is one file to edit rather than two that drift.

## D-019 — Vintrax Mobile Is a Separate Application Over a Shared Client

**Status:** Accepted

**Decision:** The mobile experience is a separate workspace application, `mobile/`, built on the same stack as the web app and consuming the same API. The behaviour both clients must agree on — the API client, token refresh, session store, auction socket protocol and display formatting — moves into `packages/client`, which both import. No backend, database, schema or authentication change was made.

**Rationale:** The web application is already responsive and usable on a phone, so the case for a second application is not "it does not fit" but "it is not designed for a thumb". A bidder standing on a lot needs the price, the countdown and a bid button without pinching; a dealer photographing a trade-in needs the camera two taps from the home screen; both need targets a thumb hits while walking. Retrofitting that onto a layout designed for a cursor would have meant either compromising the desktop experience or scattering breakpoint-specific branches through it. The shared package is what keeps the cost honest: the parts where two implementations could silently disagree — when a session ends, what a 409 means, what a price looks like — exist once.

**Consequences:** A third application to build, test and deploy, on its own port and behind its own host, because a PWA's service worker cannot claim a scope above its own path. Anything in `packages/client` now has two consumers, so a change there has to be checked against both — the web app's existing tests exercise it through that app's own import paths, which is the guard. The mobile app deliberately does not cover every screen the web app has: administration, moderation and inspection authoring stay on the desktop, where they belong. Offline support stops at an application shell; there is no write queue, because a bid replayed silently minutes later is worse than one that visibly failed.

## D-020 — Navy Carries the Interface; Red Is Reserved

**Status:** Superseded by [D-028](#d-028--the-brand-is-red-so-red-can-no-longer-mean-only-error). Kept because D-028 is only intelligible against it.

**Supersedes:** the blue-and-amber palette used before the brand lockup existed.

**Decision:** The palette follows the Vintrax lockup: navy for actions, links and headers; red as a brand accent; the lockup's grey for secondary text. Red is not used for buttons or for the auction price flash, and `--destructive` is a darker, less saturated red than the brand red.

**Rationale:** The brand red and the colour of a rejected bid are both red, and they meet on the one screen where the distinction matters most — a live auction, where "your bid failed" has to be unmistakable within a second. Separating them by hue alone would be wishful thinking at a glance, on a phone, outdoors. So they are separated by role instead: the interface has no red controls at all, which means a red element is never something to click and is almost always something to read. The price flash moved to amber for the same reason, having previously sat two elements above a red rejection message.

**Consequences:** Red appears sparingly — the mark, the live-auction badge, the rule beneath the hero — which is roughly the proportion it occupies in the lockup, and that restraint is load-bearing rather than aesthetic. Anyone adding a red control reintroduces the ambiguity, so the rule is written into the brand document. Error states must continue to pair colour with an icon and explicit wording; colour is never the only signal. The mark's colours are fixed hex rather than theme tokens, because tokens swap in dark mode and an inverted mark stops matching the app icon.

## D-021 — Bilingual Interface, Unilingual Listings

**Status:** Accepted

**Decision:** The web application ships English and French. The locale lives in a cookie, so server-rendered pages and client components resolve the same language. Interface copy is translated; listings, descriptions and messages written by sellers are not.

**Rationale:** A Canadian marketplace that only speaks English excludes a fifth of the country, and the lockup already says _Canada's auto marketplace_. The cookie is what makes it work rather than half-work: the home and listing pages are server components, and a locale the server could not read would leave those pages in English while the header around them switched to French — worse than not translating at all. Seller-written content is left alone deliberately. Machine-translating a description of a vehicle's condition creates a liability where a mistranslated "no frame damage" is a legal problem, not a cosmetic one.

**Consequences:** Adding a string means adding it in both languages; the dictionary's French type is derived from the English object, so a missing key fails the build rather than surfacing an English word mid-sentence. Reading a cookie opts those routes out of static rendering, which costs nothing here because they already fetch live inventory uncached. Language is not in the URL, so the two versions are not separately addressable or separately indexable — a real cost for search visibility, and the thing to change first if organic search in French matters. A third language is a third dictionary and no new machinery.

## D-022 — Authorization Is Decided by the Service, Not by the Schema

**Status:** Accepted

**Decision:** Three of the four high findings in the [security audit](./security-audit.md) shared one root cause, and are fixed the same way. A permission on the route is a floor, never the whole rule: `POST /orders/:id/payment` requires `payment:manage` _and_ that the caller is the seller on that order. A field the caller must not control is removed from the schema rather than ignored in the handler, and the schema is strict so that sending it anyway is refused rather than dropped: `updateVehicleSchema` omits `status` and rejects it by name, and status moves through `PATCH /vehicles/:id/status` against an explicit transition table. Data whose audience is narrower than its parent resource is withheld by default: `toVehicleDetail` returns no documents unless a caller passes `includeDocuments`, and the value is computed from who is asking.

**Rationale:** Each of the three had a correct sibling a few lines away — `complete()` checked the seller, `moderate` was properly gated, images really are public — so the failure was not ignorance of the rule but the absence of a place that forces it to be stated. Zod strips unknown keys, which makes the schema the real authority over what a handler can write, and `data: { ...fields }` turns every accepted key into a writable one; a comment saying "sellers should not set status" would not have survived. Defaulting document visibility to false means a new call site that forgets the question leaks nothing, and the compiler asks the question at every call.

**Consequences:** Silently discarding input is not a safe default — Zod strips unknown keys, so the first cut of this left an edit form whose status dropdown reported a successful save and changed nothing, and the dealer inventory's Publish button posting to an endpoint that no longer accepted it. Both were found by clicking, not by a test. Anywhere a field is removed for a security reason, the schema is now strict so the refusal is visible. Route guards and service checks also overlap deliberately, and the overlap is the point: a dealer holding `payment:manage` who is the buyer on an order is refused by the second check, not the first. Publication has exactly one door, so a seller-facing "publish" button is not implementable without moderation, which is intended. `VehicleDetail` gained `documentCount` so a page can say paperwork exists without disclosing it, and document links became fetches with an `Authorization` header rather than `<a href>`, since the bytes are no longer a static file. Each fix landed with a negative-case test; the wider goal in [future work](./reference/future-work.md) — one such test per role per sensitive endpoint — is still mostly unmet.

## D-023 — Marketplace Conventions, Vintrax's Own Identity

**Status:** Accepted

**Decision:** The buying surface — the home page and search results — follows the layout and interaction conventions of large vehicle marketplaces: a short hero whose purpose is a make/model/budget/province search rather than a picture, body-type entry points carrying live inventory counts, and results as dense horizontal rows with a persistent filter rail, a result count, sort, and a list/grid toggle. The palette, mark and wording stay Vintrax's own. No competitor's colours, typography or copy are reproduced.

**Rationale:** Asked to make Vintrax look exactly like a named competitor, the layout half of that request is the half worth having and is free to take: a photo on the left, the deciding facts in the middle, price on the right is a convention because it works, not because anyone owns it — it fits eight vehicles on a screen instead of three and puts the same field at the same horizontal position on every row, which is what makes a column scannable. The visual identity half is the opposite: it is the part that is legally theirs, it would make Vintrax read as a clone in a market where its pitch is independent inspections and live auctions, and it would discard [D-020](#d-020--navy-carries-the-interface-red-is-reserved) a week after it was made. [D-003](#d-003--build-a-better-marketplace-not-an-autotrader-clone) already said this.

**Consequences:** The hero search is an elevated card overlapping the band rather than sitting inside it, so the first thing on the page is a control. Its tabs are Vintrax's own cuts — all vehicles, buy now, auctions, inspected — not the vehicle categories the reference uses, because Vintrax does not sell boats and a tab leading nowhere is worse than no tab. Its submit button carries the live result count, which is the one idea here worth taking wholesale: it turns narrowing a search from guessing into choosing, and says "No matches" before the click rather than after. Body-type shortcuts were drawn as SVG silhouettes rather than photographs, and where the reference shows manufacturer logos Vintrax showed make names as text chips; both were overcautious and are superseded by [D-024](#d-024--real-photographs-from-real-inventory-real-marks-for-real-makes). Search results default to rows; the card grid survives behind a toggle for people shopping on looks, remembered per browser in `localStorage`. Listings now show a financing estimate, which is how buyers actually compare, so the assumptions — 72 months at 7.99%, nothing down, taxes extra — live in one exported constant next to the calculation and are printed beside every figure rather than buried. The hero shrank from 24rem to about 12, which is the change that puts inventory above the fold. Every hero field maps to a filter the API already supports; there is no postal-code box, because distance search does not exist and a control that silently does nothing is worse than its absence.

## D-024 — Real Photographs from Real Inventory, Real Marks for Real Makes

**Status:** Accepted. Supersedes two consequences of [D-023](#d-023--marketplace-conventions-vintraxs-own-identity).

**Decision:** The body-type shortcuts show a photograph of a vehicle Vintrax actually has of that shape, taken from the newest page of live inventory the home page already fetches. The drawn silhouette remains only as the fallback for a shape nothing is listed under. The "popular makes" shortcuts carry each maker's own mark, extracted from `simple-icons` at build time by `scripts/generate-brand-logos.mjs`; a make with no icon there gets a lettermark, so the catalogue never blocks on the asset.

**Rationale:** Both of the substitutions D-023 made were wrong, for different reasons. A silhouette is a drawing of the _idea_ of a wagon; a photograph of the wagon on the lot is the thing itself, and it is what the shopper is about to look at. Sourcing it from inventory rather than from stock photography answers the licensing objection outright — Vintrax already has the rights to display these images, they cost nothing extra to serve, and a picture drawn from the catalogue can never advertise a shape the site cannot sell. On the marks: labelling a link to a maker's actual in-stock vehicles with that maker's mark is nominative use, the ordinary and expected way every marketplace labels a make filter. Declining to do it did not avoid a risk; it removed the visual anchor that makes a make grid scannable and left a wall of identical text chips.

**Consequences:** The home page fetches a wider page of listings (60 rather than 10) and slices it two ways: the first ten fill the "recently listed" list, and all sixty are scanned for a photographed example of each body type. That is one query, not nine — a round trip per body type would be nine extra searches for nine thumbnails. Only the small derived map crosses into the client component, not the sixty summaries. A shape with no photographed listing still renders, as the silhouette, so a fresh deployment with an empty catalogue gets a legible row rather than nine grey boxes. The first cut built that row from the search facets, which carry only body types something is listed under, so an operator's photograph for a van or a convertible was uploaded, stored, and then silently ignored — no error anywhere, just the silhouette. The row is built from the enum now and `buildBodyTypeShortcuts` is a tested pure function, because a component that always renders nine things cannot be fed data that covers five. `simple-icons` stays a devDependency and its 3,500 icons never ship: the generated module holds the two dozen paths Vintrax names, is committed, and a build never runs the generator. Eleven makes have no icon in that package — BMW, Mercedes-Benz, Lexus and others — and take a monogram instead, which is why the component treats a missing mark as ordinary rather than as an error. The marks are their owners' trademarks, used to identify their own vehicles and nothing else; the generated file says so at the top, and adding a make to the grid must not turn into implying an endorsement.

## D-025 — Operators Own the Storefront Pictures, and `content:manage` Is Why

**Status:** Accepted. Extends [D-024](#d-024--real-photographs-from-real-inventory-real-marks-for-real-makes).

**Decision:** An administrator can upload a photograph for each body-type shortcut, at `/admin/body-types`. The shortcut resolves in three steps — the picture an operator set, then the newest photographed listing of that shape, then the drawn silhouette — so nothing is required and the row always renders. The capability is a new permission, `content:manage`, held by ADMIN and SUPER_ADMIN. `settings:manage` stays with super admins alone.

**Rationale:** Inventory photographs are real but they are not a set: nine listings shot by nine sellers point different ways, sit on different backgrounds and crop differently, and the row reads as nine unrelated pictures rather than as a menu of shapes. That is exactly the gap an operator should be able to close, and only an operator — a dealer who could put a picture on the home page would have bought the most valuable placement on the site for the price of an upload. The new permission exists because the obvious alternative was to grant ADMIN the existing `settings:manage`, and a test already pinned that as super-admin-only. That test was right: changing a picture on the home page and changing a fee schedule are different powers, and the permission matrix exists so a capability can be granted without either inventing a role or widening an unrelated one.

**Consequences:** The write is two steps — bytes to `POST /uploads/body-type-images`, which validates the type and generates the filename, then the returned URL to `PUT /admin/body-type-images/:bodyType` — and the second step refuses any URL the storage service did not issue. That check is the point of the split: an operator pasting a third-party address would put a request to someone else's server into every visitor's first paint, leaking the referer and inheriting an outage Vintrax cannot fix. The body type is the path and never the payload, and the schema is strict, so sending it in both places is a 400 rather than a silent write to the wrong row. The read is public and cached for ten minutes, invalidated by both writes, because every home page render needs it and it changes almost never. Adding `body-types` to `PUBLIC_UPLOAD_FOLDERS` was a required second step and the allowlist caught the omission exactly as [its comment predicts](../backend/src/main.ts) — a new folder that nobody registers returns 404, which someone notices, rather than serving something private. Removing a photograph drops the row and leaves the file: an operator who deletes the wrong one can re-point at it, and an orphan costs bytes rather than correctness. Body-type labels are plural now (`BODY_TYPE_PLURAL_LABELS`), because a shortcut leads to every SUV rather than to one, and the pictures are contained rather than cropped — a body type _is_ a silhouette, and filling the box cuts off the nose or the tail, which is the part that tells a wagon from a hatchback.

## D-026 — The Front Page Leads With Writing, and the Writing Is Plain Text

**Status:** Accepted.

**Decision:** Administrators write editorial posts at `/admin/blog`, each with a headline, a standfirst, a hero photograph, a body and one optional button. The most recently published post becomes the masthead across the top of the home page, built to the proportions of the storefront masthead format — roughly 1920×330, a wide short lifestyle band carrying a headline and a call to action. Posts also live at `/blog` and `/blog/:slug`. The body is plain text: blank lines separate paragraphs and nothing is interpreted as markup. Authoring uses `content:manage`, the same permission as the body-type photographs. When nothing is published the home page keeps its gradient hero.

**Rationale:** A marketplace home page that is only a search box has nothing to say between visits, and the format asked for here is the one every large marketplace uses to say it: a photograph wide enough to be a scene, one sentence, one button pointing back into inventory. The shape matters as much as the content — 1920×330 is short enough that the search card and real listings stay above the fold, which is the property that made [D-023](#d-023--marketplace-conventions-vintraxs-own-identity) shrink the hero in the first place, and a masthead that pushed inventory below the fold would undo it. Plain text is the deliberate ceiling. Rich text on the most-visited page of the site is a cross-site-scripting surface that needs a sanitiser, a sanitiser is a dependency that has to stay correct forever, and paragraphs are enough for a buying guide. The fallback is not a placeholder: a front page that goes blank because nobody wrote this week is worse than one that never had a masthead.

**Consequences:** The button's link is validated as an Vintrax path and `//host` is rejected explicitly, because the largest button on the site pointing at another origin is an open redirect wearing Vintrax's branding — and a protocol-relative URL passes a naive "starts with `/`" check. Label and link are required together, so there is no half-built control to render around. The hero photograph must be a URL the storage service issued, the same rule and the same reason as [D-025](#d-025--operators-own-the-storefront-pictures-and-contentmanage-is-why); `articles` joined `PUBLIC_UPLOAD_FOLDERS`. Public reads and authoring are separate controllers rather than one route with a flag, so there is no path where a forgotten check turns a reader into an editor, and an unpublished post answers 404 rather than 403 — whether a draft exists at a given slug is not a visitor's business either. The admin editor previews with the real masthead component at full width rather than an approximation in a sidebar: a lookalike drifts, and the first person to notice would be a visitor. Slugs are derived from titles with a numeric suffix on collision, and `new`, `masthead` and `admin` are reserved so a post can never take a slug the routing already uses. Publication stamps `publishedAt` once, so fixing a typo does not reorder the site. The masthead is cached for five minutes and every write drops the key.

## D-027 — Verbs in the Header, and the Band Stays Navy

**Status:** Accepted, except for the band's colour, which [D-028](#d-028--the-brand-is-red-so-red-can-no-longer-mean-only-error) changes. Extends [D-023](#d-023--marketplace-conventions-vintraxs-own-identity).

**Decision:** The site header is a solid brand band carrying three verb menus — Buying, Selling, Research & advice — each opening a panel of columns, then a cluster on the right: icon shortcuts for saved, notifications and messages, a divider, the account control, a single-language toggle, and one outlined pill for _Sell my car_. Every entry in every panel is a filter or a page Vintrax actually has. The band is Vintrax navy, not the red the pattern usually comes in.

**Rationale:** "Browse / Auctions" were nouns naming two of Vintrax's pages; "Buying / Selling" are the two things a visitor came to do, and a panel under each is where a marketplace can show the twenty routes into inventory that a flat bar has no room for. The reference menus were the model down to the column headings. What did not come across is their content: those menus carry boats, RVs, snowmobiles and a valuation tool, and Vintrax has none of those — an entry leading nowhere is worse than a short menu, which is the same rule that shaped the hero tabs. Red is the part that is genuinely theirs: [D-020](#d-020--navy-carries-the-interface-red-is-reserved) reserves it for the mark and live-auction moments, and a red bar would both spend that reservation and make Vintrax read as a clone of the site it is competing with.

**Consequences:** The band needs its own colour tokens rather than `--primary`, which inverts to pale blue in dark mode — right for a button on a dark page, wrong for the band carrying the wordmark. `--header`, `--header-foreground`, `--header-muted` and `--header-border` stay navy in both themes, the way a red bar stays red. The lockup gained an `onDark` tone: the mark's navy tile is a hole on a navy bar, so it drops to the monochrome variant the component already had. The panel is anchored to the trigger row rather than the container — the first cut offset it by a hardcoded logo width, which would have drifted the moment the descriptor changed length, and French changes it. Panels close on Escape, on a pointer outside, and on navigation, because a panel still hanging over the next page is the most common way this pattern breaks. The language control became a single button showing the language you would switch _to_: with exactly two languages, showing both means one is always inert. The latest three posts appear in the research panel, fetched only after that panel has first been opened — a menu nobody opens should not cost a request on every page load. On a narrow screen the whole structure becomes one scrolling drawer, which is where the icon shortcuts also live, since they are hidden from the bar below `sm`.

## D-028 — The Brand Is Red, So Red Can No Longer Mean Only "Error"

**Status:** Accepted. Supersedes the colour half of [D-020](#d-020--navy-carries-the-interface-red-is-reserved) and the band colour in [D-027](#d-027--verbs-in-the-header-and-the-band-stays-navy).

**Decision:** The identity is red. `--primary`, `--accent` and `--ring` move to hue 0 in both themes, and the neutral ramp moves with them from the cool blue-grey of hue 218/222 to hue 0 at low saturation. The masthead band is near-black rather than navy or carbon. A new `--hero` token, like `--header`, holds a deep red that does not invert with the theme. The supplied lockup, `frontend/public/vintrax-logo.png`, replaces the drawn one everywhere, rendered exactly as delivered. Headings are set in Oswald, body copy in Inter, both self-hosted.

**Rationale:** The brand was replaced, and the interface followed it rather than being left as a green frame around a red mark. The neutral ramp had to move too: hue 218/222 was chosen to sit under a green brand, and next to red it stops reading as a neutral and starts reading as a second colour. The band is near-black because the supplied artwork is a raster carrying its own carbon ground at about `#040404` — a lifted carbon behind it drew a visible rectangle around the logo, which is the one thing a masthead must not do to a wordmark.

**Consequences:** This gives up something D-020 was explicitly built on. With a green brand, red meant "error" and nothing else; it cannot now. `--primary` (`0 75% 42%`), `--accent` (`0 85% 52%`) and `--destructive` (`0 52% 30%`) are separated by lightness and saturation instead of hue, which is a weaker signal and is not relied on alone: the rule already in force — colour is never the only signal — does the real work, and every error state carries an icon and explicit wording. The same reasoning now also separates `--success`, which no longer shares a hue with the brand and so needs less help than it did. D-020's rule "actions are never red" is inverted; it is recorded in `documentation/brand.md` rather than deleted, so the reason it changed is not lost. The price flash stays amber: with three reds on the page a fourth would be indistinguishable. The hero band needed its own token because `--primary` lifts to a light red in dark mode — right for a button, wrong for a full-bleed band, where at that size it stops reading as a brand colour and starts reading as a warning. The lockup is served through `next/image` from a static import so the committed 1989×790 master stays byte-for-byte as supplied while browsers receive sized derivatives; `w-auto` against a fixed height is what holds its aspect ratio, and `<Logo>` no longer takes a `tone` because finished artwork with its own ground has no variant to choose. On light surfaces — the footer and the sign-in page — that ground shows as a dark slab, which is the honest rendering of the file and is accepted rather than worked around by editing it. The drawn lockup is deleted rather than kept as a fallback: it was a stand-in for artwork that had not arrived. `LogoMark` stays a separate drawing, because a 2.5:1 raster with a chrome bevel and a carbon weave is an unreadable smudge at 16px. The condensed face is applied as one rule on `h1`–`h4` rather than a class per component, so no markup moved; body copy, form controls and table cells stay in the sans deliberately, because this interface is mostly small text and a condensed face at 14px in a spec table is slower to read.

## D-029 — A Dealer's Inventory Is Their Own Vehicles, and a CSV Cannot Say Otherwise

**Status:** Accepted. Extends [D-022](#d-022--authorization-is-decided-by-the-service-not-by-the-schema).

**Decision:** Dealers manage inventory in bulk by CSV, at `/dealer/inventory/import`, under the existing `vehicle:write` permission. Import is two steps — a preview that writes nothing, then a confirmation that applies the same plan. A row is matched to an existing vehicle by VIN and then by stock number, **always scoped to the authenticated seller**. `Vehicle` gains a nullable `stockNumber`, unique per seller rather than globally, and a new `InventoryImport` table records each confirmed run. Ownership columns in the file are recognised and ignored, never honoured.

**Rationale:** A dealership's inventory already exists in this schema as the set of vehicles whose `sellerId` is the dealer's own user — there is no dealer column on `Vehicle`, and adding one would have created a second source of truth for who owns a listing. Scoping every query by `sellerId` makes cross-dealer access impossible rather than merely forbidden: a row naming a VIN another seller lists does not match anything, so the worst it can do is create a vehicle in the caller's own inventory. That is the same principle as D-022 — the service decides, and a field the caller must not control is kept out of the accepted shape rather than ignored in the handler — applied to a file instead of a request body. The stock number is per-seller unique because two dealerships both numbering a car "A1042" is normal, and a global constraint would stop the second one listing it. No new permission was invented: bulk editing is the authority to edit a listing, exercised many times.

**Consequences:** The preview is a dry run of the identical code path rather than a description of it, and the plan is rebuilt at confirm time against the database as it is then — so the confirmation is decided on current data, not on what the dealer saw a minute ago. The `fileHash` returned by the preview ties the two together: a different file is refused rather than applied under a summary nobody saw. The file is uploaded twice instead of being stored between the steps, which keeps an unconfirmed upload from living anywhere. Partial import is supported — valid rows are written, invalid rows are skipped — because one bad row in a 500-row dealer export blocking the other 499 is unusable; nothing is skipped silently, and every skipped row is returned with its errors and counted on the import record. Writes are batched into transactions of 50 rather than one transaction for the file, so a 2000-row import does not hold write locks for its whole run. Two limits are enforced on the server: 2MB and 2000 rows. Normalisation is deliberately one-directional: case on a VIN is formatting and is corrected, but length and alphabet are meaning and a bad VIN stays bad — the importer never invents inventory data, and an unrecognised enum value is an error rather than a nearest-match guess, because "closest match" on a fuel type is how an electric car gets listed as diesel. Header matching is an explicit alias dictionary after a documented normalisation, not fuzzy matching, so `price_msrp` is reported as unrecognised rather than silently repricing the inventory to sticker. `status` accepts only the four seller-settable values, and a real status it may not set — `ACTIVE`, `IN_AUCTION` — is left unchanged and reported rather than failing the row, which is what makes export → edit → re-import work for a dealer with live listings; publishing stays a moderation decision. The exporter prefixes any cell beginning `=`, `+`, `-` or `@`, because a listing description is attacker-influenced text and those execute as formulas when the file is opened in Excel or Sheets. The CSV parser is written rather than depended on: the behaviours that matter are a page of code, and a parser dependency would be a larger audit surface than the thing it replaces on the one path that accepts a file from outside and writes many rows at once.

## D-030 — "Other" Is a Real Answer; a Guess Is Not

**Status:** Accepted. Extends [D-029](#d-029--a-dealers-inventory-is-their-own-vehicles-and-a-csv-cannot-say-otherwise).

**Decision:** `Transmission` and `Drivetrain` gain an `OTHER` value. The dealer CSV's canonical listing-state column is renamed `listing_status`, and `status` becomes an alias for `condition`. A blank `transmission` or `drivetrain` is recorded as `OTHER` with a warning on the row; a blank in any other required column fails the row. An optional column whose value cannot be parsed leaves the field empty with a warning rather than failing the row. The CSV schema version goes to 2.

**Rationale:** The first real dealership export tried against the importer — 47 vehicles from a live DMS — failed every single row, and the reasons were all the same kind of mistake: assuming the shape of a feed rather than reading one. Its `Status` column holds `Used`, which is the vehicle's condition; mapping it to the listing's own state produced `status "Used" is not a recognised value` on all 47. Its mileage column is `KMS` and its seat count is `Passenger`, neither of which was an alias. Its `Drive` column says `Other` for two vehicles, which no enumeration value could express.

That last one is the decision worth recording. `OTHER` is not a dumping ground for bad data — both enumerations were genuinely incomplete. A battery-electric car has a single-speed reduction gear and is none of `AUTOMATIC`, `MANUAL`, `CVT` or `DUAL_CLUTCH`, and drivetrains exist that are none of the four listed. Recording what the source said is not the same as inventing a value, which is the line this importer has held since [D-029](#d-029--a-dealers-inventory-is-their-own-vehicles-and-a-csv-cannot-say-otherwise): filling in `FWD` for a 1989 pickup whose feed left the column blank would be a fabricated fact about a real vehicle, and a buyer would read it as one.

**Consequences:** The same 47-row export now plans as 46 creates and one error. The remaining row states neither a body type nor a fuel type, and both of those enumerations are complete — a blank is missing data, not a new category — so the row is refused with those two column names rather than guessed at. Body type earns the stricter treatment on its own merits: it drives the storefront's shape shortcuts ([D-024](#d-024--real-photographs-from-real-inventory-real-marks-for-real-makes)), so a wrong one is visible on the front page. Adding `OTHER` to the two enumerations reaches the listing form and the search filter automatically, because both are built from the shared constants rather than from hand-written lists; the migration is `ADD VALUE IF NOT EXISTS`, so it is additive and the previously deployed API runs unchanged against it. Renaming the listing-state column is a breaking change to the CSV contract, which is what the version bump is for — a v1 file written before this change would have its `status` column read as a condition. Nothing had been generated in the wild between the two versions. `CompanyID` joins the ignored ownership columns: a DMS export names the rooftop it came from, and that is still ownership. The feed's photo columns are left unrecognised rather than half-supported: they are third-party URLs, and [D-025](#d-025--operators-own-the-storefront-pictures-and-contentmanage-is-why) requires an image URL to be one the storage service issued, so importing them means fetching and re-hosting each file — a larger change than this one, and a deliberate omission rather than an oversight.

## D-031 — Photos Are Copied, and the Copier Trusts No URL

**Status:** Accepted. Extends [D-029](#d-029--a-dealers-inventory-is-their-own-vehicles-and-a-csv-cannot-say-otherwise) and [D-025](#d-025--operators-own-the-storefront-pictures-and-contentmanage-is-why). Closes the deliberate omission recorded in [D-030](#d-030--other-is-a-real-answer-a-guess-is-not).

**Decision:** The importer reads `main_photo`, `extra_photos` and their two `…_updated_at` columns, downloads each image server-side, and re-hosts it through the storage service. Downloads run after the import has been applied and returned, not inside it. Reconciliation is by source URL plus source stamp. `VehicleImage` gains `sourceUrl` and `sourceUpdatedAt`; `InventoryImport` gains photo counters and a status. CSV schema version 3.

**Rationale:** Storing the third-party URL and rendering from it was never an option — [D-025](#d-025--operators-own-the-storefront-pictures-and-contentmanage-is-why) requires an image URL to be one the storage service issued, and the reasons are concrete: a listing that renders `<img src="https://some-dms.example/…">` puts a request to a server Vintrax does not control on every buyer's page, leaking that buyer's address and referer; the listing goes blank the day the dealer changes systems; and the remote host can swap an approved photo for anything at all after moderation passed it. So the bytes are copied once.

Copying them is what introduces the interesting problem. This is the only place in the application where a URL a user supplied causes the server to make a request, which makes it the application's entire server-side request forgery surface. A dealer CSV is not hostile by default, but it is written by a third-party system and edited in a spreadsheet, and "our importer will fetch any URL you put in column 29" is a way to read the cloud metadata service, the Redis port, or anything else reachable from inside the network and not from outside it.

The defence is four gates in order, and the third and fourth exist because the first two are not enough on their own. The text gate allows only http and https on standard ports and strips credentials. The address gate checks _every_ IP the hostname resolves to, unwraps IPv4-mapped IPv6 first, and treats anything it cannot parse as private — it fails closed. The socket is then pinned to an address that already passed, because resolving the name a second time at connect time is the DNS rebinding window. Redirects are followed by hand rather than by the HTTP client, three at most, each hop re-entering both earlier gates, since a redirect to `169.254.169.254` is how an address gate gets bypassed otherwise. And the bytes gate caps the body while it streams, demands an identity encoding so a small response cannot expand past the cap once decoded, and takes the content type from the file's magic number — the remote server chooses the `Content-Type` header, so it is not evidence.

**Consequences:** The 47-row feed this was built against asks for 1,064 downloads. That is minutes of work against someone else's web server, so it cannot happen inside the dealer's request: the vehicles are written and returned first and the photos land afterwards, six at a time — aimed at not hammering the dealer's host rather than at our own throughput. The run never throws, because it is started without being awaited and an escaping error would be an unhandled rejection with nothing to catch it. Reconciling by URL plus stamp is what makes a second run of the same file free, which in turn is what makes it safe for a run to be interrupted: re-importing picks up where it left off. Photos also sync on `UNCHANGED` rows, since re-photographing a car changes nothing else about it. The feed owns the photos it brought and only those — a photo the dealer uploaded here has no source URL, is never deleted by an import, and is moved to sit after the imported set. A vehicle whose photo host is down keeps the pictures it already has rather than being blanked. Failures are recorded by host and reason and deduplicated: one unreachable host is one line, not twelve hundred. The export emits source addresses rather than storage URLs, so export → edit → re-import costs nothing. The fetcher deliberately does not honour `HTTPS_PROXY`: routing through a proxy would hand hostname resolution to the proxy and defeat the address pinning.

## D-032 — Vintrax Does Not Say "Verified" About a Car It Has Not Inspected

**Status:** Accepted. Relates to [D-029](#d-029--a-dealers-inventory-is-their-own-vehicles-and-a-csv-cannot-say-otherwise).

**Decision:** A vehicle carries a history timeline the seller enters, and the history report itself as a restricted document. The timeline is public and attributed to the seller; the report stays behind the same access rule as the rest of the paperwork; the date printed on the report is public even though the report is not. No part of the interface describes a seller-entered timeline as verified. The listing's four-figure summary marks which figures came from the seller, and never reads an absence as good news.

**Rationale:** The supplied design showed a "CARFAX Canada report — Verified · 14 Sep 2026" badge above a timeline. Vintrax has no CARFAX integration and retrieves nothing; every entry would be typed by the dealer selling the car. Printing "Verified" beside a seller's own claim about accident history, in the voice of the marketplace, on the page where someone decides whether to spend twenty thousand dollars, is a false statement about a vehicle made by us. The mockup was followed everywhere else and not here, deliberately.

The same reasoning decides the summary strip. "Accidents — None reported" is a strong claim in large type, and the failure mode is silent: it is what appears when the truth is that nobody said anything either way. So it appears only when the seller actually entered a no-claims entry, an empty timeline reads "Not stated", and owner count is omitted rather than shown as zero, because "0 owners" is a fact about an empty form and not about a car. A claim outweighs a no-claims entry sitting beside it, and adverse entries are coloured from their kind rather than from the words next to them, so a seller cannot soften one by wording it gently.

**Superseded in part by [D-033](#d-033--the-vin-is-printed-in-full-and-a-carfax-link-is-checked-before-it-is-trusted):** the VIN masking described below was reversed. Everything else in this decision stands, including the refusal to describe a seller-entered timeline as verified.

**Amended by issue #34:** the report upload was removed. A CARFAX report now reaches a buyer as a validated link on the listing, and the timeline is the dealer's own summary beside it. The reasoning below about _who is asserting what_ is unchanged and is the part that mattered; the mechanism for holding the report is not. With uploads gone there is nothing to carry a report date, so `historyReportIssuedOn` went with it rather than shipping a field that is always null.

**Consequences (as originally written):** Two things that look like one feature are kept apart: the report is evidence and carries the previous owner's name, address and full VIN history, so it stays restricted; the timeline names nobody and is what a buyer reads without asking. The report's date is the exception — it discloses nothing about the owner and is exactly what tells a buyer whether the timeline above it is current. The timeline is replaced as a whole set, matching images and documents, because the client holds the ordered list and order is part of the data. Writing one is scoped by `requireOwnedVehicle`: making a claim about a car belongs to whoever owns the listing. The one thing Vintrax does verify — an independent inspection with a named inspector — keeps its own separate block, which is what makes that block mean something. For the same reason the listing page shows no finance estimate and no delivery price: both are quotes, and there is no lender, rate table or carrier behind either. The VIN on the page is masked to its last six characters, which are the serial a cloned listing needs; the first eleven give model, year, plant and engine, which is what a buyer needs to check the listing is honest.

## D-033 — The VIN Is Printed in Full, and a CARFAX Link Is Checked Before It Is Trusted

**Status:** Accepted. Supersedes the VIN-masking clause of [D-032](#d-032--vintrax-does-not-say-verified-about-a-car-it-has-not-inspected); the rest of D-032 stands.

**Decision:** The full VIN is shown on the listing, alongside the seller's stock number and a new `titleStatus` brand. A vehicle may carry an optional `carfaxUrl`, validated against the real CARFAX hosts, which draws a CARFAX badge on the search results and the listing that opens the report in a new tab. `MAX_PAGE_SIZE` rises to 100, administrators gain a bulk delete, and the gallery gains next and previous controls.

**Rationale:** D-032 masked the VIN to its last six characters on the reasoning that the serial is what a cloned listing needs. The owner reversed that in issue #34, and the reasoning the other way is sound: a buyer running their own history check needs the whole number, every other Canadian marketplace prints it, and a partially hidden VIN reads as something being concealed rather than as a precaution. The masking bought little — the first eleven characters plus the photos already identify the car to anyone building a clone.

The CARFAX link is where the care moved instead. A badge carrying a third party's name is a trust signal, and an unvalidated URL behind it is a phishing page wearing a brand the buyer already trusts. So the host is parsed and matched against `carfax.ca` and `carfax.com` on a dot boundary — `carfax.ca.example.com` is refused — https only, no credentials. The badge sets the name in our own type rather than reproducing the CARFAX mark, which is registered and would need their brand assets and their permission.

`titleStatus` carries a `SALVAGE` value although the issue asked only for clean and rebuilt, because a salvage title is a real third state and a two-value list would make a seller holding one pick whichever of the two lied less. It is nullable and never defaulted: every listing that predates the field has no stated brand, and backfilling them to `CLEAN` would be the application asserting something about thousands of cars nobody checked. A branded title is shown as a badge at the top of the listing, driven by the enum rather than by any text a seller typed.

**Consequences:** Bulk delete runs each id through the single-vehicle `remove`, so the live-auction and sales-record guards still refuse and a seller still reaches only their own vehicles — the endpoint grants nobody anything they did not have one vehicle at a time. It requires `confirm: true`, so the request that destroys data is not one character from a harmless one, and it is a `POST` because it carries a body. `MAX_PAGE_SIZE` at 100 remains a server-side cap on a client-supplied parameter, not a suggestion. Adding `title_status` to the CSV exposed a latent collision: `style` was claimed by both `trim` and `body_type`, and `body_type` silently won because it is declared later — a feed whose `Style` column meant the trim would have had it written into the body type. The alias table now throws at module load on any duplicate, and `style` is claimed by neither, so a dealer is told the column was not recognised rather than having it guessed at. The same review found that `VehicleDocument.issuedOn` had been wired into the update path but not the create path, so a document's date was dropped on a new listing; both now write it.

## D-034 — A Push to `main` Releases Itself, and Nothing Reaches the Server Until a Round Trip Has Succeeded

**Status:** Accepted. Requested in issue #39.

**Decision:** `.github/workflows/release.yml` ends with a `deploy` job that opens an SSH session to the production server and runs the `deploy.sh` that was already there, with the immutable `sha-` tag that run published. No new deployment mechanism, no agent on the server, nothing reconfigured by hand. Before it runs anything, the job proves the connection by executing `echo SSH connection successful`, and when that fails it says which of four things went wrong.

**Rationale:** The manual path was already correct — `deploy.sh` pulls, migrates, rolls and health-checks, and `rollback.sh` undoes it — so the automation is a caller of that script rather than a replacement for it. Keeping it that way is what leaves the manual path and rollback working when the automation is not involved, and means there is one procedure to reason about instead of two that can drift.

The connectivity test exists because of how the first attempts failed. Every way of getting SSH wrong arrived as `exit 255` on the deploy step, which says only "ssh gave up": a wrong key, a wrong host key and a server that is not answering are indistinguishable by exit code. ssh reserves `255` for its own failures and passes any other status straight through from the remote command, which is the one fact that makes "could not connect" separable from "the command failed" — so `rc != 255` is read as a remote failure, and `255` is classified by matching ssh's own wording into host-key, authentication, and connection. The test is a harmless `echo` for the obvious reason: the point is to learn whether ssh works _without_ deploying, and the deploy step is gated on it, so a broken credential now fails on a runner rather than part-way through a migration.

Preparation is four named steps rather than one block. The single block began `mkdir -p ~/.ssh`, and when a later command in it failed the Actions UI marked the step red and showed that first line — which reads as though `mkdir` had failed, sending everyone to look at the wrong thing. A step is red or green as a whole and the UI cannot say which of its commands failed; one step per failure mode is the fix.

**Consequences:** The host key is pinned from `DEPLOY_SSH_KNOWN_HOSTS` and never scanned at deploy time: `ssh-keyscan` on the runner would trust whatever answered on that address, which is precisely the attack — an impostor that replies once is handed a key with shell access to production. Each secret is validated as it is written, with `ssh-keygen`, so an empty or malformed one fails naming the secret instead of surfacing later as a refused login. The only value printed from the key is its _public_ fingerprint, which is not secret and is the one thing that makes "Permission denied (publickey)" diagnosable against the server's `authorized_keys`. Deployments are serialised across every trigger and never cancelled part-way, because a run killed between `prisma migrate deploy` and `compose up` is the worst state this server can be left in. The job never rolls back on its own for the reason `deploy.sh` does not: a failed run may have applied a migration, and starting the previous image against the new schema is how a bad release becomes data loss — the step summary prints the rollback commands for a person to run. Only `main` releases; a `v*` tag still publishes images but is deployed by hand, since a tag can be cut from anywhere. A required reviewer on the `production` environment is how the first automatic run is made to pause for a human, and `documentation/docker.md` § 4.1 says so.

## D-035 — The CARFAX Badge Is One Mark, and Every Segment of It Opens the Report

**Status:** Accepted. Requested by the owner, who supplied the three CARFAX Canada badges to use.

**Decision:** A listing with a CARFAX report draws a single joined badge: the CARFAX Canada mark, followed by a One Owner segment and a Low Kilometres segment where the seller says their report shows them. Two new nullable columns, `Vehicle.carfaxOneOwner` and `Vehicle.carfaxLowKilometres`, carry the claims. The history timeline gains `ACCIDENT_DAMAGE` and `NO_ACCIDENTS` kinds, and the listing page pulls the accident and damage record out above the timeline. This supersedes the clause of [D-033](#d-033--the-vin-is-printed-in-full-and-a-carfax-link-is-checked-before-it-is-trusted) that set the badge in Vintrax's own type rather than reproducing the CARFAX mark; the rest of D-033 stands, including the host validation, which is now load-bearing for three segments instead of one.

**Rationale:** One badge rather than three chips was the explicit ask, and it is also the right reading. Three chips make a buyer weigh three separate signals; one strip says what is true, which is that a single report is making all of these statements. So the segments share one outline, one link and one focus target, and nothing between them is rounded or spaced.

The accident and damage record is the first thing a buyer looks for and it was the hardest thing on the page to find — one red dot in a horizontal run of markers. Lifting the count and the entries above the timeline does not remove them from it; it stops the question everybody asks from requiring that all of them be read.

**Consequences:** A highlight without a report link is refused by the service, for create and update alike, and is refused again at the point of drawing. The badge borrows a third party's authority, and what makes that defensible is that it opens the report the claim came off — a One Owner mark that opens nothing is that authority with the evidence removed. The check lives in the service rather than the schema because only the service sees the merged result of a `PATCH` that ticks the box and sends nothing else. Clearing the link retires the highlights to NULL in the same write, so a claim cannot outlive its evidence: left alone they would sit invisible in the database and reappear the moment a later edit added any link back.

`NO_ACCIDENTS` exists because silence is not a clean report. An empty timeline means the seller typed nothing, and rendering that as "no accidents" would turn missing data into a clean bill of health on the field where that lie is worth the most money. So the listing has three states — records found, none reported, nothing stated — and says the third one out loud. Where a seller enters both an accident and a "no accidents" line the accident wins: a report cannot say both, and of the two ways to be wrong, a clean badge on a car with a recorded collision is the one that costs a buyer money. `ACCIDENT_DAMAGE` and `CLAIM` stay separate because the report keeps them separate; folding them together would make one accident and one unrelated claim look like two accidents.

Two things the owner should decide, neither of which is a technical question. **The marks are CARFAX's**, recreated here in CSS and SVG because Vintrax does not hold their brand assets; using them needs CARFAX's permission, and every line that draws them is in `carfax-badge.tsx` so official artwork replaces a recreation in one file. **And the segments are seller-asserted**, like every line of the timeline — CARFAX issues these badges from their own data, and Vintrax has no integration and checks nothing. The badge opening the report is what keeps that honest, and the seller's form says so where they tick the box, but a buyer who reads the mark as CARFAX's own finding rather than the dealer's would not be reading it unreasonably.

**Not implemented, and it cannot be:** the request asked for the accident and damage information to be _fetched_. There is no CARFAX integration, no API credentials, and a report sits behind the dealer's own paid link; retrieving one would mean scraping a paid third-party product on a customer's credentials. So the dealer records what their report says and the listing publishes it as their account of it, which is how the timeline has always worked and what D-032 settled.

## D-036 — The Report Is Read by the Server, Checked by the Dealer, and the History Box Says Nothing Else

**Status:** Accepted. Requested by the owner, who asked three times for the accident record to be fetched rather than typed; the first two answers were that it could not be done, and the third specified `https://vhr.carfax.ca`, which is what changed the answer.

**Decision:** A CARFAX link must be on `vhr.carfax.ca` and nowhere else. The backend fetches that page, reads its accident and damage section, and stores what it found against the vehicle as `source: 'CARFAX'` history events. The dealer presses a button to read, sees exactly what came back, and ticks a box to publish it. The listing's history block is reduced to two states: the accident timeline plus the CARFAX button, or the CARFAX button alone. No prose either way. Supersedes the clause of [D-032](#d-032--vintrax-does-not-say-verified-about-a-car-it-has-not-inspected) requiring the block to label the timeline as the seller's account — that label existed because the entries were the seller's, and these are not.

**Rationale:** The earlier refusals were right about the wrong thing. "Vintrax cannot fetch from CARFAX" was a statement about reports behind a dealer's paid login, and `vhr.carfax.ca` is not that: it is the _shareable_ report, the address CARFAX gives a dealer to hand to buyers, already published on the listing. Reading it fetches the same bytes a buyer clicking the badge receives. That is a materially different act from reaching into an account, and the distinction is the host.

Pinning to that one host does three jobs at once. It is the only address that holds a report, so it is the only address worth fetching; a `www.carfax.ca` marketing page is a valid CARFAX URL containing nothing about any car. It is most of the SSRF answer, because there is exactly one name to resolve. And it removes a class of phishing link from behind a badge carrying someone else's brand.

**Consequences:** The parser reads markup nobody promised, so the only safe failure is nothing. A page whose accident section cannot be located returns `unreadable`, never an empty result — "no accidents found" and "I could not read the page" look identical to a caller and mean opposite things to a buyer, and an empty `ok` is returned only where the page positively states the vehicle has none. A failed read changes nothing that was already approved, so a network error cannot make an accident record vanish from a listing.

The dealer is the check, and the design puts them where they can be one: they have the report open, and they are the only party who can tell a correct reading from a plausible one. Reading and publishing are therefore separate acts. Between them the records sit unapproved, and the **listing response withholds them** rather than the page merely not drawing them — the API is the disclosure boundary, and anyone can fetch the JSON.

Records are never accepted from the browser. Approval posts a boolean and nothing else; the records are written by the server at the moment it reads the report. Otherwise a dealer could edit them and tick the box, and the listing would carry a line with CARFAX's name on it that CARFAX never wrote. For the same reason `replaceHistory` was scoped to `source: 'SELLER'`: the seller's own editor must not be able to delete or reword what the report said, and before the scoping it deleted every event on every save.

Narrowing the host invalidates links stored under the old rule. A listing holding a `www.carfax.ca` address keeps it in the database but cannot be saved again until the dealer replaces it with the report link. That is the intended outcome — that address was never a report — but it is a real interruption for any dealer holding one, and it is the reason this is worth an announcement rather than a silent deploy.

Two things could not be verified here and need the owner's eyes on a real report. **The parser has never been pointed at a real page**: outbound network is blocked in the build environment, so it is tested against fixtures that prove it fails safely, not that it reads CARFAX correctly. The first real link will say. **And the terms**: an automated read of carfax.ca may not be something CARFAX's terms of use permit, whoever published the link. That is a commercial question, not a technical one, and it is the owner's to answer.

**Amended after the first real report:** it failed exactly the way the paragraph above expected it might — `unreadable`, "no accident or damage section was found," on a page that fetched cleanly. That combination is what a page whose content is drawn by JavaScript looks like from a server: an empty container and a blob of JSON the browser turns into a report, and no accident heading anywhere in the HTML because there is no report in the HTML. The parser now reads a page's embedded JSON (`<script type="application/json">`, a `window.__DATA__` assignment) before it reads rendered text, matched by a fixed set of key names rather than a search for the word "accident" so a feature flag cannot be read as a finding. An empty accident array is still not license to call a vehicle clean — only an explicit accident-free flag is — for the same reason an empty text section was never enough on its own. When neither layer finds anything, the failure now carries a short `diagnosis` (title, word count, heading list, whether the page looks browser-rendered) so the next failure can be fixed from what it says rather than guessed at. Everything in it is already public — it describes a page the dealer publishes to buyers — and it is bounded so a failure cannot dump a report through it.

**Amended after the diagnosis paid off:** it did exactly what it was for. The next real attempt came back `unreadable` again, but this time the diagnosis said why: `headings: Looks like your internet browser isn't supported`. That heading was in the raw HTTP response — text this parser reads before any script could run — which means the server chose to send a static compatibility page instead of the report, and did so based on something in the request itself. The obvious candidate was `User-Agent`: the fetch had been identifying honestly as `Vintrax-CarfaxReader/1`, a string no browser-compatibility check recognises. It now sends a real browser's User-Agent, Accept and Accept-Language headers instead — the same thing every link-preview and read-it-later service already does to read a page the way a visitor would. That is a different act from working around a CAPTCHA, a login wall or a rate limit, none of which this does or is meant to; if one of those shows up instead, the right response is to stop and say so, not to escalate. The specific "browser isn't supported" phrasing is also now its own named failure reason, separate from the general JavaScript-shell guess, because it is a stronger and more specific signal — worth surfacing on its own if it is ever seen again after this fix, since that would mean the site is checking something else. Not yet confirmed working: this sandbox cannot reach the real host to verify, so this is the best-supported fix given the evidence, not a proven one.

**Amended for the edit page:** the report link, its two badges, reading the report, approving it, and the seller's own timeline entries were four separate cards, each with its own heading, one of them repeating the word "CARFAX" for the third time on the page. They are one card now, titled "Vehicle history" to match what it feeds. The three actions underneath stay separate — saving the link, reading and approving the report, and saving the timeline still call three different endpoints, on purpose, so none of them has to wait on or be blocked by whether an unrelated one succeeded — but a dealer working on one vehicle's history now sees one box, not four. The link and its two badges moved out of the listing form entirely: a report cannot be read against a vehicle that has no id yet, so the field was never useful on the create form, and it now saves through the same `PATCH /vehicles/:id` the listing form itself calls, independent of the rest of the vehicle's fields.

Combining the cards surfaced a real bug in the one that stayed a card of its own. The seller's timeline editor loaded every history event `GET /vehicles/:id` returned — seller-typed and CARFAX-sourced alike, because the owner is shown both so they can review a reading before approving it — into its own editable rows. `PUT /vehicles/:id/history` deletes and rewrites only `source: 'SELLER'` rows, so opening that editor and saving without changing anything cloned every CARFAX-sourced record into a second, seller-authored copy: the original survived the delete, and the resubmitted content became a new row. The "Accidents" figure on a listing counts both sources, so a car with two real accidents would read four after one unrelated save. The editor now loads only `source: 'SELLER'` rows, which is the one place that filter has to happen — everywhere else already either wrote `SELLER` unconditionally or read both sources on purpose.

**Amended after the diagnosis was hidden behind a click, and after a second regression:** two things surfaced from actually watching a dealer try this.

The User-Agent fix appears to have done something: the second failure came back with the generic "this report is drawn in the browser" reason rather than the specific "browser isn't supported" one, which means the exact compatibility-gate text most likely stopped appearing. But nobody could say more than that, because the diagnosis that would say what replaced it was sitting behind a collapsed `<details>` disclosure that nothing prompted anyone to open. A debugging aid that is not looked at might as well not exist; it is now shown outright, every time, since the one person reading a failed read is always the one who needs it.

Separately, and worse: combining the four CARFAX boxes into one "Vehicle history" card surfaced a genuine regression that had nothing to do with any of this. The buyer-facing timeline had been rewritten in D-036 to show `CARFAX`-sourced entries only, on the reasoning that once a report is read automatically the seller's own notes were no longer what the block was "for". That silently broke a feature that predates CARFAX reading entirely: a seller typing their own timeline and saving it through the editor has always been them publishing it, with no approval step, and after that rewrite those entries stopped reaching buyers at all — discovered when a dealer, working around the CARFAX fetch not working yet, typed two accident entries by hand and found the vehicle history section still empty. The block now shows the seller's own rows unconditionally and CARFAX rows only once approved, concatenated in the order the API already returns them (seller rows start at position 0, CARFAX rows at 1000). Extracted into `visibleHistoryTimeline`, tested directly, since a component this app has no way to render in a test is exactly where a filter like this hides.

**Superseded: the fetch is removed.** The User-Agent fix did not fix it. Pointed at the same real report a third time, the fetch produced the identical diagnosis it had before that fix — `browser isn't supported`, unchanged down to the byte count — which means CARFAX's compatibility gate does not key off User-Agent alone, or keys off something this fetch cannot supply without a real browser behind it (client-side JavaScript execution, most plausibly). At that point the owner asked to drop the feature entirely rather than continue guessing at a third-party page's gate: "forget this read report section and delete only this option and the related code and functions." Removed: the `POST /vehicles/:id/carfax/read` and `PATCH /vehicles/:id/carfax/history` endpoints, both service methods behind them, the entire fetch/parse module (`carfax-report.ts`) and its test suite, the `CarfaxReadResult` contract type, the `approveCarfaxHistorySchema`, the `carfaxHistoryApproved` and `carfaxFetchedAt` fields from `VehicleSummary`/`VehicleDetail`, and the read/approve UI from the edit page. The `historyEvents` mapper filter that withheld an unapproved `CARFAX` row is simplified to unconditionally drop any `source: 'CARFAX'` row — nothing writes one anymore, but a listing that went through a prior successful read still has one sitting in its database, and it must not resurface unreviewed now that the review step is gone.

Left alone, deliberately: the `carfaxUrl`, `carfaxOneOwner` and `carfaxLowKilometres` fields and their badge, `isCarfaxUrl`/the `vhr.carfax.ca` host restriction from D-034, and the seller's own manual timeline editor from D-032. None of those ever depended on the fetch working — the link and badges are the seller's own claims with the report as their evidence, same as before D-036 introduced fetching, and the manual editor is how a timeline reaches a listing now that nothing else does. The underlying `carfaxHistoryApproved`/`carfaxFetchedAt` database columns and the `CARFAX` value in the history-source enum are left in place rather than migrated away, consistent with this project's practice of not making schema changes beyond what a task asks for; they are simply never read or written by any remaining code path.

**Superseded by [D-047](#d-047--the-fetch-comes-back-behind-a-real-browser).** The owner asked to try the fetch again, this time reading the report with a headless browser rather than a raw HTTP request — the User-Agent fix in the amendment above was the best-supported guess available at the time, not a confirmed one, and a real browser is what that guess was reaching for. D-047 is not a reversal of the reasoning here: the diagnosis-first design, the refuse-rather-than-guess parsing rule, and the seller/CARFAX source split all carry forward unchanged. What changed is the transport underneath them.

## D-037 — The Footer Is Operator Content, Not Code

**Status:** Accepted. Requested in issue #43: "in footer of page impliment this pages and function same as this picture. About us Resources Partners Stay in touch. admin user should able to modify all this section in panel."

**Decision:** The hardcoded "Marketplace / Sell / Platform" footer nav is replaced with an ordered list of sections — "About us", "Resources", "Partners" and "Stay in touch" by default — each holding an ordered list of links, editable from `/admin/footer` and read publicly at `GET /admin/footer`. A link is a label, a destination (a site path, an `https://` address, a `mailto:` or a `tel:`) and an optional social icon for "Stay in touch". `PUT /admin/footer` replaces the whole thing at once, the same shape `PUT /vehicles/:id/history` already uses: the caller holds the ordered list, order is a array position rather than a field to keep in sync, and a section is simply missing from the next save rather than deleted through its own call.

**Rationale:** This follows the pattern `BodyTypeImage` and `Article` already established for "operator edits a piece of content that renders on a public page": a plain table, a `content:manage`-gated write, a `@Public()` read cached in Redis and invalidated on write, and an audit log entry. Two tables (`FooterSection`, `FooterLink`) rather than one JSON blob, because `position` on each is what lets a link move without the client renumbering every sibling, and a real foreign key with `onDelete: Cascade` means a deleted section cannot leave orphaned links behind.

The attached mockup could not be read in the environment this was built in — image attachments and outbound fetches to reference sites are both blocked from the sandbox — so the default content seeded by the migration (a plausible About us / Resources / Partners / Stay in touch split, pointing at real pages where one exists and `mailto:` otherwise) is a placeholder the owner confirmed is fine to ship and edit afterward, not a transcription of the actual image. The three example fields named in the issue — "contact instagram facebook" — are exactly what an administrator can set today: any link can carry a `FACEBOOK`/`INSTAGRAM`/`EMAIL`/etc. icon, chosen independently of where the link actually goes, the same trust an administrator already holds over every other field on the site.

**Consequences:** The footer's link labels and section titles are no longer translated — the old dictionary-backed section titles (`t.footer.marketplace`, etc.) are gone along with the hardcoded sections, and the new content is plain operator-authored text, one language, the same as an `Article`'s body. A French-speaking visitor now reads the footer's links in whatever language an administrator typed them in. This mirrors how editorial content already works on this site and was not treated as a new gap worth blocking on, but it is a real, deliberate narrowing of the previous bilingual footer nav that a future issue could revisit if it matters enough to justify a per-locale content model.

The three original sections' most-used destinations (browse vehicles, live auctions, seller/dealer registration, the dealer portal) are preserved as seeded defaults, recategorised into "Resources" and "Partners"; the "Platform" section's own-account links (`My account`, `My bids`, `Purchases`) are dropped from the footer, since they require being signed in and already live in the header's account menu — a footer is not the only path to them, so this is a content decision, not a functional regression.

`SiteFooter` takes its sections as a `FooterSection[] | null` prop rather than fetching them itself: it already needs `useT()` and `<LanguageSwitcher>`, which require a client component, and a client-side fetch would show an empty footer for a beat on every page's first paint. `app/layout.tsx` fetches it server-side instead, the same `serverFetch` helper the home page already uses, and passes `null` through on failure — kept distinct from an administrator's genuinely empty footer (`[]`), which renders as just the logo and copyright bar rather than falling back to anything hardcoded.

## D-038 — A Make's Logo Is Set Against the Name, Not an Enum

**Status:** Accepted. Requested in issue #43: "add feturre for adminuser to upload logo pic of Popular makes just show 8 logo."

**Decision:** An administrator can upload a logo per vehicle make from `/admin/make-logos`, overriding the generated mark the home page's "popular makes" row otherwise draws for that make. The row's cap drops from 12 to 8, matching the issue's own words. `MakeLogo` is keyed on the make name lowercased rather than an enum — `Vehicle.make` is free text a dealer types, unlike `BodyType` — and `GET /admin/make-logos` returns only the makes an administrator has actually set a logo for, since there is no fixed set to backfill the way every body type gets a row.

**Rationale:** The row already had a fallback for every make with no administrator logo: `BrandLogo` draws a real trademark from a build-time `simple-icons` extract, or a computed lettermark ("BMW", "LR" for Land Rover) when no icon is on file — so this feature is a third, higher-priority tier ahead of two that already existed, not a first one. It follows the same shape as `BodyTypeImage`: a plain table, a `content:manage`-gated upload/set/clear, a `@Public()` cached read, an audit log entry. `PUT /admin/make-logos/:make` matches its path param case-insensitively for the same reason a dealer's own `make` field is never normalized elsewhere in this codebase — "Toyota" and "TOYOTA" must resolve to the same logo without requiring a data migration of existing listings.

**Consequences:** The admin screen cannot simply map over an enum the way `body-types` does, because there is no enum. It lists every make currently in stock (from the same search-facet aggregate the home page's row itself reads) *and* any make an administrator has already set a logo for — the union matters because a logo set for a make that later sells through would otherwise vanish from the admin screen along with its facet entry, leaving no way to find and remove or replace it. Extracted into `buildMakeLogoRows`, tested directly. The home page's own row stays driven strictly by what is in stock (`buildPopularMakes`): a curated logo decorates a make already on the row, it never adds one that has no inventory, because "Vintrax has that many right now" is the row's whole point — the same promise D-024 built the row on when it chose real photographs and real marks over stock art.

## D-039 — The Blog Gets a Second Home-Page Slot, Not a Replacement for the Masthead

**Status:** Accepted. Requested in issue #43: "in blog area in first page should slide show last 5 blog."

**Decision:** The home page gains a second editorial section, below the recently-listed vehicles and above the value-proposition band: a single-card slideshow cycling through the five most recent published posts (`GET /articles?pageSize=5`), each shown with its hero photo, title, subtitle and date, linking to the post. It sits apart from the existing masthead, which still leads the page with only the single newest post — the masthead is the page's hero band and is `HomeMasthead`'s whole job; the issue's ask was for a *slideshow*, which is a second, different thing, not a request to change what the masthead does.

**Rationale:** Nothing about editorial content needed to change to support this — `Article`/`ArticlesService` already served everything: `GET /articles` returns published posts newest-first, and the `/blog` index page already renders a hero-photo-plus-headline card for exactly this data. The slideshow reuses that same card layout for its active slide, so a visitor recognises it as the same "blog" they'd find at `/blog` rather than a second design language on the same page.

**Consequences:** It advances on its own every six seconds — the literal request was a "slide show" — but stops the instant a visitor's mouse or keyboard focus lands anywhere inside it, via `onMouseEnter`/`onMouseLeave` and React's `onFocus`/`onBlur` (which fire on focus entering or leaving the subtree, the same way `:focus-within` does in CSS). Reading a headline while the image and text under it silently change is worse than one that never moved on its own, and a visitor tabbing through the page must never have their focus carried off to a slide they did not choose to view. Dot indicators double as a jump-to-slide control (`role="tablist"`), and the arrow keys step the slide the same way they already step photos in `VehicleGallery`, for the same reason: someone looking through a short set should not have to aim at a small button every time.

The newest post can appear in both the masthead and the slideshow's first slide — they are not deduplicated against each other. Unlike the `/blog` index page's own lead-plus-rest layout, where the two sit directly beside each other and repetition would be obvious, the masthead and this slideshow are far apart on the page, and the small chance of overlap did not seem worth building cross-fetch coordination for.

## D-040 — Signing In Never Trusts a Stale Destination

**Status:** Accepted. Requested in issue #43: "if a user log out from system dont keep last page when new user loged in... wen a user loged oud after login it shoul see first page," illustrated with switching from an admin account to a dealer account and landing back on the admin page with a permission error.

**Decision:** Web and mobile both stop trusting `?from=`/`?next=` unconditionally after a fresh sign-in. `RequireAuth` writes that parameter when it redirects a signed-out visit to `/login`, and login previously pushed straight to whatever path it named, regardless of whether the account that just signed in could actually reach it. It now only honours that destination when the new account holds the access the destination requires — web's `postLoginRedirect` checks `/admin` against `isAdmin` and `/dealer`/`/auctions/new` against `isSeller`, mobile's checks `/dealer` against `vehicle:write` — and falls back to the home page otherwise. Signing out also now navigates to the home page and clears the React Query cache on both platforms (mobile's logout already navigated home; it did not clear the cache).

**Rationale:** `RequireAuth` was never the gap — on both platforms it already checks the signed-in user's role or permission before rendering a guarded page, and correctly shows an in-place "access required" message rather than the page itself. The gap was one step earlier: nothing between "someone else's stale `from`/`next` sits in this URL" and "log in as anyone" ever asked whether the new session could use it. A shared browser, a bookmarked deep link, or exactly the reported flow — signing out of one role's page and back in as another — all hit the same hole. The fix stays a browser-side convenience, the same as `RequireAuth` itself: the API re-checks every request regardless, so nothing here is a security boundary, only the difference between an explained "you don't have access" and a confusing one on a page the new account was never trying to reach.

**Consequences:** The check is a small, explicit prefix list, not an exhaustive route table — deliberately, since a `from`/`next` it does not recognise at worst lands on a page that only requires being signed in, which login always grants, and the two prefixes covered are exactly the two role tiers each platform's `RequireAuth` enforces today. A new admin-only or seller-only route needs its prefix added here too, the same way `RequireAuth`'s own `adminOnly`/`sellersOnly` props (or mobile's `permission` prop) already have to be added per page — this does not centralise route permissions, it only closes the specific gap between a stale link and a fresh login. `postLoginRedirect` also refuses an absolute or protocol-relative destination outright, which was not exploitable before only because nothing crafted `from`/`next` beyond `RequireAuth` itself, but is cheap to close regardless of who might.

## D-041 — A Saved Search Lives on the Device, Behind a Choice, Not on the Server

**Status:** Accepted. Requested in issue #43's last item: "impliment results from your last search for user. maby its need to impliment cookes... add pop up in fist page for agreement of using cookese for first user visit web site."

**Decision:** The home page can offer to return a visitor to their last vehicle search ("Continue where you left off"), and a banner asks, once, on whichever page a visitor first lands on, whether Vintrax may remember anything about their visit on this device. Declining means nothing is stored and nothing is offered; accepting is what turns the search feature on. Both live in `localStorage`, not an actual `document.cookie` — there is no server-side reason to read either on a request, and every other per-browser preference on this site (theme, result-list layout, locale) already uses it — but the banner still calls it what a visitor would recognise, since to someone reading a consent notice the distinction between a cookie and other on-device storage is not the point.

**Rationale:** The two halves of the request are one feature, not two: a saved search is exactly the kind of thing that needs asking about, and the issue's own wording ties them together ("maybe it needs cookies, if it needs cookies, add a popup"). Nothing about the search itself ever reaches the server — it is read back from the browser's own storage into `summarizeFilters`, a pure function turning `VehicleFilters` into a short label ("Honda · SUVs · British Columbia · Under $25,000"), and handed straight back to `/vehicles` as the same query string the address bar already uses. There is no new endpoint and no user-search-history table, because there is nothing here Vintrax needs to know outside the one browser that ran the search.

**Consequences:** Existing `localStorage` usage elsewhere on the site (theme, the browse page's list/grid preference, the chosen language) is deliberately left ungated by this banner — retrofitting consent onto features that predate this request, and that nobody asked to gate, would be a much larger and riskier change than the one asked for. Declining does not merely stop new writes: it actively clears any search already saved, since a decline is a statement that nothing here should be remembered, not only that no more should be collected from now on. The banner and the card both defer their `localStorage` read to a post-mount effect rather than checking during render, the same reason `vehicles/page.tsx`'s own view-preference state already does — the server has no storage to agree with, and reading it during the first render would make the server-rendered and client-rendered markup disagree. This ships on the web application only; mobile has no equivalent home-page search-resume affordance today.

## D-042 — Compare Is a Client-Side Shortlist, Not a Cookie-Gated One

**Status:** Accepted. Requested in issue #54, "compare two car in feature" — filed with an empty requirements template, then specified in full detail directly in the session that implemented it: pick up to four vehicles while browsing, view them side by side at `/compare`, with a persistent floating indicator and a specification-and-feature comparison table.

**Decision:** A vehicle's id, and only its id, is added to a small `useCompareStore` (Zustand, the same tool `auth-store.ts` already uses for state read from unrelated parts of the tree) backed by `localStorage`, capped at four. `CompareButton` (a compact checkbox on every card/row, a full button on a vehicle's own page), `CompareBar` (the floating tray, mounted globally so it survives navigating between inventory and a listing), and `/compare` itself all read and write the same store, so ticking a card and later opening that vehicle's page shows it already selected with no prop threading between them. `/compare` fetches each selected vehicle's full detail from the existing `GET /vehicles/:id` — one request per id, deduplicated against any other consumer of the same `['vehicle', id]` query key by the query cache already in use everywhere else — rather than adding a batch-by-ids endpoint or a server-side comparison-list table.

**Rationale:** Unlike the last-search feature (D-041), this is not gated behind cookie consent. A saved search is a convenience Vintrax offers to remember; a compare list is the mechanism the feature the shopper explicitly asked for runs on — without it, ticking a second vehicle and finding the first one gone is not "the feature working conservatively," it is the feature not working. That is the "strictly necessary" storage every consent framework already carves out, not tracking, so it is treated like the theme and result-view preferences already stored the same way rather than like the search history D-041 drew the opposite conclusion about.

Feature comparison reads `VehicleDetail.features`, a plain string array a seller typed — there is no fixed feature catalogue behind it. `categorizeFeatures` sorts the *union* of the selected vehicles' own lists into keyword-matched groups (Comfort & Convenience, Technology, Safety, Exterior), omitting any group nothing selected matched, with everything unmatched falling into "Other" rather than being dropped. A feature absent from one vehicle's list is shown as "not listed," never as "not available": the data model has no per-feature flag distinguishing a seller who checked and left something off deliberately from one who simply never mentioned it, and asserting the stronger claim would be Vintrax speaking for a seller who said nothing. "Performance" is deliberately not one of the feature categories, even though it is a common one in this space — engine, transmission, drivetrain and fuel type are already their own rows in the specification table above, real structured `Vehicle` fields, and repeating them as free-text "features" would compare the same fact under two different sections.

**Consequences:** A specification or feature row where every vehicle agrees stays visually quiet; a row that differs gets a subtle background tint *and* a bolder value, never a tint alone, so the distinction still holds for a reader who cannot see it, and each differing row also carries a screen-reader-only "differs across vehicles" note. The specification table and the per-category feature tables both use a `sticky left-0` label column inside their own `overflow-x-auto` wrapper, so only the vehicle columns scroll horizontally on a narrow screen — the same technique, applied to a table instead of a gallery, `VehicleGallery`'s own arrow-key stepping already established for keeping the page itself from scrolling sideways. Reaching the four-vehicle limit does not silently drop the oldest selection or block the control outright; it leaves the list exactly as it was and says why through the same toast every add, remove and clear already uses. `CompareBar` and `CookieConsentBanner` are both rendered inside one fixed-to-the-viewport bottom container in `app/layout.tsx` rather than each independently `fixed`, so the rare visitor who starts comparing vehicles before answering the cookie prompt sees the two stacked instead of overlapping — a small refactor of D-041's banner, not a behaviour change to it. No new Prisma model and no new endpoint: the comparison list lives entirely in the browser, and everything it displays already existed on `VehicleDetail`.
Ships on the web application only.

## D-043 — Seller Notes Gain Structure Without Gaining a New Field

**Status:** Accepted. Requested in issue #55, "Seller Notes" — a dealer feed's `description` arriving as one run-on string, with sections and lists surviving only as a checkmark, a colon, or a capitalised word run straight into the sentence after it, none of which the existing formatter recognised as structure.

**Decision:** `formatDescription` (`packages/shared/src/description.ts`), already the single place both `DescriptionBody` components (web and mobile) turn `vehicle.description` into headings, paragraphs and lists, gains three recognisers rather than a parallel "Seller Notes" formatter: `✔`/`✓` are now bullet characters alongside `•`/`●`/etc; a colon-terminated label is a heading whether it shouts in capitals or is merely title-cased ("Premium Features Include:", "Why This MINI Stands Out:", "Condition:"); and a short capitalised lead-in glued directly to the sentence after it with no punctuation between them ("Manual Transmission If you're looking…") is split into a heading and that sentence, the same way an existing rule already splits a bullet run from the paragraph glued to *its* end. A label can now also be found mid-paragraph, immediately after a sentence boundary, not only at the very start of a chunk — "…iconic MINI styling. Premium Features Include: Turbocharged…" — so a section header is not missed just because the seller never put a line break before it.

**Rationale:** The issue's own list of section names ("Premium Features Include", "Why This Vehicle Stands Out", "Condition", "Additional Information", "Contact Information") is a description of a shape, not a fixed vocabulary — a title-cased phrase of one to eight words ending in a colon, checked the same way the existing `isShouted` heading rule is checked, just without requiring capitals. Widening that one predicate, rather than hand-coding the issue's specific phrase list, is what a `documentation/decision-log.md`-consistent module already argued for in its own docstring: nothing is rewritten, reordered or invented, only recovered from evidence already in the text. A run of feature names with no delimiter at all between them (no bullet, no checkmark, no line break) stays untouched — inventing item boundaries in genuinely undelimited text would be guessing at content, which every existing rule in this file already refuses to do.

**Consequences:** `vehicle.description` and its API contract are unchanged; every existing seller note renders exactly as before unless it contains one of the three new patterns, and the full pre-existing test suite for this module (word-for-word content preservation included) passes unmodified. Both `DescriptionBody` components gained `break-words` so a long unbroken token — a VIN, a URL — wraps inside its container instead of overflowing it, satisfying the issue's mobile-width requirement without a layout change. No rich-text editor, no `dangerouslySetInnerHTML`, and no second formatting implementation were introduced; mobile's `DescriptionBody` already called the same `@vintrax/shared` function web's does, so both platforms picked up every new rule with zero component changes beyond the CSS class.

## D-044 — A Box With Both `min-height` and `aspect-ratio` Also Needs an Explicit Width

**Status:** Accepted. Reported directly: publishing a blog post made the home page render "over size," not fitting the screen, with a photograph involved.

**Decision:** `HomeMasthead`'s band, and the article page's own hero band (`app/blog/[slug]/page.tsx`), both add `w-full` to the element that already carries `min-h-[…]` together with an `aspect-[1920/…]`. The admin editor's masthead-preview placeholder (`article-editor.tsx`, shown before a photograph is uploaded) gets the same class for the same reason, since it shares the identical `aspect-ratio` + `min-height` combination without an image.

**Rationale:** Reproduced with a throwaway local harness (a stub API serving a masthead article, `next dev` against it, Playwright measuring `document.documentElement.scrollWidth` against the viewport at several widths) before touching any code, specifically to find the actual mechanism rather than guess at one from a screenshot. The uploaded photograph's own pixel dimensions turned out to be irrelevant — the image is `absolute inset-0` and only ever fills whatever box the band resolves to. The band itself was the bug: `min-h-[19rem] … sm:aspect-[1920/330] sm:min-h-[20rem]` has no `width` of its own, so its width was left to resolve from context ("auto"). On any viewport where the aspect ratio alone would make the band shorter than its `min-height` floor — every ordinary width from about 640px up to roughly 1862px, which is nearly every laptop, tablet and un-maximised desktop window — the browser satisfies `min-height` for height first, then, per the CSS sizing spec's handling of `aspect-ratio` on a box whose width did not otherwise resolve to something definite, computes *width* from that taller height and the ratio instead of the other way around. That produced a band (and therefore a page) about 580px wider than the viewport at 1280px, and about 1090px wider at 768px — confirmed by inspecting the section's own computed style and comparing it against its parent's actual rendered width. Below 640px the `sm:` ratio class never applies, so the bug never fires on a phone, and above roughly 1862px the ratio alone already clears the floor, so it never fires on a large monitor either — which is exactly the band this went unnoticed in for as long as it did: common laptop and tablet widths sit right in the middle. Setting `width: 100%` explicitly resolves the width from the container as intended, leaving only `height` for `aspect-ratio` and `min-height` to negotiate between themselves, which is the ordinary, harmless case.

**Consequences:** No component's markup or behaviour changed beyond the added class; nothing about the masthead's cropping, upload flow or preview changed for an author. Confirmed with the same harness that the fix holds at 1920px, 1280px, 768px and 375px (zero horizontal overflow from any of these three elements at any of those widths) before removing it — the harness was throwaway and left nothing behind. A pre-existing, unrelated overflow in `site-header.tsx`'s right-hand icon cluster at exactly 768px (confirmed present with no masthead article at all, so unaffected by anything here) was found by the same measurement and is not fixed by this decision; it is a separate header-layout issue for later.

## D-045 — Three Home Page Rows, Trimmed to What They're Actually For

**Status:** Accepted. Requested directly: rename "Continue where you left off" to "Your last search" and show 5 related results with it; cap Popular Makes at 5 instead of 8; remove the "From the blog"/"Read more" header above the blog slideshow.

**Decision:** `ContinueSearchCard`'s heading is now "Your last search," and the card fetches the same filters against `GET /vehicles` (`pageSize=5`) and renders up to five matches as `VehicleRow`s inside the same card, below the existing summary/"View results"/dismiss bar — not a replacement for that bar, since there can be more than five total matches and the visitor still needs a way to see all of them or dismiss the card entirely. `MAX_POPULAR_MAKES` drops from 8 to 5, and the row's grid goes from `sm:grid-cols-4 lg:grid-cols-6` to a single `sm:grid-cols-5`, so five makes fill the row exactly rather than leaving a gap at the wide breakpoint. `HomeBlogSlideshow` drops the header row entirely (both the `title` and `readMoreLabel` props, now unused, and the two now-orphaned dictionary keys) and shows only the slideshow card itself.

**Rationale:** The saved search already existed as a link (D-041); showing the actual vehicles it currently matches — not a stale snapshot, refetched live, since a listing may have sold since the search was saved — turns "here's a link back" into "here's what's still there," which is the more useful thing when the point of the feature is getting a visitor back into the car they were looking at. Popular Makes and the blog slideshow are simplifications with no new mechanism: fewer makes shown, and one fewer piece of copy above a component whose own cards already say what they are.

**Consequences:** `/blog` is still reachable from the header's "Research & advice" menu and from clicking any slide, so removing the slideshow's own header loses no navigation path, only a redundant label. Verified in a running instance (a local `next dev` against a stub API) that all three changes render as intended and introduce no new horizontal overflow, alongside the existing test suite (`popular-makes.spec.ts` updated for the new default of 5).

## D-046 — There Is No Online Checkout

**Status:** Accepted. Requested directly: "remove all buy now and purchase option menu and code. we dont have online buy in the system." Clarified in the same conversation that this also meant stripping order/payment record-keeping out of auction settlement, not only the fixed-price "Buy now" button, and that the buyer- and mobile-facing "Purchases" pages should be deleted rather than kept.

**Decision:** The entire `TransactionRecord`/`Payment` schema, the backend `transactions` module (`/orders` and its four sub-routes), the `payment:read`/`payment:manage` permissions, `calculatePlatformFee` and the platform-fee constants, and every UI surface built on top of them are removed: the "Buy now" checkout button on the vehicle detail page, the dashboard and mobile "Purchases" screens and their nav entries, and the admin "Revenue" page (GMV, platform revenue, take rate — figures with no meaning once nothing charges a fee). `AuctionsService.close()` now marks a won vehicle `SOLD` directly instead of waiting for a winner to call the now-deleted `POST /orders`; `Auction.winnerId`/`winningBidId` are the permanent record of who won and at what price, and nothing further needs completing. A fixed-price sale was already just a listing a buyer messages about — that path is unchanged, only the parallel "or press Buy now and check out online" option is gone. Browsing by sale channel survives under neutral wording ("Fixed price" instead of "Buy now"), since it is a filter on how a listing says it wants to be approached, not a purchase action.

**Rationale:** Every payment/order code path already admitted, in its own comments and in `documentation/security-audit.md`, that it recorded an assertion rather than verifying one — "the seller records that funds arrived, not the buyer," with no gateway, no authorisation hold, and nothing checking the claim was true. Presenting that as a "Buy now" button and an order history was always a promise the system did not keep. Removing it is not a regression in capability, only in the size of the claim the UI makes: a fixed-price listing or a won auction was always, in practice, two people arranging a sale themselves — Vintrax now says so instead of interposing a checkout flow with no bank behind it.

Two analytics surfaces depended on `TransactionRecord` for real business logic, not just display, and needed a designed replacement rather than a deletion: `AdminAnalytics.grossMerchandiseValueCad`/`platformRevenueCad`/`salesSeries` are gone outright (there is no fee to report), replaced by a single `vehiclesSoldThisMonth` count on the admin dashboard; `DealerAnalytics.soldThisMonth`/`grossSalesCadThisMonth`/`salesSeries` keep their exact field names and shape but are now computed from `Vehicle.status = 'SOLD'`/`soldAt`/`priceCad` instead of completed orders, so the dealer dashboard needed no frontend changes at all. The public dealer profile's `completedSaleCount` moved the same way. Three guards in `vehicles.service.ts` (`canViewDocuments`, `setStatus`, `remove`) that checked for a live order were narrowed to what remains meaningful without one: paperwork is visible to the seller and an admin only — a buyer who needs it gets it from the seller directly, since there is no longer any record of who "the buyer" is; a vehicle can leave `SOLD` freely, since there is no order to protect from being undercut by relabelling; deleting a `SOLD` vehicle is still refused in favour of archiving it, now keyed on the status itself rather than a sales record.

**Consequences:** A Prisma migration (`20260919220000_remove_orders_and_payments`) drops both tables, three enums, and trims two now-unused `NotificationType` values (`PAYMENT_RECEIVED`, `PAYMENT_DUE`) that no code path had ever actually emitted. `documentation/transaction-flow.md`, `README.md`, `documentation/frontend.md` and `documentation/mobile.md` are updated to match; `documentation/security-audit.md`'s historical finding about the order-payment authorization bug is left as-is, as the record of a security review actually performed on code that existed at the time, the same way this log marks a decision superseded rather than deleting it. Nothing about messaging, favourites, bidding, or the fixed-price/auction/accepting-offers distinction changed — only the (never-real) promise that a purchase completed inside Vintrax rather than between two people.

## D-047 — The Fetch Comes Back, Behind a Real Browser

**Status:** Superseded by D-048. Requested in issue #49, "carfax timeline" — a long, detailed spec asking for automated extraction of accident dates and the two CARFAX badges from a report link, an independent publish toggle for the resulting timeline, and removal of the manual "What the report shows" checkboxes D-036 left behind. Raised directly with the owner before implementing: this exact feature was built, amended four times, and finally removed in D-036, on the finding that CARFAX's share-link pages render entirely client-side and a raw HTTP request — even carrying a real browser's User-Agent — never received the rendered report, only a static shell or a compatibility gate. Given that history, and that this sandbox's network policy blocks `vhr.carfax.ca` outright (confirmed with `curl`, which the proxy answers with a 403 rather than reaching the host at all), the owner was asked whether to retry with an actual headless browser or leave the manual entry in place; they chose to retry.

**Decision:** `carfax-report.ts` is rewritten around Playwright driving a real headless Chromium rather than a raw HTTPS request — the one part of D-036's design that changes. Saving a vehicle with a `carfaxUrl` that is new or different from what is stored enqueues a `carfax-extraction` job (a new BullMQ queue, following the existing `search-indexing`/`notifications` pattern exactly); the save itself never waits on it. The worker navigates to the link, waits for the page to render, and re-derives everything D-036's text-based parser already knew how to find — the accident/damage section, dated records, an explicit accident-free statement — against the *rendered* HTML, plus two new extractions the manual checkboxes used to ask a seller for by hand: a one-owner claim ("One Owner", or a stated owner count above one read as an explicit no) and a low-kilometres mark. A successful read writes both badges, replaces every `source: 'CARFAX'` history row (never touching `SELLER` rows — the same scoping discipline D-036 established), and records `carfaxFetchedAt`; a failed one writes only `carfaxFetchedAt` and a dealer-facing `carfaxFetchError`, and never blocks saving the vehicle either way. `carfaxOneOwner`/`carfaxLowKilometres` move out of `createVehicleSchema` entirely — they are now written only by the worker, the same way D-036 never let the browser post accident records directly. The dead `carfaxHistoryApproved` column, left in place by D-036 for exactly this kind of return, is renamed rather than replaced: `showVehicleHistory`, a boolean the dealer sets directly, independent of the link and both badges, gating only the `CARFAX`-sourced rows — a seller's own `SELLER` rows are never gated by it, and the badge itself shows regardless. Enforced in `toVehicleDetail` itself, not only in the frontend: a viewer who is not the vehicle's seller or an admin never receives a `CARFAX` row while the toggle is off, and never receives `carfaxFetchedAt`/`carfaxFetchError` at all, the same "the API is the disclosure boundary" rule D-036 established for the approval step this toggle replaces. `carfax-report-reader.tsx` loses the manual "What the report shows" checkboxes outright, replaced by a read-only status (checking / read successfully with what it found / failed with why) and the `showVehicleHistory` toggle.

**Rationale:** D-036's amendments diagnosed the actual failure correctly in sequence — first a generic "drawn in the browser" guess, then the specific "browser isn't supported" gate, then a User-Agent fix for it — and the fix still did not work, identically, on a third attempt. The plain reading of that sequence is that CARFAX's gate does not key off headers alone; the amendment's own words named the next step: "keys off something this fetch cannot supply without a real browser behind it (client-side JavaScript execution, most plausibly)." A headless browser is that missing piece, not a new theory — Playwright drives an actual Chromium that runs the page's own scripts and produces the same DOM a visiting dealer's browser would, which is the one thing every prior attempt in this project's history could not do.

The parsing rules that survive the rewrite unchanged are exactly the ones D-036 fought hardest to get right, because a browser fixes *reachability*, not *honesty*: a parser reading someone else's markup still must fail to `unreadable` rather than invent a finding, "no accidents found" and "could not read the page" still must never look the same to a buyer, and an empty result is still licensed only by the page positively saying so. The badge extraction added here follows the same discipline in a new place — a stated owner count is the only thing that earns a `false` for one-owner; everything else that is not found stays `null`, "not stated," never a quiet "no." One piece of D-036's design was deliberately not carried forward: the embedded-JSON reading path (`<script type="application/json">`, `window.__DATA__` assignments) that its first amendment added to work around a raw fetch never receiving rendered content. A real browser renders the content; reading the DOM `page.content()` hands back after render is what that path existed to approximate, so keeping it too would be two ways of finding the same data with no way to tell which one actually mattered.

**Consequences:** This has not been run against a real report in this environment, for the same reason D-036's own amendments kept saying so: the sandbox this was built in cannot reach `vhr.carfax.ca` at all, headless browser or not. Everything here is verified against fixture HTML standing in for `page.content()` after a render, which proves the parser fails safely on every shape of page that is not a report, not that it correctly reads a real one. The first real link will say, the same as it did for D-036, and if CARFAX's gate turns out to key off something a headless browser also trips — a fingerprint check, a CAPTCHA — the honest next step is the same one D-036 eventually took: stop and say so rather than escalate further.

Running a real browser changed more than one file. The backend's Docker image moved from Alpine to Debian slim (`infrastructure/docker/backend.Dockerfile`), because Chromium is not built for musl libc at all; the runtime stage now installs the browser and its OS libraries with `playwright install --with-deps chromium` as root, before dropping to the unprivileged user, since apt-installed system packages from an earlier build stage do not travel across a `COPY` of an application directory. The Kubernetes API deployment's memory request/limit were raised and a `HOME=/tmp` environment variable added, since the same pods that serve HTTP traffic also run the BullMQ workers that would hold a live Chromium process, and the pod's root filesystem is read-only. Neither change has been built or run against a real container runtime in this environment — there is no Docker daemon available here — so both are reviewed-but-unverified in the same sense the parser itself is, and should be exercised once before being trusted in production. `carfaxHistoryApproved` → `showVehicleHistory` and the new `carfaxFetchError` column ship in migration `20260921000000_carfax_history_toggle`, verified by replaying the full migration history against a local PostgreSQL instance and diffing the result against `schema.prisma`.

## D-048 — Five Badges the Dealer Sets, Not a Browser

**Status:** Accepted. Requested in issue #67 — a large, explicit spec covering the home page and vehicle-history UI, whose Vehicle History section asks for exactly five checkboxes ("Low Kilometer, One Owner, No Accident, Report, CARFAX") the dealer ticks directly, states plainly "Do not require automatic CARFAX scraping for this feature" and "Do not attempt to automatically generate the timeline from CARFAX," and separately reports a browser back/forward navigation bug, asks for a Popular Makes carousel, a new Partner Logos feature (with admin management), and the blog section moved to the top of the home page as a carousel.

**Decision:** D-047's Playwright-driven extraction is removed outright — `carfax-report.ts`, `carfax-extract.worker.ts`, their tests, the `carfax-extraction` BullMQ queue, and the Playwright dependency are all deleted, and `infrastructure/docker/backend.Dockerfile` and `infrastructure/kubernetes/api-deployment.yaml` revert to exactly what they were before D-047 (Alpine base, the pre-D-047 resource limits) — Chromium's own footprint has no remaining reason to exist in this image. `Vehicle.carfaxOneOwner`/`carfaxLowKilometres` (nullable tri-states written only by the worker) and `showVehicleHistory`/`carfaxFetchedAt`/`carfaxFetchError` are replaced by five plain booleans the dealer sets directly through `create`/`update` like any other field: `badgeLowKilometres`, `badgeOneOwner`, `badgeNoAccident`, `badgeReport`, `badgeCarfax`, all defaulting false. `carfaxUrl` survives unchanged, as an associated reference only — nothing reads it. The API exposes the five as one nested `badges` object (`VehicleBadges` in `@vintrax/shared`) rather than five flat fields, which is the "one source of truth" the issue's own data-model section asked for: every badge-drawing surface — the vehicle card, the row, the detail page, search results, and (newly, since nothing drew one there before) the comparison view — reads `vehicle.badges`, not five separately-named booleans each surface would otherwise have had to remember to check.

`VehicleHistoryEvent.source` (`SELLER`/`CARFAX`) is dropped along with the `VehicleHistorySource` enum: with no automatic extraction, every timeline entry is the dealer's own account, so a field distinguishing it from a second source that no longer exists is dead weight, not a cautious thing to keep. The timeline is therefore always shown in full — no more `showVehicleHistory` gate, since there is nothing auto-populated left to gate a dealer's decision to publish. `carfax-report-reader.tsx` (the CARFAX-report status/polling UI) is replaced by `vehicle-badges-editor.tsx`, five checkboxes and the link field, saved synchronously with the rest of the form — no background job, no polling.

The back/forward navigation bug was reproduced directly (a production build against a stub API, driven with Playwright, not guessed at): `vehicle-filter-panel.tsx` computed `facets?.bodyTypes.map(...)`/`facets?.fuelTypes.map(...)`/`facets?.makes.map(...)`, where the `?.` only guards `facets` itself being nullish, not a property on it — a facets object missing a key throws `Cannot read properties of undefined (reading 'map')`, the exact production error text ("Application error: a client-side exception has occurred while loading `<hostname>`," the hostname being `window.location.hostname`, not a special clue). The real backend always returns a complete facets shape today, but the one fetch path in the whole app that does not disable HTTP caching (`packages/client/src/api-client.ts`'s `send()` — `serverFetch` already does, for the same reason) is exactly the kind of gap that lets a browser serve a stale cached response — most plausibly on a back/forward navigation, which is when browsers most readily reuse a cached fetch — from before a deploy changed the API's shape. Both are fixed: the three unguarded `?.` chains take `?? []`, and `send()` now sets `cache: 'no-store'`. Confirmed by reproducing the crash with a deliberately incomplete facets response, confirming the fix stops it, and then driving roughly a dozen real back/forward/direct-navigation/refresh combinations across two vehicles and a filtered search with zero console or page errors.

Popular Makes, the new "Our Partners" section, and the blog row all move onto one new component, `item-carousel.tsx` — a plain `overflow-x-auto` flex row with CSS scroll-snap and `scrollBy`-driven Previous/Next buttons, rather than three hand-rolled sliders. Touch/swipe is the browser's own scrolling, not a tracked pointer; how many items show "at once" is purely each item's CSS width, so the same component serves Popular Makes' and Partners' 4-per-view desktop layout and the blog row's wider cards with no per-carousel JS. It takes pre-rendered `{ key, content }` pairs rather than a render-function prop, because every caller here is a Server Component and a function cannot cross into a `'use client'` component the way `CarfaxBadge` once found out the hard way (issue #37) — the first working version of this component passed `renderItem`/`itemKey` functions straight through and broke the home page outright in production-mode verification before this was caught and redesigned. `MAX_POPULAR_MAKES` rises from 5 (D-045's cap, sized for a plain grid with no way to see more) to 15, matching the facet query's own cap, since a carousel's whole point is holding more than fits and reaching the rest by scrolling rather than hiding it.

Partners are a new `Partner` model — id, name, logoUrl, alt, `enabled` — following `MakeLogo`'s admin pattern exactly (folded into the existing `admin` module, not a dedicated one, matching how make logos, body-type images and the footer are all organized): `GET /admin/partners` is `@Public()` and cached, returning every partner regardless of `enabled`, the same shape `publicMakeLogos` already used; the admin page reads it to manage every row, and the home page's own carousel filters to `enabled` before rendering. `POST/PUT/DELETE /admin/partners` require `content:manage`, and logo uploads go through a new `POST /uploads/partners` following the make-logos/body-type-images upload pattern exactly. `enabled` is the first active/inactive field anywhere in this schema — deleting a partner is a real delete, disabling is the reversible action.

A pre-existing, unrelated bug surfaced by the same overflow measurement this issue's "make the UI fully responsive" instruction called for: `site-header.tsx`'s main nav and its right-hand icon cluster both toggle on at exactly the `md` (768px) breakpoint — the same breakpoint the mobile hamburger disappears at — and together are wider than a 768px viewport, overflowing the page horizontally on every single page, not only ones this issue touched. This is the same bug D-044 found and explicitly deferred ("a separate header-layout issue for later"). Measuring five pages at six widths (375–1920px) found it reproduces identically regardless of page content, confirming it is the header and not anything issue #67 changed; the fix moves the nav/hamburger toggle from `md:` to `lg:` (1024px), which the same measurement confirms is where the content actually fits, and reduces the measured overflow to zero everywhere.

**Rationale:** The issue is explicit and direct: `Do not require automatic CARFAX scraping for this feature`, three times over in different words. That is the owner reversing D-047 through this issue's own text, not a judgment call made here — the same kind of explicit instruction D-036 and D-047 each treated as sufficient authority to make their own reversals. Collapsing `VehicleHistoryEvent.source` rather than leaving it as an unreachable field follows this project's own standing rule that unused code is deleted, not left in place "in case."

The back-navigation bug's root cause was found by reproducing it, not by guessing from the report text — a static read of `vehicle-filter-panel.tsx` alone would not have distinguished "looks safe" from "is safe," since `facets?.x.map()` reads as guarded and is not. Fixing only the frontend guard would have stopped the observed crash but left the underlying gap (the one fetch path that never disables caching) in place for the next API shape change to rediscover the same way; fixing only the cache header would have left a still-latent crash for any other cause of a malformed response. Both were fixed because both are real, independently-justified defects, not because either alone was insufficient to explain the report.

**Consequences:** Migration `20260922190452_manual_vehicle_badges` drops the automatic-extraction columns and `VehicleHistorySource`, adds the five badge booleans, and — since D-047 had briefly run in production, per the deploy logs the owner shared while it was live — carries forward what the extraction actually found before dropping its columns: `carfaxOneOwner`/`carfaxLowKilometres = true` becomes the matching new badge, and a vehicle with any `carfaxUrl` on file has `badgeCarfax` set, rather than silently discarding a real reading. Existing `CARFAX`-sourced timeline rows are kept, not deleted, losing only their (now-meaningless) source tag — the accident record they describe was real evidence, whatever wrote it down. Verified against a real local PostgreSQL instance: migration applied, `prisma migrate status` reports up to date, and the full backend and frontend suites (297 and 132 tests respectively) pass, alongside typecheck, lint, and a production build and live-instance exercise of every new and changed surface — the home page's three carousels, the admin partners page, the vehicle-badges editor, the vehicle detail page's badge strip, and the back/forward navigation fix — via a stub API and a headless browser, at both desktop and mobile widths. Migration `20260922191902_partners` adds the `Partner` table, verified the same way. Nothing here has been exercised against real traffic or a real deploy, the same caveat D-047 itself carried.

## D-049 — Vehicle Photos Are Rendered Once at Upload

**Status:** Accepted. Requested in issue #74 ("vehicle image optimization pipeline"), which asks for WebP (AVIF optional) responsive variants generated inside the current Docker/filesystem architecture, a storage abstraction ready for a later Google Cloud migration without implementing it, a backfill command for existing photos, `srcset`/`sizes`/`<picture>` on the frontend, and explicitly no new infrastructure.

**Decision:** Every vehicle photo — a dealer's upload through the web form, the mobile app, the per-vehicle endpoints, or a photo the CSV feed importer downloads — goes through one pipeline in a new `vehicle-images` module: `ImageProcessor` (sharp/libvips; framework-free, buffer in, buffers out) validates the file by its bytes and renders WebP at 320/640/960/1440/1920 px, never upscaling, from a single decode; `VehicleImagesService` records a `VehicleImageAsset` row (`PROCESSING` → `READY`/`FAILED`), stores the variants publicly under `vehicles/{assetId}/{width}.webp` and the untouched original privately under `vehicle-originals/{assetId}/`, and returns the renditions. Storage goes through a new six-method `ImageStorage` interface (`save`/`read`/`exists`/`delete`/`getPath`/`keyFromUrl`) with `LocalImageStorage` — what production runs — and `S3ImageStorage`, which exists only because `STORAGE_DRIVER=s3` was already supported. The API adds `optimized` to each `VehicleImage` and `primaryImage` to each summary, both additive: `url`/`primaryImageUrl` keep meaning "one displayable URL," which for a processed photo is now the 960 px WebP instead of the original. The frontend draws every vehicle photo through one `OptimizedImage` component per app — `<picture>`, `srcset`, `sizes` from one `IMAGE_SIZES` table, `width`/`height` from the real aspect ratio, lazy everywhere except the vehicle page's main photo (eager, `fetchpriority="high"`). `images:migrate` (`--dry-run`, `--limit`, `--vehicle-id`) backfills pre-pipeline photos through the same `ingest()` and never touches an original.

Processing is synchronous in the upload request, not on the BullMQ queue this project already has. The uploader has to hear "this is not a photo" on the spot, and the add-vehicle form needs the processed URL to preview and to save the listing with. At about a second per camera photo (measured inside the production container) with a per-process concurrency cap (`IMAGE_PROCESSING_CONCURRENCY`, default 2), that cost is bounded. `ImageProcessor` has no dependencies to untangle, so moving `process()` onto the queue later is a change to one class.

AVIF is supported and verified inside the Alpine image, but **off by default** (`IMAGE_AVIF_ENABLED=false`). Measured on a 6000 px photo: at encoder effort 4 it is 13% smaller than WebP but takes ~22 s instead of ~0.7 s; at effort 2 it is ~5% smaller for ~3× the time. Neither fits in an upload request. HEIC is not supported: the bundled libvips cannot decode HEVC, a custom libvips build is exactly the "complicated dependency solely for HEIC" the issue warns against, and browsers already convert iPhone photos to JPEG on upload.

The processed-photo record is its own table, not columns on `VehicleImage`, because the two have different lifetimes: a photo is uploaded and processed before its listing exists, and `VehicleImage` rows are deleted and re-created on every listing save. The issue's suggested `uploads/vehicles/{vehicle_id}/{image_id}/` path is adapted to `vehicles/{asset_id}/` for the same reason — there is no vehicle id at upload time. A listing save links a URL to its asset only for the photo's uploader, an administrator, or a listing already using it, so one seller cannot adopt, and later delete, another's upload by its URL. Files are deleted when no listing uses the asset any more, after the detaching write commits; replacing a photo stores the new one before the row moves to it.

Two fixes ride along because this work sat directly on top of them. `make-logos` and `partners` were never added to the API's allowlist of publicly served upload folders when those features shipped (#43, #67), so every uploaded make or partner logo 404ed in every deployment — the owner's broken Hyundai logo, which the Kubernetes ingress change in #71 could not have fixed. Both are added. And no multipart endpoint had a size limit: multer's default buffers a file of any size in memory. Every upload is now capped at the larger of `MAX_UPLOAD_BYTES` and `IMAGE_MAX_UPLOAD_BYTES` and one file per request, with nginx and the ingress raised from 12 MB to 16 MB so the API's own limit (15 MB, the issue's figure) is reachable.

**Rationale:** Doing the resize once at upload, rather than per request (Next's image optimizer, or an image CDN), matches the issue's constraint of no new infrastructure and makes every rendition a static file with an immutable URL: the API serves `/uploads/vehicles/` with `Cache-Control: public, max-age=31536000, immutable`. That is safe because a rendition's URL can never change content: a new upload or a replacement always gets a new asset id. The mobile app previously re-encoded every photo through `/_next/image` on each size miss; it now uses the pre-rendered files and keeps `next/image` only for photos not yet migrated. Stripping metadata by construction — pixels pass through a raw bitmap — is simpler to trust than a list of tags to remove. The original is kept, but outside the served folders, because it still carries the camera's GPS position.

**Consequences:** Migration `20260923172522_vehicle_image_assets` adds `VehicleImageAsset`, the `ImageProcessingStatus` enum and a nullable `VehicleImage.assetId`; it is purely additive, and every existing photo keeps rendering from its unchanged `url` until `images:migrate` reaches it. The seed data's SVG placeholders are not photos and are reported `skipped-unsupported`. `sharp` becomes a direct backend dependency. It was already in the lockfile, pinned by the root override for Next.js, with the `linuxmusl` prebuilt binaries the Alpine image needs, so the Dockerfile does not change. Verified: 40 new backend tests (processor validation and variants, local storage, the upload/ownership/delete/replace API through real controllers and the real permissions guard, the backfill's idempotence) and 17 frontend tests alongside the existing suites (337 backend, 149 frontend); typecheck, lint and production builds of all three apps. The production Docker image was built and, with networking disabled, turned JPEG, PNG and WebP into WebP, and AVIF when enabled. A real HTTP upload of a 5 MB 6000 px JPEG returned in under a second. Chromium on the vehicle page downloads the 1440 px rendition on a 3× phone and the 960 px one on a desktop, never the original, with zero layout shift. The Docker build here needed the sandbox's proxy CA injected in a scratch copy of the Dockerfile; the committed one is unchanged. Not yet exercised against real production traffic or real dealer photos: the benchmark uses public test photographs and one enlarged to camera size, because this sandbox cannot download from photo sites.

## D-050 — Four Badges, and a Sign-Out That Resets Everything

**Status:** Accepted. Requested in issue #76, a list of five UI fixes from the owner's own use of the site.

**Decision:**

- **Home page.** The blog row's heading becomes "Read stories from Vintrax", and its cards drop the post photo. `BlogCard` gains a `showImage` flag, defaulting to true, so `/blog` keeps its photos.
- **Make logos.** The broken uploaded logo needs no change here. D-049 found the cause: `make-logos` was missing from the API's allowlist of served upload folders. Re-verified in a browser: an uploaded Toyota logo loads on the home page's Popular makes row.
- **Badges.** The "Report" badge is removed from the whole stack: `Vehicle.badgeReport` (migration `20260923175621_remove_report_badge`), `VehicleBadges.report`, the schema field, the mapper, the editor's checkbox, the strip's colour, and the tests. The owner's words: "we dont have this badge in system". It never carried a meaning of its own: the CARFAX badge and the report link already say a report exists. It is dropped rather than folded into another badge, because no other badge means what a dealer ticking "Report" meant.
- **Sign-out.** Signing out now goes to `/login`, and through a full page load (`window.location.replace`), on web and mobile alike.
- **Switching accounts.** Signing in lands on the account's own home page from one helper, `homeForRole`, which the header's Dashboard link also uses: `/admin/dashboard`, `/dealer/dashboard` or `/dashboard`. The dashboard tab row now shows an Admin tab to administrators instead of the dealer tabs.

**Rationale:** The account-switching report ("log out as a dealer, log in as admin, the dashboard still shows the dealer's menu") was not stale state in the auth store, which clears correctly. It was two things, both reproduced in a browser before fixing:

1. **A stale `from` survived sign-out.** Signing out on a dealer page cleared the session. The page's `RequireAuth` then redirected to `/login?from=/dealer/dashboard` before the header's own soft navigation to `/` finished. The administrator who signed in next was sent to that `from`, because `postLoginRedirect` rightly allows admins onto seller pages.
2. **With no `from`, login went to `/dashboard` for every role.** `useIsSeller()` counts administrators as sellers, so an admin's `/dashboard` showed the "Dealer" and "Inventory" tabs.

A full page load on sign-out ends the first. It unloads before any redirect can matter, and leaves no cached query, client router state or component state behind for the next account. Role homes and the admin tab row end the second. The existing `postLoginRedirect` check is kept for the legitimate case of a session that expired mid-page.

**Consequences:** Verified in Chromium against a production build and the real API:

- signing out from `/dealer/dashboard` lands on `/login`, with no `from`;
- signing in as an administrator next lands on `/admin/dashboard`, and `/dashboard` shows Overview, Saved, My bids, Messages, Notifications and Admin, with no dealer tabs;
- signing back in as the dealer restores the dealer's tabs and landing page;
- the badge editor lists four options.

No page errors and no failed upload requests occurred during the run. Backend (337) and frontend (153) suites pass, with four new tests for role homes and sign-out. An older browser tab still showing the five-badge editor would get a 400 naming the unknown field on save; reloading clears it.

## D-051 — Banner Slideshow, Icon Body Types, a Footer After the Reference, Pages and Contact

**Status:** Accepted. Requested by the owner with a screenshot of the footer to follow.

**Decision:**

- **Home banner.** The band across the top shows the five newest posts as a slideshow instead of only the newest. It advances every six seconds, pauses on hover or focus, and does not advance on its own under reduced motion. It has arrows, dots and swipe. Every slide is the existing `HomeMasthead`, and `/articles/masthead` is no longer called by the web app.
- **Body types.** The shortcuts are icons with no tile behind them. A listing's photograph is no longer borrowed for a shape without an uploaded image; the drawn silhouette stands in. `POST /uploads/body-type-images` cuts a car out of a flat backdrop: it floods inward from the edges, so white inside the car survives. A scene, an already transparent image or an undecodable file is stored as sent.
- **Footer.** Drawn after the reference: charcoal `#3f3f3f`, four columns, headings in the body face, social networks as round badges in their own colours, then a rule, two copyright lines and the logo. Sections gain `column`, links gain an uploaded `imageUrl`, and the icon set gains TikTok, Apple and Android. The copyright lines move into the new `SiteSettings` row. The year is added automatically.
- **"When I add a URL it does not work."** An address pasted without `https://`, such as `instagram.com/name`, was refused by the schema, so the footer did not save. It is now normalised, and the editor shows what it will be saved as.
- **Pages.** About us and any other page is an `Article` with `kind = PAGE`, at `/pages/<slug>`. It uses the same editor, its photograph is optional, and it is never on the blog. `heroImageUrl` becomes nullable for that reason; a post still requires one.
- **Contact.** `/contact` shows the address, phone, email, hours and map set under Admin → Contact. The map is an uploaded image, or a Google map of the address without one. The form is throttled to 5 a minute and has a honeypot. Messages are stored in `ContactMessage` and emailed with the sender as Reply-To, so a mail outage loses nothing, and the admin screen lists them.

**Rationale:** Reusing `Article` for pages gives the owner "a page like blog with photo, not on the blog" without a second editor, upload route and body renderer to keep in step. A column number, rather than CSS flow, is the only way to reproduce the reference's stacked third column predictably. The upload-folder allowlist has now missed new folders twice, first make and partner logos and then, during this change, footer icons and the Contact map. It moves to `public-upload-folders.ts`, with a test that fails when an upload route writes to a folder it neither serves nor lists as private.

**Consequences:**

- Migration `20260924000000_site_pages_contact_footer` is additive. It adds `ArticleKind`, `Article.kind` (default `POST`), a nullable `heroImageUrl`, `FooterSection.column`, `FooterLink.imageUrl`, three icon values, `SiteSettings` and `ContactMessage`.
- The migration seeds the settings row, a published About us page, and a Customer Support section with a Contact link. It repoints the seeded "About Vintrax" and "Contact us" links only where they still hold their seeded values, so an administrator's edits are never overwritten.
- Existing body-type uploads keep their backgrounds until re-uploaded.
- Verified in Chromium against production builds and the real API:
  - the banner advances and the arrows work, with hidden slides inert;
  - the footer renders at `rgb(63, 63, 63)`, and pasting `instagram.com/myvintrax` saves as `https://instagram.com/myvintrax` with an uploaded icon drawn in its badge;
  - an About us photograph appears on the page, and the page is absent from the blog;
  - Contact settings and map render;
  - a submitted message is logged as an email with Reply-To and appears in the admin inbox;
  - a body-type upload on white is stored as a PNG whose corner is transparent;
  - a phone-width page has no horizontal overflow.
- Backend (378) and frontend (157) suites pass.

## D-052 — Admin List Controls, Quick Price Edit, Phone Reveal and Home Feature Blocks

**Status:** Accepted. Eight requests from the owner.

**Decision:**

- **Research & advice menu:** post titles only, no photos.
- **"Read stories from Vintrax":** title and standfirst only, with no date or author (`BlogCard` gains `showMeta`).
- **Footer:** the header's black (`bg-header`). The language switcher is removed from it; the header's FR / EN toggle is on every page.
- **Admin lists:** moderation, dealerships, users and blog get "Select all on this page" and 10 / 20 / 50 / 100 per page, remembered per list in the browser. The dealer inventory uses the same sizes. All of this is in one shared `list-controls.tsx`.
  - Bulk actions: verify dealerships, activate or suspend users, and publish, unpublish or delete posts.
  - Rejections stay one at a time, as in moderation, because each carries its own note.
  - Users can only tick accounts the administrator may act on.
  - The blog list gains paging it did not have, and its "on the home page" badge now marks the five banner posts.
- **Phone number on a listing:** "Show phone number" under "Send message".
  - Signed out, it leads to sign-in and back to the listing.
  - Signed in, it calls `GET /vehicles/:id/contact` and shows the dealership's phone, or the seller's own, as a `tel:` link.
- **Quick price edit:** "Edit price" beside "Edit" in the dealer inventory.
  - A changed price keeps the one it replaced in `Vehicle.previousPriceCad`, set by the edit form, the quick edit and the CSV import through one helper.
  - The old price is shown struck through above the new one on the inventory, cards, rows and the listing page.
  - Saving an unchanged price writes nothing.
- **Home feature blocks:** any number, stacked under "Recently listed". Each has a title, text, an optional photo and an optional button to a page here or a website over https.
  - The button goes under the text (left, centred or right) or over the photo.
  - Admin → Home features adds, edits with a live preview, shows or hides, reorders and deletes them.
  - They are a separate model, so they never reach the blog, the banner or the Research menu.

**Rationale:**

- **The phone number is not in the listing payload.** Otherwise anyone crawling the catalogue could collect every seller's number. It sits behind sign-in and a 20-a-minute limit, and a listing the viewer cannot see answers 404.
- **Bulk admin actions loop the existing per-row endpoints.** Each row is already audited and permission-checked there, and admin lists top out at 100 rows.
- **Home feature blocks get their own model.** Their buttons go to other websites, which the blog's internal-only button rule forbids.

**Consequences:**

- Migration `20260924120000_home_features_previous_price` is additive: `Vehicle.previousPriceCad`, `HomeFeature` and its placement enum. The `home-features` upload folder is served publicly, and the folder test covers it.
- Verified in Chromium against production builds and the real API:
  - two feature blocks created, one with its button on the photo, reordered, and rendered in that order under Recently listed;
  - the four admin lists show the new controls, and 10 per page lists 10 users;
  - a quick price edit shows the old price struck through in the inventory and on the listing;
  - "Show phone number" signed out returns to the listing after sign-in, then shows "North Shore Motors: 604-555-0142";
  - the footer's background matches the header, `rgb(5, 5, 5)`;
  - the Research menu has no photos, and the stories row has no dates.
- New backend and frontend tests cover the phone lookup, the previous-price rule, the feature-block schema and service, and the bulk runner.

## Decision Log Rules

1. Assign the next sequential identifier to every significant approved decision.
2. Record the decision, rationale, status, and important consequences.
3. Do not delete superseded decisions. Mark them as superseded and reference the replacing decision.
4. Keep exploratory ideas and unresolved questions outside this log until a decision is approved.
5. Update related project documents when a logged decision changes their direction.

## D-053 — Dealer Portal: Inventory Table, Vehicle Costs and a Help Assistant

**Status:** Accepted. Requested by the owner.

**Decision:**

- **Inventory** (`/dealer/inventory`) becomes a table on desktop and cards on phones, with stats cards, search, filters (status, make, model, year, price, source), sort, row actions (view, edit, costs, duplicate, delete, a menu for status moves, price and auctions), and a selection bar (change status, unpublish, export CSV, delete). "Select all N matching" fetches the ids from the server; bulk actions run in the existing 200-id batches.
  - A new server route lists inventory with the private fields the public summary lacks (VIN, stock number, source, cost total). Writes stay on `/vehicles`.
  - `Vehicle.source` (`MANUAL` or `CSV_IMPORT`) records where a vehicle came from, backfilled from past imports' stored row outcomes.
  - "Upload CSV" opens the existing validate → preview → confirm flow in a modal; the import page keeps it too. Both gain a downloadable error report. A row with a stock number but no VIN now carries a "Missing VIN" warning.
- **Costs**: a `VehicleCost` table, many per vehicle, in integer cents, in twelve categories. Totals and gross margin are computed on the server with one shared function; gross margin is the asking price less total cost, and is labelled an estimate, not profit.
- **Help assistant**: a button on every dealer portal page. Answers come from a written help library covering only features that exist; a question it does not cover gets "I’m not sure about that. Please contact Vintrax support."
  - With `AI_PROVIDER=anthropic` and `AI_API_KEY`, Claude phrases the answer from the same library; without them, or if the call fails, the best-matching article is the answer.
  - The provider sits behind a `HelpModel` interface, chosen at start-up. The key is read on the server only.
  - Conversations are not stored; the browser sends the last eight turns.

**Rationale:**

- **Costs are owned through the vehicle, not a copied dealer id.** Every query filters on `vehicle.sellerId`, so a cost cannot drift from the dealer that owns the car.
- **Costs are the dealer's alone.** Administrators get no cost route, and the audit log records that a cost changed but not its amount.
- **The assistant cannot leak dealer data because it is given none.** It receives only the caller's dealership name and page; it has no tools and no inventory access, and a test fails if it touches vehicles or costs.

**Consequences:**

- Migration `20260928000000_dealer_costs_and_source` is additive: `VehicleSource`, `VehicleCostCategory`, `Vehicle.source`, `VehicleCost` (cascade on vehicle delete, set-null on the recording user), a positive-amount check, and indexes on the new lookups.
- New settings: `AI_PROVIDER` (default `none`), `AI_API_KEY`, `AI_MODEL` (default `claude-opus-5-5`), `AI_TIMEOUT_MS`. The API refuses to start with a provider but no key.
- The CSV quoting helpers move to `@vintrax/shared` so the browser's error reports escape formulas as the API's exports do.

## D-054 — Video in the Home Page Boxes, Not a Reel

**Status:** Accepted. Requested by the owner, replacing an earlier idea of a separate vertical video reel.

**Decision:**

- A home page promo tile ("Home page box") shows an image **or** a video. `PromoTile.mediaType` (`IMAGE` by default) chooses; `videoUrl` and `videoPosterUrl` hold the video.
- The tile's existing layout — width in twelfths of the row, height, slot, and how it scales — applies to both, unchanged. There is no video layout, no reel section and no fixed aspect ratio: the video fills exactly the box the photo would, cropped the same way (`object-cover`, the only fit the tiles have).
- `PromoTileRow` draws the same box for both; only the media inside differs (`TileMedia` → `<img>` or `PromoTileVideo`).
- The admin chooses Image or Video in each box's existing editor. The width and height controls and the live preview are the ones that already existed.
- Videos are re-encoded on upload with ffmpeg (H.264, CRF 26, no audio or metadata, at most 1920 px wide, 30 s, `+faststart`) and a WebP poster is taken. The original is deleted, never stored.
- On the page: muted, looping, inline, no controls. `preload="none"` with the poster, so nothing downloads until it plays; an `IntersectionObserver` plays it when a quarter is on screen and pauses it otherwise; reduced motion shows the poster only; a failed video falls back to the poster, then the tile's photo.

**Rationale:**

- **One box system.** The tile already owns size, span, order and responsiveness; a second layout for video would drift from it.
- **Optimise on the server, once.** A phone clip is tens of megabytes; the stored file is a few. Stored through `StorageService`, so the URLs move to S3 or a CDN with the images.

**Consequences:**

- Migration `20260929000000_promo_tile_video` is additive: every existing tile becomes an `IMAGE` tile exactly as before.
- The API image installs `ffmpeg` (`apk add ffmpeg`); `FFMPEG_PATH` overrides the binary. Without it, video uploads answer 503 and nothing unoptimised is stored.
- The video route accepts up to 100 MB. The example Nginx config gives that one route a 101 MB body limit; the Next.js proxy's body limit is raised to match (it kept only 10 MB, which also cut off photos between 10 and 15 MB).

## D-055 — Promo Videos Upload in Pieces and Optimise in the Background

**Status:** Accepted. Follows D-054, after the first real upload failed.

**Decision:**

- The admin page sends a promo tile video in 8 MB pieces (`PROMO_VIDEO.chunkBytes`) to `/uploads/promo-tiles/video/sessions/…`, appended in order to one temporary file. Each piece is checked for order and size, and the total against the announced size.
- Completing the upload starts optimisation in the background and returns at once; the page asks for the status every two seconds and shows upload progress, then "Optimising…".
- The API client turns a non-JSON error page into a sentence (413: file too large for the server; 502/503/504: took too long) instead of `Unexpected token '<'`.
- The example Nginx config's special 101 MB location for video is removed: no request is larger than 8 MB now. The Next.js proxy limit only needs to cover a 15 MB photo.

**Rationale:**

- **The first upload hit Nginx, not the API.** The live proxy refused the body with an HTML 413, which the page could not read. Changing every proxy in front of the API is a deploy step someone forgets; pieces work under any sensible limit.
- **Encoding outlasts a proxy's patience.** A 30-second 1080p clip takes long enough on a small server to meet a gateway timeout. Polling holds no request open.
- **Sound stays out.** The optimised file has no audio track at all (ffmpeg `-an`), and the page plays it muted — there is nothing to hear even if a browser ignored `muted`.

**Consequences:**

- Upload sessions live in the API process and its temporary directory: at most 3 per administrator and 12 in total, deleted after an hour idle, and lost on restart (the page then says to start again). The API runs as one instance; several would need the sessions in shared storage.
- `POST /uploads/promo-tiles/video` (one request) remains for small files and scripts.


## D-056 — Budget Search Without a Province, Every Similar Car, and a Google Maps Link on Contact

**Status:** Accepted.

**Decision:**

- **Budget tool.** "Shop cars under $X" searches all of Canada. The province picked in the calculator sets the sales tax only; it no longer becomes a search filter. The button counts the cars under the budget (`/vehicles?maxPrice=…&pageSize=1`, once the figure stops moving) and, when there are none, says so and offers the most affordable cars instead of an empty results page.
- **Car value tool.** A "Similar cars on Vintrax" list appears as soon as a year, make and model are entered — kilometres are not needed for it — from the new `GET /car-value/similar`. It holds every public listing of that make with a model starting with the one typed ("Civic" finds "Civic Hatchback"; "3" does not find "CX-30"), within three model years, closest year first, then the same trim, then the nearest kilometres, 20 to a page. It replaces the six closest cars shown under an estimate, and it also shows when there are too few cars to estimate a value.
- **Contact page.** Administrators paste a Google Maps link (`contactMapUrl`): a share link, a place or search link, or the code from Share → Embed a map. The page shows it as a live map in a box with the address and an "Open in Google Maps" link, ahead of an uploaded map image and the map drawn from the address.

**Rationale:**

- **The province emptied the budget search.** Ontario is preselected, so every car listed in another province was hidden; with little inventory near the budget in one province, the page came up empty.
- **"Similar" should mean all of them.** Six cars, shown only after a value was worked out, hid most of what is listed. Matching the start of the model name keeps half-typed and short names ("r", "3") from pulling in unrelated models; "Open in search" uses the vehicle search, which matches anywhere in the name and so can show a few more.
- **Google refuses to be framed except through its embed addresses.** A place or share link in an iframe shows an error. The page reads the place out of the link (its pin coordinates, name or search) and frames an address it builds on `www.google.com/maps`, so a pasted link never decides what loads in the frame.
- **Share links need the server.** `maps.app.goo.gl` links say nothing about the place until followed. The API follows them once, on save, by hand and only through Google's own hosts, and stores the full link.

**Consequences:**

- Migration `20260930000000_contact_map_url` adds one nullable column.
- Saving a share link needs outbound HTTPS from the API to `maps.app.goo.gl`; without it the save answers 400 and asks for the full link or embed code.
- `VehicleValueEstimate.comparables` is still returned but no longer drawn by the web page.

## D-057 — Adding a Vehicle: VIN First, One Page of Sections, and a Side Panel

**Status:** Accepted. Modelled on the dealer flow of the large Canadian marketplaces, at the owner's request.

**Decision:**

- **Step 1 is a VIN.** `/dealer/add-vehicle` opens on a card with two tabs: _VIN_ (checked as it is typed, including the check digit, then decoded through `GET /vin/:vin`, which shows the style and "You've entered a 2000 Honda CR-V") and _Make & Model_ for a vehicle without one. "Add the car manually" skips to the form.
- **Then one page of nine sections** — VIN & model\*, Features, Condition\*, Equipment, Transmission & engine\*, Image & video, Description\*, Price\*, Listing quality — with a vertical timeline beside it. Each section shows a tick when complete, a red "!" while a required part is missing or wrong, and otherwise its number; the section on screen is marked, and a click scrolls to it. On a phone the timeline becomes a row of chips. A bar pinned to the bottom holds Cancel, Save as draft and Publish.
- **Mandatory fields** are marked with an asterisk and checked beside the field: brand, model, year, body style, a VIN _or_ a stock number, province and city, condition and mileage, fuel, drive and transmission, a description of at least 20 characters, and the asking price. A blank headline becomes "year make model trim".
- **New data:** stock number on the form, damage (unknown / yes / no), owners, availability, additional warranty, manufacturer colour name, curb weight, horsepower, a YouTube video, colour swatches for the existing colour fields, a grouped equipment catalogue (stored in `features`, so older listings keep theirs), and five reference prices.
- **The same form edits a listing**, filled in from the saved vehicle; the old one-card form is gone.
- **The inventory opens a side panel** when a row is clicked (`?open=<id>`): photo with photo, document and view counts; stock number, VIN, condition, mileage, transmission and year; tabs for the standard view (price with an edit pencil, reference prices, listing quality with tips), performance (views, saves, days in stock and live) and a competitor analysis (the same car elsewhere on Vintrax, from `/car-value/similar`, with where the price sits against the median); print a window sticker, use as template, costs, delete; an Active switch; View listing and Edit. The table gains a Quality column.

**Rationale:**

- **Dealers type seventeen characters, not a dozen fields.** vPIC is free, public and authoritative for North American VINs; its answers never change, so each is cached for a month.
- **One page, not a wizard.** A dealer moves around a listing, fixing a price here and a photo there; a timeline shows at a glance what is missing without hiding the rest behind "Next".
- **Reference prices stay private.** Invoice and wholesale figures are commercially sensitive; buyers see the asking price only, and the detail response carries the others only for the seller and administrators.
- **Honest labels.** Publish submits the listing for review — Vintrax listings go live once approved — and the footer says so. The quality score is a transparent formula, not "AI". There is no manufacturer paint catalogue, so the maker's colour name is typed rather than picked.

**Consequences:**

- Migration `20261001000000_vehicle_listing_details` adds nullable columns and one enum; nothing existing changes.
- The API needs outbound HTTPS to `vpic.nhtsa.dot.gov` for VIN decoding. Without it the decoder answers 503 and the dealer continues with the make and model.
- "Save as draft" still needs the fields the server requires of any listing; a half-filled draft is not stored.
- Not built: automatic photo ordering, a "Just listed" tag, and OEM colour lists, which need data Vintrax does not have.

## D-058 — Security, Performance and SEO Audit Hardening

**Status:** Accepted. The findings, measurements and remaining risks are in `docs/SECURITY-PERFORMANCE-AUDIT.md`, `docs/SECURITY-REPORT.md` and `docs/PERFORMANCE-REPORT.md`.

**Decision:**

- **Sign-in:**
  - Unknown emails are compared against a real cost-12 bcrypt hash. The old literal was malformed, so it answered at once and revealed which emails have accounts.
  - Ten failures in fifteen minutes lock sign-in for that account. The counter is kept in Redis under a hash of the email, and the lock fails open if Redis is down.
- **Tokens:**
  - JWTs are verified as HS256 only.
  - A suspended account's access token stops working on every route, not only those that name a permission.
  - A reset link is claimed atomically. A new link supersedes older ones, and using one invalidates the rest.
- **Mail:** in production the log driver records only that a message was not sent. It never logs the body, which carries reset links, or the recipient.
- **Uploads:**
  - Stored files must match their declared type by magic bytes.
  - FFmpeg reads uploads only as local MP4/MOV or WebM/Matroska files.
- **Web and mobile:**
  - One header set (`packages/shared/next/security-headers.mjs`): a CSP, frame protection, Permissions-Policy (camera allowed only on mobile) and HSTS in production.
  - `X-Powered-By` is off.
  - The image optimiser fetches no remote hosts.
- **Performance and SEO:**
  - Dashboard charts load on demand.
  - `@vintrax/shared` and `@vintrax/client` are marked side-effect free, so pages stop carrying every zod schema.
  - Added robots, a sitemap, canonical links, `metadataBase` (from `SITE_URL`, else `APP_URL`) and schema.org `Car` data built only from what a listing states.
- **Operations:**
  - The demo seed refuses a production database unless `ALLOW_DEMO_SEED=true`.
  - Placeholder JWT secrets are refused in production, and secrets under 32 characters are warned about.
  - Health checks have a 3 s timeout and are not rate-limited.
  - Dependency advisories are cleared (nodemailer 10, vitest 4, overrides for multer, js-yaml and qs).

**Rationale:** each change closes a specific finding without changing an API contract or a screen. Where the fix would have changed architecture (tokens in `localStorage`, a Redis-backed rate limiter, CSP nonces), the risk is documented instead.

**Consequences:**

- Production must set `MAIL_DRIVER=smtp`, or password reset cannot work. With `log` the API now says so in its log.
- An attacker who knows an email can lock that account's sign-in for fifteen minutes at a time. Password reset still works.
- The web container reads `SITE_URL` (compose passes `APP_URL`) for absolute URLs.
- Remote (S3/CDN) photos on mobile are drawn without the Next image optimiser.

## D-059 — "Contact us" Lives Under "About us"; No "Customer Support" Section

**Status:** Accepted, at the owner's request.

**Decision:** Migration `20261003000000_footer_remove_customer_support`:

- points every footer link labelled "Contact us" at `/contact`, whatever it pointed at before, email address included;
- moves anything else in "Customer Support" to the end of "About us", dropping a second "Contact us";
- adds "Contact us" to "About us" if there is none;
- deletes the "Customer Support" section.

**Rationale:** D-056's migration only repointed `mailto:` links it could recognise. The live footer had an administrator's own "Contact us" under "About us", still opening the email app, as well as the seeded section. This migration works from labels and titles, not seeded ids.

**Consequences:** "Email us" under "Stay in touch" stays an email link. An administrator can still add sections from Admin → Footer.
