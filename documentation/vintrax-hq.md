# Project Vintrax

## Vehicle Marketplace Platform

### Purpose of This Document

This document is the front door and high-level source of truth for Project Vintrax. It summarizes what the project is, why it exists, what has been decided, and what the team should focus on next. Detailed requirements, research, technical specifications, and operating documents will live in their appropriate project folders.

### Project Overview

Project Vintrax is a planned vehicle commerce platform for Canada. It will begin as a simple, trustworthy vehicle marketplace where dealerships and private sellers can publish listings and buyers can discover vehicles, compare options, and start conversations with sellers.

The goal is not to reproduce AutoTrader feature for feature. Vintrax should preserve the familiar parts of a vehicle marketplace while improving areas where buyers and sellers experience friction. The product should remain straightforward even as the underlying platform grows.

### Vision

Create a trusted, easy-to-use vehicle marketplace that makes buying and selling vehicles simpler, more transparent, and less intimidating.

### Mission

Connect buyers, dealerships, and private sellers through high-quality listings, effective search, low-friction messaging, and tools that help people move from browsing to a confident transaction.

### Current Phase

Discovery and planning.

The team is defining the product, validating user problems, researching competitors, organizing project knowledge, and deciding how the platform should be released in phases. Production development has not started.

### Core Product Direction

#### Marketplace

The primary product will be a public vehicle marketplace. Dealerships and ordinary private sellers will both be able to create accounts and publish listings.

#### Messaging

Buyers should be able to message sellers directly from a vehicle listing. This reduces the pressure of making an immediate phone call and gives hesitant buyers an easier way to begin a conversation.

Messaging should initially be asynchronous rather than a complex live-chat system. Buyers should have an account so conversations can be saved, synchronized, protected from spam, and connected to favourites and alerts.

#### Auctions

Vehicle auctions are an intended part of the long-term product vision. They should not be mixed into the initial marketplace experience.

The preferred direction is a separate auction application on a subdomain or separate domain, linked clearly from the main marketplace. The marketplace and auction product should share foundational services where practical, including accounts, vehicle data, images, notifications, and potentially messaging.

### Phased Development Approach

Vintrax will be released in phases rather than attempting to launch every planned capability at once.

#### Phase 0: Foundation and Discovery

Define the product vision, user problems, research system, business assumptions, technical principles, security expectations, and phased roadmap.

#### Phase 1: Marketplace MVP

Launch the smallest useful marketplace that allows sellers to publish vehicles and buyers to search, view listings, and contact sellers. The exact MVP scope has not yet been finalized.

#### Phase 2: Marketplace Growth

Improve listing workflows, private-seller capabilities, saved searches, notifications, comparisons, trust features, dealer tools, and marketplace quality based on real usage.

#### Phase 3: Differentiation

Introduce carefully selected intelligence and convenience features only where they solve validated user problems. Possible areas include natural-language search, pricing guidance, stronger recommendations, and improved seller tools.

#### Phase 4: Auction and Ecosystem Expansion

Launch the auction application and consider additional services such as inspections, financing connections, transportation, partner integrations, and mobile applications.

### Guiding Principles

1. Solve real user problems rather than copying competitor features.
2. Keep the user experience simple, even when the platform architecture is sophisticated.
3. Build trust before optimizing for rapid growth.
4. Treat buyers, dealers, and private sellers as distinct users with different needs.
5. Use phased delivery to control risk and avoid feature creep.
6. Design shared platform capabilities so marketplace and auction products can evolve without unnecessary duplication.
7. Build security, privacy, reliability, and scalability into the foundation.
8. Use AI to assist research, planning, development, and operations, but keep important decisions reviewable by humans.
9. Keep approved project knowledge organized and separate from raw research, ideas, and experiments.
10. Do not add a feature merely because it appears impressive.

### Initial User Groups

#### Buyers

People searching for vehicles who need a fast, trustworthy, and low-pressure way to compare listings and contact sellers.

#### Dealerships

Professional sellers that need reliable inventory publishing, lead generation, messaging, account controls, and eventually stronger operational and analytical tools.

#### Private Sellers

Ordinary vehicle owners who need a guided, simple, and safe way to create a listing, communicate with buyers, and eventually choose between marketplace and auction selling options.

#### Administrators and Support Team

Internal users responsible for moderation, user management, listing quality, trust and safety, disputes, platform configuration, and operational oversight.

### Key Decisions to Date

- The internal project codename is Project Vintrax.
- Vintrax will be positioned as a better vehicle marketplace, not as an exact AutoTrader replica.
- The product will be developed and released in phases.
- Both dealerships and private sellers are intended to participate.
- Buyer-to-seller messaging is considered a core product direction.
- Auctions are intended, but will be developed as a separate application rather than inserted into the initial marketplace.
- The auction and marketplace applications should share foundational platform services where practical.
- Cursor is expected to be the primary coding environment, supported by ChatGPT for strategy, research, documentation, architecture, and review.
- Google Drive will hold curated, team-readable project knowledge.
- GitHub will eventually hold code and technical documentation close to implementation.
- Automated research may be introduced later through a controlled workflow, with human review before findings become approved project knowledge.

### Open Questions

- Which geographic market should Vintrax launch in first?
- What specific buyer or seller problem will be the strongest reason to choose Vintrax over established alternatives?
- Should private-seller listings be included in the first public MVP or introduced immediately afterward?
- What should be free, paid, or subscription-based for dealerships and private sellers?
- What verification should be required for sellers and listings?
- Which messaging capabilities are essential for the first release?
- What legal, licensing, payment, deposit, and dispute rules will apply to auctions?
- Should the auction product use a subdomain or a separate public brand and domain?
- What inventory import methods will make dealership onboarding easiest?
- What measurable outcome will define a successful MVP?

### Immediate Next Step

Complete and approve this HQ document, then begin the structured discovery work needed before the Product Requirements Document. The next document should focus on product vision, target launch market, user problems, and the Phase 1 success criteria.

### Document Ownership

This document should remain concise and current. Detailed material should be linked from this document rather than copied into it. Major changes in direction should also be recorded in the separate [Decision Log](./decision-log.md) once that file is created.
