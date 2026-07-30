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

## Decision Log Rules

1. Assign the next sequential identifier to every significant approved decision.
2. Record the decision, rationale, status, and important consequences.
3. Do not delete superseded decisions. Mark them as superseded and reference the replacing decision.
4. Keep exploratory ideas and unresolved questions outside this log until a decision is approved.
5. Update related project documents when a logged decision changes their direction.
