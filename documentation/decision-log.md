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

## Decision Log Rules

1. Assign the next sequential identifier to every significant approved decision.
2. Record the decision, rationale, status, and important consequences.
3. Do not delete superseded decisions. Mark them as superseded and reference the replacing decision.
4. Keep exploratory ideas and unresolved questions outside this log until a decision is approved.
5. Update related project documents when a logged decision changes their direction.
