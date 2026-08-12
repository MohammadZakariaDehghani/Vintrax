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

## Decision Log Rules

1. Assign the next sequential identifier to every significant approved decision.
2. Record the decision, rationale, status, and important consequences.
3. Do not delete superseded decisions. Mark them as superseded and reference the replacing decision.
4. Keep exploratory ideas and unresolved questions outside this log until a decision is approved.
5. Update related project documents when a logged decision changes their direction.
