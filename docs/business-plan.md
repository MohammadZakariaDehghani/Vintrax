# Vintrax Business Plan

**Prepared:** September 2026
**Status:** Internal strategic planning draft, prepared from a direct inspection of the Vintrax codebase as of this date, plus third-party market research. Not a financial or legal document. See the "How to read this document" note below.

---

## How to read this document

This plan was written by inspecting the actual Vintrax repository — every claim about what the product does is checked against source code, not assumed from a feature list. Three labels are used throughout, and the distinction matters more in this document than the usual business-plan boilerplate, because the request that produced it explicitly asked for the difference to be kept sharp:

- **Fact** — verified directly against the codebase, a cited external source, or public record (e.g., BC dealer licensing rules).
- **Assumption** — a labeled, reasonable estimate used because the real number does not exist yet (there is no revenue, no paying customer, and no production traffic to measure). Every financial figure in this document is an assumption unless stated otherwise.
- **Hypothesis** — a proposal this plan recommends testing, most importantly pricing. Nothing under "Hypothesis" should be read as validated.

**The single most important fact governing this entire plan: Vintrax has no users, no revenue, and no paying customers today.** It is a functionally complete, internally security-reviewed MVP, built and iterated by a single operator with AI-assisted engineering, running against a demo dataset (11 seed users, 23 seed vehicles), with no load testing and no production monitoring in place. Variety Auto, the Vancouver dealership this project is being built alongside, is a *potential pilot testing ground*, not a confirmed or paying customer. Nothing below should be read as evidence of market traction — it is an assessment of what has been built and a proposal for what to do next.

---

## Executive Summary

**Company and product.** Vintrax is a Canadian automotive marketplace and dealer platform, built as a single integrated web application (desktop marketplace), a mobile-first installable PWA, and a NestJS/PostgreSQL backend. It combines four things that, in the Canadian market today, are typically bought as separate products: a public vehicle marketplace (fixed-price and live timed auctions), dealer-facing inventory tools (bulk CSV import, per-vehicle analytics, a moderation-gated publishing workflow), buyer trust tooling (independent inspection reports, an automated CARFAX-report reader, a vehicle comparison tool), and a messaging layer connecting buyers and sellers directly. It is being developed in the context of Variety Auto, an independent dealership in Vancouver, British Columbia.

**Problem.** Independent and small-to-medium Canadian dealers typically stitch together several unrelated tools — a listings site (AutoTrader.ca, Kijiji Autos) for buyer reach, a separate dealer-management system (Frazer, DealerCenter, or an enterprise DMS like Tekion) for inventory and workflow, and manual or third-party processes for vehicle history disclosure — with no single system that does both marketing and inventory management, and with real-time consumer-facing auctions absent from all of them (Canada's major online vehicle auctions, OpenLane/ADESA, are dealer-to-dealer wholesale, not consumer-facing). Buyers, meanwhile, are asked to trust listing claims (accident history, one-owner status) with no verification built into the page they are looking at.

**Solution.** Vintrax's actual, working differentiator is the *combination*: a dealer manages inventory and a public listing in one system, at a lower price point than enterprise DMS platforms, with a consumer-facing live-bidding auction option most competitors in its price tier do not offer, and a CARFAX report reader that automatically extracts the two headline claims (one-owner, low-kilometre) and the accident timeline from a linked report rather than asking the seller to self-attest.

**Target market.** Initial focus: independent and small-to-medium used-vehicle dealerships in British Columbia, expanding to the rest of Canada. Secondary: private sellers, who get free access to the marketplace side without any dealer tooling.

**Business model.** The most defensible near-term model is a SaaS subscription paid by the dealer (not the buyer) — Vintrax has no payment processing today by explicit design (see below), which rules out transaction-fee or marketplace-commission models until and unless that changes. Tiered monthly pricing, benchmarked against the $99–$600/month independent-dealer DMS tier (Frazer, DealerCenter) rather than the $2,700–$7,000+/month enterprise tier (Tekion, Dealertrack, PBS), is the working hypothesis — see Section 8.

**Current product stage.** MVP, feature-complete for its current scope, internally security-audited (see Section 11), pre-revenue, pre-launch, no confirmed production traffic. **One important, deliberate business decision already made and worth stating up front: Vintrax explicitly removed its entire online checkout/payment system in September 2026** (decision D-046), on the reasoning that it recorded a seller's claim of payment with no actual money movement behind it — a promise the product could not keep. A sale today, fixed-price or won-auction, is arranged directly between buyer and seller off-platform, the same way it already worked in practice. This is not a gap; it is a stated position, and it shapes the revenue model directly (see Section 7).

**Key opportunities.** An underserved price/feature gap between basic listing sites and expensive enterprise DMS platforms for the independent-dealer segment; a live pilot relationship available through Variety Auto; a genuinely differentiated live-auction feature at this price point; disciplined, well-documented engineering practice that is unusual for a pre-revenue product and should reduce technical risk during any future due diligence.

**Key risks.** No validated demand — nobody has paid for this yet. The CARFAX automated-extraction feature, a headline differentiator, has never successfully run against a real CARFAX report in the environment it was built in (see Section 3 and Section 11) and may not work as designed on first contact with the live site. No production monitoring exists. Solo-operator dependency. Real legal exposure around automated extraction from a third party's website (see Section 12).

**Objectives.** Short-term (0–90 days): validate willingness to pay with 3–5 pilot dealers, including Variety Auto, and confirm the CARFAX extraction actually works against a live report. Long-term (12–24 months): a paid, retained dealer base in BC with a repeatable sales motion, expanding provincially and then nationally.

---

## 1. Company and Product Overview

### Mission and vision

**Mission (proposed, not yet a formally adopted statement):** Give independent Canadian vehicle dealers one system to list, manage, and sell inventory, with the buyer-facing trust tools — history, inspection, comparison — built in rather than bolted on.

**Vision (proposed):** Become the standard marketplace-and-inventory platform for independent Canadian dealerships, starting in British Columbia.

### Product description

Vintrax today (Fact, verified against source) consists of:
- **A public marketplace** (`frontend/`, Next.js): search with filters and facets, vehicle detail pages, a vehicle comparison tool (up to 4 vehicles side by side), favourites, and direct messaging between a buyer and a listing's seller.
- **A live-bidding auction system**: scheduled and live timed auctions with anti-snipe extension, price-scaled minimum bid increments, hidden reserve prices, and a read-only WebSocket broadcast layer (bids themselves are placed over HTTP, inside a database-serializable transaction, so the same validation and audit path governs every bid).
- **Dealer tooling**: a two-step CSV bulk-inventory importer (preview, then confirm) mature enough to have been iterated against a real 47-row dealer export; per-vehicle and dealership-wide analytics (views, enquiries, units sold, gross sales); a moderation-gated publish workflow, so a listing only goes live after admin approval.
- **Trust tooling**: independent third-party-style inspection reports (10 graded sections, odometer, frame/accident disclosure); a seller-entered vehicle history timeline; and an automated CARFAX report reader that, given a report link, uses a real headless browser to extract the one-owner and low-kilometre badges and the accident/damage timeline, so a buyer does not have to take the seller's word for what the report says.
- **A separate, installable mobile PWA** sharing the same backend and a common client library, built mobile-first (camera-based photo capture, offline app-shell caching, 44px touch targets) rather than as a responsive afterthought.
- **Admin operations tooling**: moderation queue, dealer verification, user management with layered privilege-escalation protections, platform analytics, and operator-editable content (blog, footer, body-type and make imagery) without a code deploy.

**What Vintrax explicitly does not do:** process payments, hold funds, or verify that a sale actually completed. It also does not currently support saved searches with match alerts (a single remembered last search exists instead), real outbound email delivery (notifications log rather than send by default), or multi-user dealership logins (one login per dealer account today).

### Current development status

Pre-launch MVP. Feature-complete for the scope above. No paying customers, no production user base, no load testing, no production monitoring/observability stack. See Section 11 for the full technical honesty accounting.

### Relationship with Variety Auto

Variety Auto is a real, independent dealership in Vancouver, BC, that this project is being developed in the context of. **As of this plan, Variety Auto is not a confirmed paying customer or a documented pilot user** — it is the natural first pilot environment, given the existing relationship, and Section 9 treats it that way: a pilot to be run and validated, not a reference customer to be cited as evidence of traction.

### Potential company structure and operating model

Not yet formally established (Assumption territory). A reasonable starting structure for a BC-based software business: incorporate federally or provincially (BC) as a corporation before taking on paying customers or outside investment, separate from Variety Auto's own dealership entity even where the two share an operator or testing relationship — commingling a software company and a licensed motor dealer's operations would complicate both the VSA (Vehicle Sales Authority of British Columbia) licensing picture and any future investor's diligence. This requires review by a Canadian business lawyer and accountant before acting on it (see Section 12).

### Geographic focus

British Columbia first, reflecting where the founding relationship (Variety Auto) and the product's only real-world testing opportunity exist, with the rest of Canada as the natural next expansion given the product, pricing research, and regulatory review in this plan are Canada-wide, not BC-specific. No US or international expansion is assumed at this stage.

---

## 2. Problem and Customer Pain Points

| Audience | Pain point | Can Vintrax realistically address it today? |
|---|---|---|
| Independent/used-car dealerships | Juggling a listings site, a separate DMS, and manual CARFAX handling as three unrelated tools and bills | **Yes, partially** — Vintrax combines listing, inventory management, and CARFAX automation in one system; it does not yet replace full dealership accounting/F&I workflows that a DMS like Frazer or Tekion covers |
| Used-car dealers specifically | Differentiating from larger, better-marketed competitors on trust signals | **Yes** — independent inspection reports and automated CARFAX extraction directly address this, if the CARFAX extraction works against real reports (unverified — see Section 11) |
| Vehicle sellers (private) | No safe way to reach buyers without a dealer relationship or handling payment themselves | **Partially** — Vintrax gives private sellers marketplace exposure and messaging; because there is no payment processing, the actual money-and-title handoff is still the seller's problem, same as on AutoTrader.ca or Kijiji Autos today |
| Vehicle buyers | Listings can overstate condition or accident history with no way to check | **Yes, if CARFAX extraction is verified** — the automated reader is designed specifically to stop a listing from claiming more than the report actually says; today this is unverified against a live report |
| Automotive sales/inventory teams | Manually re-entering the same vehicle across multiple sites, no analytics on what is and isn't selling | **Yes** — bulk CSV import and per-vehicle analytics are implemented and reasonably mature |

**Explicitly outside Vintrax's current scope:** payment processing or escrow, full dealership accounting/F&I (finance and insurance) workflows, multi-rooftop/dealer-group account management, VIN decoding, and any DMS features tied to actual money movement (financing calculators tied to real lenders, contract generation, tax/compliance filing). A dealer evaluating Vintrax as a DMS *replacement* rather than a marketplace-and-inventory *complement* will find real gaps.

---

## 3. Product and Feature Analysis

Status labels below follow the issue's own definitions: **Implemented** (built and working), **Partially Implemented** (built but with a material caveat), **Planned** (designed or discussed but not built), **Proposed** (an idea in this plan, not yet designed).

### User roles and permissions — Implemented

Six roles (`BUYER`, `SELLER`, `DEALER`, `INSPECTOR`, `ADMIN`, `SUPER_ADMIN`) and 20 fine-grained permissions, enforced in three layers: a route guard, a permissions guard, and per-service ownership checks. JWT access tokens (15 min) with rotating refresh tokens (30 days, replay-detected, revoking the whole token family if reused). Self-verification and self-role-escalation are explicitly blocked in the service layer, not just hidden in the UI.

### Dealer workflows and inventory management — Implemented

Two-step CSV bulk import (preview, then confirm — nothing is written until the dealer confirms what the preview showed), scoped so a dealer can only match against their own existing stock numbers/VINs, with SSRF-gated re-hosting of photo URLs from a dealer's feed. A moderation queue is the only path to a live (`ACTIVE`) listing — a seller cannot self-publish.

### Vehicle listings and auctions — Implemented

Fixed-price and live timed-auction sale channels. The auction engine: price-scaled minimum increments, a 2-minute anti-snipe extension, hidden reserve prices (only "reserve met" is shown), pseudonymous bidder handles, and bid placement inside a database-serializable transaction so two simultaneous bids cannot both win. A won auction marks the vehicle sold directly; a reserve not met returns it to the fixed-price marketplace. Real-time price updates broadcast over a read-only WebSocket channel, with a 20-second poll as a fallback if the socket drops.

**Known scaling gap (Implemented, single-instance only):** there is no Redis-backed Socket.IO adapter, so live-auction broadcasts are correct on one API server process but will not fan out correctly if more than one API replica is run — a real constraint before any multi-instance production deployment.

### Search — Implemented

PostgreSQL full-text search with a trigram fallback for typo tolerance is the actual default and what a first production deployment would run on — not OpenSearch, despite OpenSearch appearing as an available, optional provider in the architecture. Filters cover make/model/year/price/mileage/body type/fuel type/transmission/drivetrain/condition/sale channel/province/city/seller type/inspected-only, with live facet counts.

### Vehicle history, comparison, and trust tooling

- **Seller-entered history timeline — Implemented.** A seller can type their own accident/service/registration history; shown as their own account, not verified.
- **Independent inspection reports — Implemented.** 10 graded sections, odometer, frame/accident disclosure, gated so an in-progress report is visible only to the inspector, seller, and admin.
- **Vehicle comparison tool — Implemented, web only.** Up to four vehicles side by side, specification and feature diffing. Not available on the mobile PWA today.
- **CARFAX automated extraction — Partially Implemented, and this is the single most important caveat in this entire plan.** Given a `vhr.carfax.ca` report link (validated to that exact host, nothing else), a background worker drives a real headless Chromium browser to read the one-owner badge, low-kilometre badge, and accident/damage timeline, and writes them onto the listing — with a dealer-controlled toggle for whether the resulting timeline is shown publicly, independent of whether the badges show. This is genuinely more sophisticated than a manual self-attestation flow, and it fails safely by design (it refuses to guess rather than inventing a finding, and never blocks a listing save if the read fails). **But: it has never successfully run against a real CARFAX report.** It was built and tested only against fixture HTML in an environment that cannot reach the real CARFAX site at all. The team's own engineering record states this directly: the first real attempt is the actual test, and it is entirely possible CARFAX's page employs a defense (a fingerprint check, a CAPTCHA) that even a real headless browser cannot get past — in which case the honest fallback is the seller's own manual entry, which remains available and independent of this feature. **Do not present this feature to a dealer, investor, or customer as proven or reliable until it has been run against a real report and confirmed.**

### Payments — Explicitly removed, by design, not a gap

Vintrax has no online checkout, no payment processing, and no order-record-keeping of any kind, as of an explicit, deliberate decision (D-046, September 2026) to remove a system that recorded a seller's claim of "paid" with no actual money movement verified behind it. A sale — fixed-price or a won auction — is arranged directly between the two parties off-platform, which is also, functionally, how AutoTrader.ca and Kijiji Autos already work today. **This has a direct, immediate consequence for the business model: any revenue model based on transaction fees or a cut of sale price is not available to Vintrax as currently built, and would require designing and building real payment infrastructure from scratch — a materially different, and materially riskier, product than what exists today.** Section 7 treats this as settled, not as an open question.

### Mobile PWA — Implemented

A genuinely separate installable app (not merely a responsive layout), sharing the same backend and a common client library with the web app. Real camera capture with a framing guide and graceful fallback for iOS in-app browsers. Honest offline behaviour: the app shell is cached, but `/api` traffic is deliberately never cached, and there is no offline write queue — a bid or listing action either succeeds live or is disabled, never silently queued to replay later. Does not include admin, moderation, inspection authoring, or vehicle comparison, all deliberately desktop-only.

### Admin tooling — Implemented

Moderation queue, dealer verification, user management with layered anti-privilege-escalation rules, an append-only audit log, and operator-editable content (blog/articles, site footer, body-type imagery, make logos) — all without a code deploy. Platform analytics report user counts, listing counts, auction activity, and vehicles sold; there is no GMV or platform-revenue figure, consistent with there being no payment system to generate one.

### Backend and technical infrastructure

See Section 11 for the full technical accounting, including what is explicitly not yet built (real outbound email delivery, saved-search alerts, production monitoring) and the current security-audit status.

---

## 4. Target Customers and Market Segmentation

| Segment | Needs | Purchasing behaviour | Fit with Vintrax today |
|---|---|---|---|
| **Independent/used-car dealerships (1–3 rooftops)** — **primary initial segment** | Affordable inventory management + buyer reach, without an enterprise DMS budget | Price-sensitive, typically already paying $99–$600/month for a DMS and separately for listing exposure (Assumption, based on Frazer/DealerCenter pricing research — see Section 5) | **Best current fit.** Vintrax's actual feature set (listing + inventory + auctions + CARFAX automation) targets exactly this budget tier |
| **Small-to-medium dealer groups (4–15 rooftops)** | Multi-location visibility, consistent branding, more sophisticated analytics | Higher budget, longer sales cycles, likely already on an enterprise DMS | **Weak fit today** — Vintrax has no multi-user/multi-location dealer account model yet (Fact: one login per dealer account) |
| **Larger dealer groups / franchise dealers** | Deep DMS/F&I integration, OEM compliance | Enterprise procurement, RFPs, long contracts | **Not a target for the current product** — this segment needs the enterprise DMS feature set Vintrax does not have |
| **Private vehicle sellers** | Reach buyers without a dealer relationship | Free-tier expectation (AutoTrader/Kijiji both offer free basic private listings) | **Supported today**, no dealer tooling needed; unlikely direct revenue source given free competitor baseline |
| **Automotive service/inspection providers** | Distribution channel for inspection reports | B2B referral relationship, not a direct software buyer | **Not a customer segment — a potential partner channel** (see Section 9) |

**Recommended initial priority: independent and small used-vehicle dealerships in BC**, on the reasoning that this is the segment the product's actual feature set and price point fit, the segment with an existing relationship (Variety Auto) to pilot with, and the segment underserved by the "cheap DMS with no marketing" vs. "marketing site with no DMS" split described in Section 2. This is a recommendation, not a validated conclusion — willingness to pay at this segment has not been tested (see Section 8's validation plan).

---

## 5. Market Research and Competitive Landscape

Researched via public sources in September 2026; see inline citations. Figures describing "the market" are third-party estimates, not Vintrax-specific data.

**Market size (Fact, third-party estimate).** The global Automotive Dealer Management System market is valued at roughly USD 5.29B in 2026, projected to reach USD 9.73B by 2032 at a 10.4% CAGR ([Research and Markets](https://www.researchandmarkets.com/report/dealer-management-system)). Canada represents an estimated 5.8% of companies using dealership-management software, around 1,580 customers, per aggregated software-directory data — a rough proxy for the addressable dealer count using *some* form of DMS today, not a Vintrax-specific figure ([Capterra Canada](https://www.capterra.ca/directory/20005/auto-dealer/software)).

### Competitor comparison table

| Competitor | Segment | Core offering | Business model | Public pricing | Vintrax differentiation |
|---|---|---|---|---|---|
| **AutoTrader.ca** | Consumer marketplace | Vehicle listings (dealer + private), premium placement | Listing fees / dealer subscriptions (not publicly detailed) | Not public | No inventory-management/DMS layer, no live consumer auctions, no automated CARFAX extraction on the listing itself |
| **Kijiji Autos** | Consumer marketplace | Vehicle listings (dealer + private), 100,000+ active listings ([Finder Canada](https://www.finder.com/ca/car-loans/sites-like-autotrader)) | Free private listings; dealer subscriptions | Free (private); dealer pricing not public | Same gap as AutoTrader.ca — pure marketplace, no dealer inventory tooling |
| **Clutch.ca** | Online dealer (not a marketplace) | Sells only its own curated inventory, available in ON/NS/NB ([cardog.app](https://cardog.app/blog/cargurus-vs-autotrader-vs-clutch)) | Direct vehicle sales | N/A — not a software product | Not a competitor to Vintrax as a platform; a different business model entirely (Clutch buys and resells vehicles itself) |
| **OpenLane Canada (ADESA + TradeRev)** | B2B wholesale dealer-to-dealer auctions | Live and 24/7 wholesale vehicle auctions between dealers, with in-app negotiation and logistics ([OpenLane](https://www.openlane.ca/en/), [PR Newswire](https://www.prnewswire.com/news-releases/openlane-combines-best-of-adesa-canada-and-traderev-in-unified-canadian-marketplace-301855347.html)) | Transaction/auction fees | Not public | Different segment entirely — B2B wholesale, not consumer-facing. Vintrax's auctions are the only *consumer-facing* live-bidding option among the platforms reviewed here |
| **Frazer** | Independent-dealer DMS | Inventory, sales, BHPH financing tracking, accounting reports, forms | Flat-rate subscription | $99–$129/month (varies by source); $387/quarter, $1,299/year ([Frazer](https://www.frazer.com/frazer-pricing), [Chatref](https://www.chatref.ai/kb/guides/frazer-dealer-software-cost)) | No public-facing marketplace or auction component — Frazer manages inventory but does not put it in front of consumer buyers the way Vintrax's marketplace does |
| **DealerCenter** | Independent-dealer DMS | Core DMS + usage-based add-ons (credit reports, e-contracts, vehicle history) | Subscription + per-use fees | ~$99/month base ([G2](https://www.g2.com/compare/dealercenter-vs-frazer-auto-dealer-software)) | Same gap as Frazer — DMS-first, no built-in consumer marketplace or auction |
| **vAuto / HomeNet (Cox Automotive)** | Inventory pricing & syndication | Market-based pricing tools, listing syndication to third-party sites | Subscription + syndication fee | ~$2,691/month average total spend across tools (non-Dealertrack dealers); +$500/month for hosting/syndication add-on ([DealerRefresh forum data](https://forum.dealerrefresh.com/threads/homenet-vs-vauto-as-an-inventory-provider.9762/)) | A pricing/syndication layer, not a marketplace or DMS in its own right — dealers typically pay this *in addition to* a DMS and a listing site |
| **Tekion / Dealertrack / PBS Systems** | Enterprise DMS | Full dealership operations: sales, service, parts, accounting, F&I | Enterprise subscription | Tekion ~$3,000–$7,000+/month depending on rooftop size (Assumption, aggregated from indirect sourcing — treat as directional, not confirmed); Dealertrack/PBS pricing not public | Far more capable than Vintrax on DMS depth, and priced well outside the independent-dealer segment Vintrax targets |

**What no competitor reviewed here offers together:** a public marketplace, dealer inventory tooling, and a consumer-facing live auction, in one system, at an independent-dealer price point. That combination — not any single feature — is Vintrax's actual competitive position, and it should be validated with real dealers before being treated as a proven advantage.

---

## 6. Value Proposition and Positioning

### Core value proposition (proposed)

*"List once, manage inventory, and sell — with buyer trust tools built in, not bolted on — at a price built for an independent dealership, not a dealer group."*

### Customer benefits

- One system instead of three (marketing site + DMS + manual CARFAX handling).
- A consumer-facing live auction option, which none of the independent-dealer-tier competitors reviewed offer.
- Buyer-facing trust signals (inspection reports, automated CARFAX extraction once verified) that a bare listings site does not provide.

### Differentiation

Price-tier-appropriate combination of marketplace exposure and inventory management, plus the auction feature. **Explicitly not** a differentiator: payment processing (Vintrax has none, by design), multi-location dealer-group tooling (not built), or DMS depth (Frazer/Tekion go deeper on accounting/F&I).

### Why a dealership would switch or adopt Vintrax

Most plausibly: an independent dealer currently paying for a bare-bones DMS (or none at all) and relying entirely on AutoTrader/Kijiji for buyer reach, who would value consolidating tools and gaining the auction/CARFAX-automation angle as a way to stand out on a crowded marketplace listing. This is a reasoned hypothesis, not a tested one.

### Recommended initial market focus

British Columbia, independent dealers, reasoning as in Section 4: existing relationship (Variety Auto), price-tier fit, and a genuine feature gap versus the reviewed competitors. Recommended over "national" or "private-seller-first" launch strategies because a small, geographically concentrated pilot group is realistic to actually visit, support, and iterate on with a solo-operator team — a broader launch is not supportable at current staffing (see Section 11's operational-roles gap).

---

## 7. Business and Revenue Model

| Model | How it works | Who pays | Advantages | Risks / limitations | Implementation complexity |
|---|---|---|---|---|---|
| **SaaS subscription per dealer** *(recommended to test first)* | Flat monthly/annual fee for a tier of features | The dealer | Predictable recurring revenue; matches how every DMS competitor reviewed here is priced, so it is a familiar buying motion for the target customer; requires no new payment infrastructure beyond invoicing the dealer directly (e.g., Stripe Billing, or manual invoicing initially) | Price sensitivity in the independent-dealer segment (see Section 5's $99–$600/month comparables); dealer must see clear ROI before switching from an incumbent tool | **Low** — no change to the product itself, only billing/invoicing infrastructure, which does not exist today and would need to be built |
| **Tiered dealer plans** | Feature-gated tiers (e.g., Starter/Growth/Pro) | The dealer | Lets price-sensitive independents in at a low tier while capturing more from dealers who want auctions/CARFAX automation | Feature-gating logic must be built (not present today — the product currently has one feature set for all dealer accounts) | **Medium** |
| **Per-location pricing** | Price scales with number of dealership locations | The dealer group | Natural fit if/when multi-location accounts are built | Not viable today — no multi-location account model exists in the schema | **High** — requires new data model work first |
| **Per-vehicle / inventory-based pricing** | Price scales with active listing count | The dealer | Aligns cost with usage; easy to explain | Punishes exactly the dealers most likely to want to try the product (larger inventory = higher cost to test), and inventory count already fluctuates by season | **Low–Medium** |
| **Setup/onboarding fees** | One-time fee for CSV import assistance, account setup | The dealer | Revenue at signup; can fund white-glove onboarding for early pilots | Can be a bigger barrier for a first-time, unproven product than for an established one | **Low** |
| **Optional premium features** | CARFAX automation, auction hosting, or advanced analytics as an add-on | The dealer | Lets base pricing stay low while capturing willingness-to-pay for the more differentiated features | Requires feature-gating (same build cost as tiered plans) | **Medium** |
| **B2B partnerships** (e.g., inspection providers, financing referral) | Revenue share or referral fee | The partner | No new payment infrastructure on Vintrax's own platform | Requires partner relationships that do not exist yet; realistically a Year 2+ conversation | **Low** technically, **high** in relationship-building effort |
| **Marketplace/transaction fees** | A cut of the sale price or a per-transaction fee | The buyer or seller | Highest revenue ceiling if it worked | **Not available today.** Vintrax has no payment processing (deliberately removed, D-046) and no way to confirm a sale actually happened or for what amount. Building this is a materially different, materially riskier product | **Very high** — real payment infrastructure, money transmission/escrow regulatory exposure (see Section 12), and a reversal of a considered recent product decision |

**Recommendation: test a flat-rate SaaS subscription per dealer first**, at a price benchmarked against the $99–$600/month independent-dealer DMS comparables in Section 5, because it requires the least new engineering (no feature-gating, no multi-location model, no payment processing beyond invoicing the dealer), matches how the target segment already buys software, and can be validated with a handful of pilot dealers without committing to a tier structure that hasn't been tested. **Assumption underlying this recommendation:** that dealers will pay a flat fee for the current, undifferentiated feature set rather than requiring the (unbuilt) tiering to justify the price — this should be one of the first things validated in pilot conversations (see Section 9).

---

## 8. Pricing Strategy

**Everything in this section is a hypothesis, not an established price.** No dealer has been asked to pay for Vintrax yet.

| Tier (hypothesis) | Target customer | Illustrative features | Estimated price (CAD, hypothesis) |
|---|---|---|---|
| **Starter** | Solo/1-rooftop independent dealer testing the platform | Listing + CSV import + basic dealer analytics, no auction hosting, no CARFAX automation | $99–$149/month |
| **Growth** | Established independent dealer, 1–3 rooftops | Everything in Starter + auction hosting + automated CARFAX extraction (once verified) + full analytics | $249–$399/month |
| **Pro / multi-location** | Small dealer group | Everything in Growth, priced per location (requires the multi-location account model this plan flags as unbuilt in Section 3) | Not yet estimable — depends on unbuilt functionality |

**Setup/onboarding:** a one-time $0–$500 fee (hypothesis) to cover white-glove CSV import assistance for a dealer's first inventory load, waived for the first pilot cohort to lower the barrier to testing.

**Pricing assumptions underlying the above:**
- Anchored against Frazer ($99–$1,299 depending on term) and DealerCenter (~$99/month base) as the closest comparable price tier (Section 5), not against enterprise DMS pricing, which is 10–50x higher and serves a different segment.
- Assumes the CARFAX automation feature is verified working (Section 3) before it is used to justify a price premium — if it does not work against real reports, the Growth tier's differentiation weakens to "just auctions," which changes the pricing case.
- Assumes dealers evaluate Vintrax as a *complement* to, not *replacement* for, their existing DMS in year one, so the price anchor is closer to "an additional tool" than "a DMS replacement."

**Plan for validating willingness to pay:** structured pricing conversations with 3–5 pilot dealers (Section 9) using a concrete demo, not a hypothetical description — showing the actual CSV import, moderation flow, and (if verified) CARFAX extraction working on a real vehicle from that dealer's own lot. Ask directly what they currently pay for listing exposure and DMS tools combined, and where the two hypothesis tiers above would sit relative to that. Treat the first pilot cohort's pricing as free or heavily discounted in exchange for structured feedback, not as revenue validation — the first paying customer, at or near the hypothesized price, is the actual signal to look for.

---

## 9. Go-to-Market Strategy

### Initial ideal customer profile

An independent used-vehicle dealership in the Lower Mainland, BC, with 1–3 rooftops, currently using a low-cost or no DMS and relying primarily on AutoTrader.ca/Kijiji Autos for buyer reach — the segment this plan's research suggests is most underserved by the current market split (Section 2, Section 5).

### Pilot customer strategy, including Variety Auto

Variety Auto is the natural first pilot, given the existing relationship, but should be treated as **a pilot to run and learn from, not a reference customer to cite** until it has actually used the product and, ideally, paid something for it. A realistic pilot sequence:
1. Load Variety Auto's real (or realistically representative) inventory through the CSV importer and confirm the two-step preview/confirm flow works against real dealer data at volume, not just the 47-row test already recorded in the engineering history.
2. Run at least one real CARFAX link through the automated extraction feature and confirm, for the first time, whether it works against the live site — this is a go/no-go gate for how the product is positioned (Section 3).
3. Use Variety Auto's actual listings to structure the pricing conversation in Section 8.
4. Only after (1)–(3) are done, consider whether Variety Auto becomes a citable pilot/reference customer.

### Customer acquisition channels

- **Direct dealership sales** — in-person or phone outreach to independent BC dealers, led by the existing automotive-industry relationship through Variety Auto. This is the primary channel at this stage; there is no marketing budget or team assumed yet.
- **Partnerships** — inspection providers or CARFAX-adjacent services as a referral channel (Year 2+, not a near-term motion).
- **Content marketing** — plausible but unstaffed; not recommended as a near-term priority given solo-operator capacity constraints (Section 11).
- **Demonstrations and trials** — the primary near-term tool: a live demo against the dealer's own inventory, per the Variety Auto pilot sequence above, generalized to each new prospective dealer.

### Onboarding, sales process, retention

Not yet designed beyond the pilot sequence above — this is explicitly a gap to fill during the first 90 days (Section 10), not a solved process today.

### Milestones (hypothesis, not a forecast)

| Milestone | What it should mean |
|---|---|
| First 5 customers | Pilot dealers, likely discounted/free, providing structured feedback; the CARFAX extraction has been confirmed working or the positioning has been adjusted to reflect that it isn't |
| First 10 customers | At least some paying at or near hypothesized pricing; a repeatable (even if manual) onboarding process exists |
| First 25 customers | Enough signal to know whether the SaaS-subscription model (Section 7) is the right one, or whether pricing/tiering needs to change |
| First 100 customers | Would require either a sales process no longer solely dependent on one operator's personal relationships, or a materially different acquisition channel than direct outreach — not a near-term target without additional hiring or a different GTM motion |

---

## 10. Product Development Roadmap

| Horizon | Priority work | Notes |
|---|---|---|
| **Current state** | MVP feature-complete per Section 3; pre-revenue | — |
| **Next 30 days** | Run the CARFAX extraction against a real report and confirm or refute it (go/no-go gate); load real or realistic dealer inventory through the CSV importer at volume; begin structured pricing/pilot conversations with 3–5 BC dealers including Variety Auto | Essential, low-effort, high-information-value work — this is the single most important 30-day priority given the CARFAX feature's unverified status |
| **Next 90 days** | Build basic billing/invoicing so a pilot dealer can actually pay something; fix the still-open P1 security items (Section 11) before any real customer data is on the platform; decide, based on pilot feedback, whether tiered pricing needs to be built before wider outreach | Security fixes are not optional once real dealer/customer data is involved — see Section 11 |
| **Months 4–6** | Multi-user dealership accounts if pilot dealers with staff need it; real outbound email delivery (currently log-only) if pilots surface this as a blocker; production monitoring/observability (currently absent) before scaling past a handful of pilot customers | Essential MVP-completion work, not speculative feature-building |
| **Months 7–12** | Multi-location/dealer-group account model, only if pilot demand supports it; saved searches with match alerts, if buyer-side engagement data from pilots supports the investment | Explicitly optional/speculative — build only if pilot evidence supports it, not on the roadmap by default |
| **Year 2** | Provincial-to-national expansion, only if the BC pilot cohort validates the pricing and retention assumptions in this plan; partnership-channel development (Section 9) | Contingent on Year 1 validation, not assumed |

**Essential vs. speculative, stated plainly:** everything through "Months 4–6" is either already-necessary MVP-completion work (billing, security fixes, monitoring) or direct pilot validation. Everything from "Months 7–12" onward is contingent on what the pilots actually show, not committed today.

---

## 11. Technology and Operations Plan

### Architecture (Fact)

NestJS 11 backend (REST + WebSocket) with PostgreSQL 16 via Prisma 6; a Next.js 15/React 19 desktop-first frontend; a separate, installable Next.js mobile PWA sharing a common client library with the web app; Redis 7 for caching, background-job queuing (BullMQ), and distributed locks. Search runs on PostgreSQL full-text by default (not the optional OpenSearch provider). File storage defaults to local disk, with an S3-compatible provider available as an option.

### Authentication and authorization (Fact)

JWT access/refresh with rotation and replay detection, bcrypt password hashing, a global re-check of user status on every request (so a suspension takes effect immediately, not after a token expires), and three layers of authorization (route guard, permissions guard, service-level ownership checks).

### Hosting and deployment (Fact)

Three Docker images (API, web, mobile) with a documented, actually-run docker-compose path. Kubernetes manifests and Terraform exist as reference configurations but **have not been applied to a live cluster** — there is no evidence of a real Kubernetes production deployment today. A GitHub Actions pipeline builds and publishes images on merge to `main` and can deploy to a server via SSH with a required-reviewer gate and a rollback script — the *mechanism* for a real production deployment exists and has been exercised (including working through and fixing real deployment failures during this plan's own preparation period), but whether that target server is serving genuine end-user traffic today, versus functioning as a staging/demo environment, is not something the codebase can answer and should be confirmed directly with the team before this plan is shared externally.

### Security (Fact, from an internal security audit dated 2026-09-06)

Self-reported score of 72/100 as audited, 85/100 after four High/P0 findings were fixed (an unauthenticated document-access bug, a self-publish bypass of moderation, exposed database ports, and a since-moot payment-authorization gap tied to the now-removed order system). **Five Medium/P1 findings remain open**: an unvalidated post-login redirect, an SSRF exposure via the frontend's image optimizer, missing security headers (CSP/HSTS/etc.) on both Next.js apps, refresh tokens stored in browser `localStorage` (XSS-exposed), and no per-account brute-force lockout (only per-IP, in-memory rate limiting). The audit itself states plainly that it was a static/local review, not a penetration test, and did not cover live cloud infrastructure, TLS/DNS, or cloud IAM. **These open items should be closed before any real dealer or customer data — inventory, personal information, or otherwise — is put on the platform**, which is why they are placed in the "next 90 days" roadmap (Section 10), not treated as optional hardening.

### Scalability (Fact)

The one confirmed structural scaling constraint: live-auction WebSocket broadcasts are correct on a single API server process and will not fan out correctly across multiple replicas without adding a Redis-backed Socket.IO adapter — a known, bounded fix, not a redesign, but a real blocker before running more than one API instance.

### Backups, disaster recovery, monitoring (Fact)

A documented backup/restore/rollback process exists for the deployment pipeline. **Production monitoring and observability are essentially absent** — no error tracking, metrics, or alerting tooling was found in the codebase; the only signals available are basic health-check endpoints and standard process logs. This is a real, unaddressed gap for any production use with real users, flagged accordingly in the roadmap (Section 10).

### Data protection

See Section 12 for the legal/regulatory treatment; technically, personal data (user accounts, messages, dealer inventory) is stored in the primary PostgreSQL database with no separate encryption-at-rest layer confirmed beyond whatever the hosting provider supplies by default — this should be confirmed explicitly as part of the Section 11 security remediation work before real customer data is stored.

### Third-party integrations

CARFAX (via the automated extraction feature, Section 3 — no formal API relationship, reads the same public report page a buyer would); no payment processor (by design); no confirmed, live outbound email provider (SMTP driver exists in code, not confirmed as tested against a real provider).

### Required engineering and operational roles

Today: effectively one operator, assisted by AI-based engineering tools. **This is a real operational risk in its own right** (Section 15) and is why the roadmap in Section 10 is deliberately conservative about what gets built versus validated first. Scaling past the pilot stage will require, at minimum: a second engineer (to remove single-operator dependency), and — once any real customer or dealer data is on the platform — dedicated attention to the security remediation and monitoring gaps above, whether via a hire, a contractor, or the founding operator's own focused time before broader launch.

---

## 12. Legal, Regulatory, and Compliance Considerations

**This section identifies areas requiring review by a qualified Canadian lawyer and accountant. It is not legal advice.**

- **Business registration.** Incorporating the software business separately from Variety Auto's dealership operations is worth discussing with a lawyer, particularly given the different regulatory regimes each faces (see below).
- **Privacy — PIPEDA and BC PIPA.** PIPEDA (the federal *Personal Information Protection and Electronic Documents Act*) applies to any organization handling personal information in the course of commercial activity in Canada; British Columbia has its own *Personal Information Protection Act* (PIPA), recognized as "substantially similar" to PIPEDA, which would likely be the primary applicable regime for a BC-based operation ([OneTrust](https://www.onetrust.com/blog/the-ultimate-guide-to-pipeda-compliance/), [ComplyDog](https://complydog.com/blog/pipeda-compliance-guide-canadian-privacy-law-saas-companies)). Vintrax's security audit already identifies gaps (Section 11) relevant to this — data protection is a compliance question, not only a technical one, and the two should be worked through together before real personal data (buyer accounts, dealer customer data, messages) is handled at any scale.
- **Bill C-27 / future federal privacy reform.** Still moving through the federal legislative process as of this plan; worth tracking but not yet in force ([nocodelisted.com](https://nocodelisted.com/blog/pipeda-canada-privacy-act-saas-guide)).
- **Data ownership.** Contracts with dealer customers should state plainly who owns listing data, uploaded inventory photos/documents, and buyer messages — not yet addressed in any terms of service, because none exists yet.
- **Terms of service and dealer agreements.** Do not exist today and are needed before any pilot goes beyond an informal arrangement.
- **Third-party vehicle data and CARFAX-related restrictions.** This is a genuine, not theoretical, legal risk specific to Vintrax's current design. CARFAX Canada's public terms of use govern how a vehicle history report may be used once obtained, and CARFAX Canada offers business/API relationships through its own official channels, separately from what an automated browser-based reader does ([CARFAX Canada](https://www.carfax.ca/), [VinAudit Canada](https://www.vinaudit.ca/carfax-canada-api)). **Vintrax's automated CARFAX extraction feature reads a report page with a real browser rather than through any licensed API relationship, and this has not been reviewed against CARFAX's actual terms of use.** This should be reviewed by a lawyer, and ideally discussed directly with CARFAX Canada's business channels, before this feature is used with real dealer customers at any scale — the engineering team's own decision log independently flags exactly this concern.
- **Consumer protection.** BC's *Business Practices and Consumer Protection Act* and general Canadian consumer-protection norms around advertising accuracy are relevant to any vehicle-condition or history claim shown on a listing — relevant to how the CARFAX and inspection-report features are presented, not just to Vintrax's own conduct.
- **Motor dealer licensing (BC Vehicle Sales Authority).** Any person or business selling more than five vehicles a year in BC must be licensed as a motor dealer ([VSA BC](https://vsabc.ca/)) — this applies to Vintrax's *dealer customers*, not to Vintrax itself (which does not buy or sell vehicles, the same position AutoTrader.ca and Kijiji Autos operate from), but is worth confirming with a lawyer given Vintrax's closer operational relationship to Variety Auto than a pure third-party listing site would have.
- **Cybersecurity and liability insurance.** Not yet in place; worth obtaining before handling real dealer/customer data, particularly given the open security findings in Section 11.
- **Tax and accounting.** GST/HST registration and collection once revenue begins; not yet applicable pre-revenue, but should be set up correctly from the first paying customer, not retrofitted later.

---

## 13. Financial Plan

**Every figure below is an illustrative assumption, clearly labeled, not a forecast based on real revenue or cost data — none exists yet.** All figures in CAD.

### Startup and development costs (Assumption)

| Item | Estimate (Assumption) | Basis |
|---|---|---|
| Development to date | Not costed — built by the founding operator with AI-assisted engineering tools | Sunk cost, not a forward-looking budget line |
| Incremental engineering (Year 1) | $0–$80,000 | Range spans "solo operator continues, no new hire" to "one additional engineer for part of the year" |
| Security remediation (Section 11's open items) | $5,000–$15,000 | If contracted out rather than done by the existing team |
| Legal (incorporation, ToS, dealer agreement, privacy review, CARFAX terms review) | $5,000–$15,000 | Typical early-stage Canadian small-business legal engagement range |

### Ongoing costs (Assumption, monthly, at pilot scale)

| Item | Estimate | Basis |
|---|---|---|
| Hosting/infrastructure (Postgres, Redis, compute, storage, a small number of pilot dealers' worth of traffic) | $150–$500/month | Small-scale managed cloud hosting for the current stack; will not stay this low if the headless-browser CARFAX worker runs at real volume, since browser automation is materially more resource-intensive than typical API workloads |
| Third-party data/API costs | $0–unknown | No confirmed CARFAX API relationship exists (Section 12); if one is established, its cost is not yet known |
| Monitoring/observability tooling (currently absent, needed per Section 11) | $0–$100/month | Assuming a low-cost or free-tier tool at pilot scale |
| Marketing/sales | $0–$1,000/month | Assumed to be primarily the founding operator's direct-outreach time at this stage, not paid acquisition |

### Unit economics assumptions

- **Customer acquisition cost (CAC):** Direct dealership sales by a single operator has no clean industry comparable, but self-serve B2B SaaS CAC benchmarks of roughly $300–$800 ([SaaS Hero](https://www.saashero.net/strategy/saas-cac-benchmarks-2026/), [Userpilot](https://userpilot.com/blog/average-customer-acquisition-cost/)) are a reasonable low-end anchor; a relationship-driven, in-person sales motion to a small pilot cohort likely costs more in founder time than dollars, which this figure does not capture.
- **LTV:CAC target:** a commonly cited healthy SaaS target is 3:1 to 4:1 ([SaaS Hero](https://www.saashero.net/strategy/calculate-cac-b2b-saas/)) — worth using as a sanity check once pricing (Section 8) and retention are validated, not as a figure Vintrax can currently claim to hit.
- **Churn, gross margin, CLV:** cannot be estimated responsibly with zero paying customers; treat any number here as a placeholder to replace once the first pilot cohort has run for at least one full billing cycle.

### Three-year scenarios (Assumption — illustrative only)

| Scenario | Year 1 paying customers (end of year) | Year 1 MRR (at $250/month average, Assumption) | Year 2 customers | Year 3 customers | Key assumption |
|---|---|---|---|---|---|
| **Conservative** | 3–5 | ~$1,000/month | 10–15 | 20–30 | Pilot validates interest but sales remain founder-led and slow; CARFAX feature may not pan out, weakening differentiation |
| **Base case** | 8–12 | ~$2,500/month | 30–40 | 75–100 | Pilot validates pricing near the Section 8 hypothesis; CARFAX extraction confirmed working; word-of-mouth within the BC independent-dealer community drives some organic growth |
| **Growth** | 15–20 | ~$4,500/month | 60–80 | 150–200 | All of Base Case, plus a second sales-capable hire funded by early revenue, and successful expansion beyond BC in Year 2 |

**These scenarios are not a revenue forecast.** They exist to illustrate the shape of a realistic small-B2B-SaaS growth curve at this price point and should be discarded and rebuilt with real numbers after the first 90 days of pilot activity (Section 10).

### Break-even and runway

Cannot be responsibly estimated without a settled cost base (in particular, whether/how the founding operator is compensated, and whether a second hire happens) — this is flagged as a "missing information" item in the appendix below rather than given a fabricated number.

---

## 14. SWOT Analysis

| | |
|---|---|
| **Strengths** | A genuinely combined feature set (marketplace + inventory + live auctions) that no single reviewed competitor offers at this price tier; unusually disciplined engineering practice for a pre-revenue product (a real, dated security audit with verified fixes; a 47-decision engineering log that records real production incidents honestly); an existing real-world pilot relationship through Variety Auto |
| **Weaknesses** | Zero paying customers or validated demand; the CARFAX extraction feature, a headline differentiator, is unverified against the real site; no production monitoring; solo-operator dependency; no multi-location account model for larger dealer groups; no payment infrastructure, ruling out transaction-based revenue models |
| **Opportunities** | An underserved price/feature gap between bare listing sites and expensive enterprise DMS platforms, for independent Canadian dealers; a live pilot testing ground already available; room to expand from BC to the rest of Canada if the model validates |
| **Threats** | Incumbent marketplaces (AutoTrader.ca, Kijiji Autos) have far greater brand recognition and buyer traffic; the CARFAX extraction approach carries real legal and technical risk (Section 12) and may simply not work; a single competitor or CARFAX policy change could remove a core differentiator; no evidence yet that independent dealers will pay for a combined tool rather than continuing to stitch together cheaper point solutions |

---

## 15. Risks and Mitigation

| Risk | Probability | Impact | Early warning signs | Mitigation |
|---|---|---|---|---|
| No product-market fit — dealers don't want a combined tool | Medium (no evidence either way yet) | High | Pilot dealers decline to continue past a free trial; pricing conversations stall | Run the Section 9 pilot sequence before any broader spend; be willing to narrow scope (e.g., drop auctions, focus purely on inventory+marketplace) if that's what pilots actually value |
| CARFAX extraction does not work against real reports | Medium–High (explicitly flagged as unresolved by the engineering team itself) | Medium (a real differentiator, but the product functions without it via manual entry) | First real-report test (Section 10, next-30-days) fails or is blocked | Fall back to positioning around manual seller-entered history + inspection reports; do not market the automated feature until confirmed |
| Competition from incumbents adding similar features | Low near-term (large platforms move slowly on niche independent-dealer tooling) | Medium | An incumbent announces integrated DMS or auction features | Move fast on the BC pilot relationship while the gap exists; the actual moat is execution speed with real dealers, not the feature idea itself |
| Customer acquisition too slow/expensive for a solo operator | Medium–High | High | Pilot conversations take materially longer than expected to close | Keep the initial target list small and geographically concentrated (BC); do not spend on paid acquisition until the direct-sales motion is proven |
| Pricing set too high or too low | Medium (untested) | Medium | Pilot dealers push back hard on price, or convert with no negotiation at all (a sign price may be too low) | Section 8's structured validation conversations before committing to a public price |
| Technical reliability under real load | Medium (no load testing has been done) | Medium–High | Slow pages or auction bugs during a pilot dealer's real usage | Address the WebSocket-scaling gap (Section 11) before running more than one API instance; keep the pilot cohort small enough that current single-instance capacity is sufficient |
| Security incident involving real dealer/customer data | Low–Medium (five known open findings) | High | N/A — this is a "close before it happens" risk, not one with a warning sign | Close the five open P1 security findings (Section 11) before any pilot stores real personal or dealer data |
| Legal exposure from CARFAX automated extraction | Medium (unreviewed against CARFAX's actual terms) | Medium–High | A cease-and-desist or access block from CARFAX | Legal review before wider use (Section 12); willingness to discuss a formal API relationship with CARFAX Canada directly, or to drop the feature, if terms prohibit the current approach |
| Funding — running out of runway before validating the model | Medium (depends entirely on how the venture is funded, not yet decided — Section 17) | High | N/A | Keep costs low (Section 13) and bootstrap through the pilot-validation phase before considering outside capital |
| Operational capacity — solo operator | High (currently a fact, not a risk projection) | High | Any personal unavailability of the founding operator stalls the entire venture | Prioritize hiring or a co-founder relationship once pilot revenue, even modest, exists to justify it |
| Customer retention | Unknown (no customers yet to measure) | High long-term | First-cohort churn after initial free/discounted period ends | Structure the pilot to convert to paid deliberately (Section 9), so retention data starts accumulating as early as possible |

---

## 16. Key Performance Indicators

| KPI | What it measures | How to measure |
|---|---|---|
| Dealer activation rate | Share of signed-up dealers who complete inventory import and publish at least one listing | `vehicles` created and moderated to `ACTIVE`, per dealer account, within N days of signup |
| Inventory onboarded | Total active listings across dealer accounts | Count of `ACTIVE`/`IN_AUCTION` vehicles, already tracked in the existing admin analytics dashboard |
| CARFAX extraction success rate | Share of submitted CARFAX links that successfully extract data vs. fail | `carfaxFetchError` populated vs. null, already tracked in the schema — **this KPI should be watched from the very first real-world use**, given Section 3's caveat |
| Customer acquisition | New paying dealer accounts per month | Manual tracking until billing infrastructure (Section 10) exists |
| Conversion | Pilot-to-paid conversion rate | Manual tracking through the pilot sequence (Section 9) |
| Monthly recurring revenue (MRR) | Total committed monthly dealer subscription revenue | Once billing exists (Section 10) |
| Churn | Share of paying dealers who cancel per period | Once billing exists |
| Retention | Share of dealers still active/paying after 3, 6, 12 months | Once billing exists |
| Customer satisfaction | Qualitative pilot feedback, and eventually NPS | Structured pilot interviews (Section 9) in the near term; a formal survey once there is a larger cohort |
| Support | Response time and resolution rate on dealer issues | Not yet instrumented — a gap to address alongside the Section 11 monitoring work |
| Infrastructure reliability | Uptime, error rate, auction-bid success rate | **Currently cannot be measured — no monitoring/observability tooling exists (Section 11).** This is itself a KPI-readiness gap to close before it can be reported on |

---

## 17. Funding and Investment Strategy

Given zero revenue and zero paying customers today, the responsible sequence is:

1. **Bootstrap through pilot validation** (0–90 days, Section 10) — no outside capital needed or appropriate yet; the goal is information (does the pricing/product hypothesis hold), not scale.
2. **Revenue-funded growth**, if the pilot converts a handful of paying dealers at or near the Section 8 pricing hypothesis — use that early revenue to fund a second hire before considering outside capital, keeping the business self-directed for as long as the growth rate allows.
3. **Angel investment or a strategic automotive-industry partner** becomes a reasonable conversation only after the pilot has produced real, if modest, evidence: paying customers, a working (or honestly not-working, with a clear pivot) CARFAX feature, and a repeatable — even if still manual — sales process. Variety Auto's ownership or network could plausibly be a source of exactly this kind of strategic, automotive-industry-informed early capital, but this plan does not assume that conversation has happened.
4. **Venture capital** is premature at this stage and likely a poor fit even later — this is a vertical B2B SaaS serving a price-sensitive independent-dealer segment, not a venture-scale growth profile, unless national expansion (Section 10, Year 2) validates strongly enough to change that assessment.

**Resources required at each stage**, without assuming fundraising occurs: Stage 1 needs primarily the founding operator's time and the modest hosting/legal costs in Section 13. Stage 2 needs enough pilot revenue to fund one additional hire. Stage 3, if pursued, needs a real pitch built on actual pilot results, not this planning document, which should be treated as superseded the moment real customer data exists.

---

## 18. First-Year Execution Plan

**Given the current stage, only the first 90 days can be planned with any real specificity; months 4–12 are directional, not committed, pending what the first 90 days actually show.**

| Month | Objectives | Product | Customer validation | Sales | Marketing | Financial priority | Dependencies |
|---|---|---|---|---|---|---|---|
| **1** | Resolve the CARFAX go/no-go question; begin pilot outreach | Run a real CARFAX report through the extraction feature; fix any P0 issues found | First conversations with 3–5 BC independent dealers, including Variety Auto | Founder-led direct outreach | None budgeted | Legal/incorporation review begins | None external |
| **2** | Get at least one dealer's real inventory into the system | Load real/representative inventory via CSV import; close the highest-priority open security findings (Section 11) before any real dealer data is stored | Structured pricing conversations (Section 8) with pilot dealers | Continue direct outreach | None budgeted | Legal review continues | Month 1's CARFAX result shapes how the product is pitched |
| **3** | Convert at least one pilot to a paid (even if discounted) customer | Basic billing/invoicing capability | First paid conversion attempt | Direct, relationship-led close | None budgeted | First real revenue data point, however small | Requires Months 1–2 to have gone reasonably well |
| **4–6** | Expand pilot cohort to 5–10 dealers; close remaining security findings; add production monitoring | Multi-user accounts and real email delivery, if pilots surface them as blockers | Ongoing structured feedback loop | Direct outreach, informed by what closed/didn't in Q1 | Possibly begin light content marketing if founder capacity allows | Assess whether a second hire is justified by pilot revenue | Contingent on Q1 results |
| **7–12** | Assess readiness for wider BC launch or provincial expansion | Multi-location account model, if dealer-group demand appeared in pilots | Formal retention tracking begins | Decide whether direct-only sales scales or a different channel is needed | Reassess based on what worked | Reassess funding needs (Section 17) | Fully contingent on H1 outcomes — not committed today |

---

## 19. Final Strategic Assessment

**The strongest evidence-supported opportunity:** Vintrax combines marketplace, dealer inventory management, and consumer-facing live auctions in one product, at a price tier none of the reviewed competitors serve with that combination — and it has a real, if unconfirmed, pilot relationship available through Variety Auto to test that thesis quickly and cheaply.

**The biggest uncertainties, in order of importance:**
1. Whether any dealer will actually pay for this — there is no evidence yet either way.
2. Whether the CARFAX automated extraction, a headline differentiator, works at all against the real site — this is explicitly unresolved and could fail outright.
3. Whether the "combined tool" positioning is actually what independent dealers want, versus continuing to stitch together cheaper point solutions.

**The most important assumptions to validate, before any significant further investment of time or money:**
- Section 8's pricing hypothesis, against real pilot-dealer conversations.
- Section 3's CARFAX extraction, against a real report.
- Section 4's segment choice (independent BC dealers), against whether that segment actually converts.

**Key milestones before significant investment:** a working CARFAX extraction confirmed against a live report (or a deliberate, honest pivot away from marketing it); at least one dealer paying something close to the Section 8 pricing hypothesis; the five open P1 security findings closed before any real customer data is stored at scale; basic production monitoring in place.

**Recommended sequence of experiments:** run the Section 10 "next 30 days" plan exactly as written — CARFAX verification first (it gates how everything else is positioned), then real inventory load, then structured pricing conversations — before writing a second, more confident version of this plan grounded in what those experiments actually show.

**This assessment is not a guarantee of success.** Vintrax is a well-built, pre-revenue MVP with one genuinely interesting, unproven differentiator and no confirmed customers. The next 90 days of real-world pilot activity, not this document, will determine whether the business case here holds.

---

## Appendix A — One-Page Executive Summary

*(A condensed standalone version of the Executive Summary above, suitable for extraction into its own document or slide.)*

**Vintrax** is a Canadian automotive marketplace and dealer platform — a web marketplace, an installable mobile PWA, and a NestJS/PostgreSQL backend — combining public vehicle listings (fixed-price and live consumer-facing auctions), dealer inventory tools (bulk CSV import, analytics, moderation-gated publishing), and buyer trust tooling (independent inspections, an automated CARFAX report reader, vehicle comparison) in one system. It is being developed alongside Variety Auto, an independent Vancouver dealership, which is a potential pilot testing ground, not a confirmed customer.

**The problem:** independent Canadian dealers typically pay for a listings site and a separate DMS, with no consumer-facing auction option and no automated verification of accident-history claims. **The opportunity:** no reviewed competitor offers marketplace + inventory + live consumer auctions together at the independent-dealer price tier ($99–$600/month, per Frazer/DealerCenter comparables).

**Stage:** pre-revenue, pre-launch MVP, feature-complete, internally security-audited (85/100 after P0 fixes, 5 P1 items open), zero paying customers, no production monitoring, no load testing. Online payments were **deliberately and completely removed** in September 2026 — a sale is arranged off-platform, which rules out transaction-fee revenue models.

**Recommended model:** flat-rate SaaS subscription paid by the dealer, hypothesized at $99–$399/month depending on tier, validated against real pilot conversations before being treated as a real price.

**Single biggest open question:** the automated CARFAX extraction feature — a headline differentiator — has never been run against a real CARFAX report. The next 30 days should resolve this before the product is positioned around it.

**Ask (if applicable):** none at this stage — the recommended next step is bootstrapped pilot validation (Section 10, Section 17), not fundraising.

---

## Appendix B — Competitor Comparison Table

*(Duplicated from Section 5 for standalone extraction.)*

See the table in Section 5, "Competitor comparison table."

---

## Appendix C — Three-Year Financial Assumptions and Scenarios

*(Duplicated from Section 13 for standalone extraction.)*

See "Three-year scenarios" in Section 13. All figures are illustrative assumptions, not forecasts.

---

## Appendix D — 12-Month Execution Roadmap

*(Duplicated from Section 18 for standalone extraction.)*

See the month-by-month table in Section 18. Only Months 1–3 are planned with specificity; Months 4–12 are directional and contingent on Q1 results.

---

## Appendix E — Top 10 Assumptions Requiring Validation

1. That independent BC dealers will pay a monthly subscription for a combined marketplace + inventory + auction tool, rather than continuing to use separate cheaper point solutions (Section 4, Section 8).
2. That the CARFAX automated extraction feature actually works against a real, live CARFAX report — currently entirely unverified (Section 3, Section 11).
3. That $99–$399/month is the right price band for the target segment — anchored to competitor research, not tested with a real buyer (Section 8).
4. That Variety Auto will actually participate as a pilot, at the depth this plan assumes (real inventory, real CARFAX links, a real pricing conversation) — not yet confirmed (Section 9).
5. That the "combined tool" positioning is a genuine draw, rather than dealers preferring to keep marketplace and DMS functions separate for reasons this plan hasn't surfaced (Section 6).
6. That a solo operator (plus AI-assisted engineering) can sustain both product development and direct dealer sales simultaneously through the pilot phase (Section 11, Section 15).
7. That CARFAX's terms of use permit the current browser-based extraction approach — unreviewed by a lawyer or by CARFAX Canada directly (Section 12).
8. That the live-auction feature is actually valued by the target independent-dealer segment, versus being a differentiator only in this plan's own analysis (Section 6).
9. That closing the five open P1 security findings is sufficient due diligence for handling real dealer/customer data, versus surfacing further issues under real usage (Section 11).
10. That a per-dealer SaaS subscription (versus per-location, per-vehicle, or another model in Section 7) is the right revenue model to commit to, rather than one of the alternatives this plan set aside.

---

## Appendix F — Missing Information Preventing a Fully Accurate Business Plan

- **Real pricing data**: what independent BC dealers currently actually pay, combined, for listing exposure and DMS tools today — this plan's pricing anchors (Section 5, Section 8) come from public competitor pricing pages, not from asking actual target customers.
- **Confirmation of the production deployment's real-world status**: whether the server `release.yml` deploys to is serving genuine end-user traffic or functioning as a staging/demo environment (Section 11) — the codebase cannot answer this.
- **A real CARFAX extraction test result** — the single largest open technical question in this entire plan (Section 3).
- **Variety Auto's actual willingness to pilot**, at the depth (real inventory, real pricing conversation) this plan assumes, and on what timeline — not confirmed in any document reviewed.
- **The founding operator's intended time commitment, compensation, and whether a co-founder or early hire is already planned** — directly affects Section 11's operational-capacity assessment and Section 13's cost estimates, and was not stated anywhere available to this analysis.
- **Whether outside funding is being sought or considered at all**, and on what timeline — Section 17 is written assuming no fundraising has been decided, which may not reflect the operator's actual intent.
- **Any existing conversations with CARFAX Canada, a lawyer, or an accountant** — this plan repeatedly recommends these reviews (Section 12) without knowing whether any have already begun.
- **Real infrastructure cost data** — Section 13's hosting estimates are generic small-scale cloud pricing, not a quote against Vintrax's actual current or planned hosting provider.
