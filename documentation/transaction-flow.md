# Roles and transaction flows

Who can do what in Atlas, and how each process actually moves through the
system. Every permission, endpoint and status in this document is taken from
the code — `packages/shared/src/domain.ts` for the matrix,
`backend/prisma/schema.prisma` for the state machines, and the controllers for
the guards.

## How authorisation works

Four things gate every request, in this order:

```mermaid
sequenceDiagram
    participant C as Client
    participant J as JwtAuthGuard
    participant P as PermissionsGuard
    participant T as ThrottlerGuard
    participant V as ZodValidationPipe
    participant S as Service

    C->>J: request with bearer token
    J->>J: decode, then re-read the user from the database
    Note over J: A suspended account is rejected on the<br/>next request, not when the token expires
    J->>P: request.user attached
    P->>P: roles, permissions, verified email, account status
    P->>T: authorised
    T->>V: within rate budget
    V->>S: typed, validated input
    S->>S: ownership and business rules
```

Two properties worth stating plainly:

- **Permissions are ANDed.** `@RequirePermissions('vehicle:publish', 'user:manage')`
  needs both. This is what keeps a dealer — who has `vehicle:publish` for their
  own listings — out of the moderation queue.
- **The guard is not the last line.** Ownership is checked in the service. A
  seller with `vehicle:write` can write *their* vehicles; the service throws
  `ForbiddenException` for anyone else's.

## The permission matrix

The complete matrix, verbatim from `ROLE_PERMISSIONS`.

| Permission | Buyer | Seller | Dealer | Inspector | Admin | Super admin |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| `vehicle:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `vehicle:write` | | ✅ | ✅ | | ✅ | ✅ |
| `vehicle:publish` | | ✅ | ✅ | | ✅ | ✅ |
| `vehicle:delete` | | ✅ | ✅ | | ✅ | ✅ |
| `auction:read` | ✅ | ✅ | ✅ | | ✅ | ✅ |
| `auction:create` | | ✅ | ✅ | | ✅ | ✅ |
| `auction:manage` | | | | | ✅ | ✅ |
| `bid:place` | ✅ | ✅ | ✅ | | | ✅ |
| `inspection:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `inspection:write` | | | | ✅ | ✅ | ✅ |
| `dealer:read` | | | ✅ | | ✅ | ✅ |
| `dealer:manage` | | | | | ✅ | ✅ |
| `dealer:verify` | | | | | ✅ | ✅ |
| `user:read` | | | | | ✅ | ✅ |
| `user:manage` | | | | | ✅ | ✅ |
| `payment:read` | | | ✅ | | ✅ | ✅ |
| `payment:manage` | | ✅ | ✅ | | ✅ | ✅ |
| `report:read` | | | ✅ | | ✅ | ✅ |
| `settings:manage` | | | | | | ✅ |
| `audit:read` | | | | | ✅ | ✅ |

Four deliberate gaps:

- **A dealer cannot verify a dealership** — not even their own. Self-verification
  would make the verified badge worthless.
- **An inspector cannot bid and cannot list.** Their independence is the product.
- **An admin cannot bid.** Only `SUPER_ADMIN` holds `bid:place` among staff
  roles, and that is an artefact of holding every permission rather than an
  invitation to trade on the platform they moderate.
- **A buyer does not hold `payment:manage`.** Recording that money arrived is
  the seller's side of a sale; a buyer able to assert it about their own order
  could take a vehicle without paying. The permission is a floor, not the whole
  rule — the service also requires the caller to be the seller on that specific
  order, so a dealer buying from another dealer is refused too.

---

# Roles

## Buyer

The default role. Anyone who registers is a buyer until they ask to be
something else.

| Can | Cannot |
| --- | --- |
| Search and view listings, including as a guest | Create or edit a listing |
| Save vehicles to favourites | Run an auction |
| Message sellers | See another buyer's identity in a bid history |
| Bid in live auctions | See a reserve price |
| Buy at a fixed price, pay, complete an order | Read inspection reports before they are published |
| Read published inspection reports | |

```mermaid
flowchart TD
    A["Register or sign in"] --> B{"Email verified?"}
    B -- "No" --> C["Browse and search only"]
    C --> V["Verify email from the account screen"]
    V --> B
    B -- "Yes" --> D["Full buyer actions"]

    D --> E["Search inventory"]
    E --> F["Vehicle detail"]
    F --> G["Save to favourites"]
    F --> H["Message the seller"]
    F --> I{"Sale channel"}

    I -- "Fixed price" --> J["Create order"]
    I -- "Auction" --> K["Auction room"]

    K --> L["Place a bid"]
    L --> M{"Won at close?"}
    M -- "Yes" --> J
    M -- "No" --> E

    J --> N["Record payment"]
    N --> O["Confirm delivery"]
    O --> P["Order complete"]
```

**The verified-email gate is real.** `POST /vehicles`, `POST /auctions`,
`POST /auctions/:id/bids` and `POST /orders` all carry
`@RequireVerifiedEmail()`. Browsing does not.

## Seller

A private individual selling their own vehicles. Everything a buyer can do,
plus inventory.

| Can | Cannot |
| --- | --- |
| Everything a buyer can | Moderate anyone's listing, including their own |
| Create, edit, delete their own listings | See the moderation queue |
| Submit a listing for review | Verify a dealership |
| Publish their own listing once approved | See platform analytics |
| Create and cancel auctions on their own vehicles | Read another seller's inventory |
| Set a reserve price, never shown to bidders | |

```mermaid
flowchart TD
    A["Create listing"] --> B["DRAFT"]
    B --> C["Add photos, documents, features"]
    C --> D{"Ready?"}
    D -- "No" --> C
    D -- "Yes" --> E["Submit for review"]
    E --> F["PENDING_REVIEW"]
    F --> G{"Admin decision"}
    G -- "Approved" --> H["ACTIVE and publicly visible"]
    G -- "Rejected" --> B

    H --> I{"How to sell"}
    I -- "Fixed price" --> J["Wait for an order"]
    I -- "Auction" --> K["Create auction with reserve"]

    K --> L["IN_AUCTION"]
    L --> M["Auction runs and closes"]
    M --> N{"Reserve met?"}
    N -- "Yes" --> O["Winner creates the order"]
    N -- "No" --> H

    J --> P["Buyer orders"]
    O --> P
    P --> Q["SOLD"]
    Q --> R["Payment recorded"]
    R --> S["Order completed"]
```

## Dealer

A dealership. A seller with a business identity attached, plus the reporting
that comes with it.

| Can | Cannot |
| --- | --- |
| Everything a seller can | Verify their own dealership |
| Hold a dealership profile with a public page | Verify any dealership |
| See their own sales and inventory analytics | See platform-wide analytics |
| Read payment records for their own sales | Manage other users |
| Carry a verified badge once an admin approves it | Read the audit log |

```mermaid
flowchart TD
    A["Register as DEALER"] --> B["Dealership created — PENDING"]
    B --> C["List inventory while pending"]
    C --> D["Listings go through the normal review"]

    B --> E{"Admin reviews the dealership"}
    E -- "Verified" --> F["VERIFIED — badge on every listing"]
    E -- "Rejected" --> G["REJECTED"]
    E -- "Later misconduct" --> H["SUSPENDED"]

    F --> I["Dealer dashboard"]
    I --> J["Active listings, views, enquiries"]
    I --> K["Sold this month, gross sales"]
    I --> L["Top vehicles by views"]

    F --> M["Run auctions"]
    F --> N["Read payment records for own sales"]
```

**A pending dealer is not blocked from selling.** Verification affects the
badge and buyer trust, not the ability to list. That is a product choice, not
an oversight — a new dealership can start working the day it registers.

## Inspector

Independent condition reporting. The narrowest role in the system, and
deliberately so.

| Can | Cannot |
| --- | --- |
| See inspections assigned to them | List a vehicle |
| Create an inspection record | Bid on anything |
| Grade each section and submit the report | Edit a submitted report |
| Read any published report | See dealer or platform analytics |
| | Moderate listings |

```mermaid
flowchart TD
    A["Inspection assigned"] --> B["SCHEDULED"]
    B --> C["Open the vehicle record"]
    C --> D["IN_PROGRESS"]
    D --> E["Grade each section"]
    E --> F["Record frame damage and accident history"]
    F --> G["Attach photographs"]
    G --> H["Submit"]
    H --> I["COMPLETED — overall grade published"]
    I --> J["Report visible on the public listing"]

    B --> K["CANCELLED"]
    D --> K
```

The report is what a buyer leans on, so the inspector must not be able to sell
the thing they graded. `INSPECTOR` holds exactly three permissions:
`vehicle:read`, `inspection:read`, `inspection:write`.

## Admin

Platform operations. Everything except the keys to the platform itself.

| Can | Cannot |
| --- | --- |
| Moderate listings — approve or reject | Change platform settings |
| Verify, reject or suspend a dealership | Manage payments |
| Suspend or deactivate a user account | Bid |
| Manage any auction | |
| Write inspections | |
| Read platform-wide analytics | |
| Read the append-only audit log | |

```mermaid
flowchart TD
    A["Admin dashboard"] --> B["Moderation queue — PENDING_REVIEW"]
    A --> C["Dealer verification queue"]
    A --> D["User management"]
    A --> E["Platform analytics"]
    A --> F["Audit log"]

    B --> G{"Review a listing"}
    G -- "Approve" --> H["ACTIVE"]
    G -- "Reject" --> I["Back to DRAFT with a reason"]

    C --> J{"Review a dealership"}
    J -- "Verify" --> K["VERIFIED"]
    J -- "Reject" --> L["REJECTED"]
    J -- "Misconduct" --> M["SUSPENDED"]

    D --> N{"Account action"}
    N -- "Suspend" --> O["SUSPENDED — refused on the next request"]
    N -- "Deactivate" --> P["DEACTIVATED"]
    N -- "Reinstate" --> Q["ACTIVE"]

    H --> R["Written to the audit log"]
    K --> R
    O --> R
```

**Suspension takes effect on the next request, not at token expiry.** The JWT
strategy re-reads the user from the database on every request, so a suspended
account loses access within one round trip rather than up to fifteen minutes
later.

## Super admin

Holds every permission, including the one nobody else has: `settings:manage`.

| Can | Notes |
| --- | --- |
| Everything an admin can | |
| Manage platform settings | The only role with `settings:manage` |
| Manage payments — refunds, corrections | Shares `payment:manage` with sellers, dealers and admins, who use it to record payment on their own sales |
| Place bids | An artefact of holding every permission |

```mermaid
flowchart TD
    A["Super admin"] --> B["Everything an admin can do"]
    A --> C["settings:manage"]
    A --> D["payment:manage"]

    B --> E["Moderate listings"]
    B --> F["Verify dealerships"]
    B --> G["Manage accounts"]
    B --> H["Read the audit log"]

    C --> I["Platform configuration"]
    D --> J["Refunds and payment corrections"]

    K["Admin"] --> B
    K -.-> |"withheld"| C
    K -.-> |"withheld"| D
```

Money and configuration are separated from day-to-day moderation on purpose:
the account that suspends users is not the account that can move funds. An
admin can remove a listing at three in the morning without also being able to
issue a refund.

---

# Transaction flows

## 1. Registration and email verification

```mermaid
sequenceDiagram
    participant U as Visitor
    participant API as Auth module
    participant DB as PostgreSQL
    participant Q as Queue
    participant M as Mail

    U->>API: POST /auth/register
    API->>API: validate, hash with bcrypt cost 12
    API->>DB: create user — status PENDING
    Note over API,DB: Role is BUYER, SELLER or DEALER.<br/>ADMIN is never self-assignable
    API->>Q: enqueue verification email
    Q->>M: send
    API-->>U: access and refresh tokens

    U->>API: GET /auth/email/verify with token
    API->>DB: mark email verified, status ACTIVE
    API-->>U: bidding, listing and ordering unlocked
```

Registering with the `DEALER` role and a dealership name creates the `Dealer`
record at `PENDING` in the same transaction — a dealer account without its
dealership would be a meaningless half-state.

## 2. Sign-in and token rotation

```mermaid
sequenceDiagram
    participant U as User
    participant API as Auth module
    participant DB as PostgreSQL

    U->>API: POST /auth/login
    API->>DB: look up by email
    API->>API: compare against the stored hash
    Note over API: A missing user is compared against a dummy hash,<br/>so a wrong email and a wrong password take the same time
    API-->>U: access token plus refresh token

    U->>API: POST /auth/refresh
    API->>DB: look up the SHA-256 digest of the token
    alt Token already used
        API->>DB: revoke the whole token family
        API-->>U: 401 — sign in again
    else Valid
        API->>DB: rotate, storing the new digest
        API-->>U: a new pair
    end
```

Replay of a refresh token is treated as theft: the entire family is revoked
rather than only the reused token.

## 3. Listing lifecycle

```mermaid
stateDiagram-v2
    [*] --> DRAFT: "seller creates"
    DRAFT --> PENDING_REVIEW: "submitted"
    PENDING_REVIEW --> ACTIVE: "admin approves"
    PENDING_REVIEW --> DRAFT: "admin rejects"
    ACTIVE --> IN_AUCTION: "auction goes live"
    IN_AUCTION --> ACTIVE: "auction ends unsold"
    ACTIVE --> SOLD: "order created"
    IN_AUCTION --> SOLD: "winner orders"
    ACTIVE --> SOLD: "seller sold it off the platform"
    SOLD --> ACTIVE: "order cancelled"
    SOLD --> DRAFT: "seller reopens — refused if an order exists"
    ACTIVE --> ARCHIVED: "seller withdraws"
    ACTIVE --> DRAFT: "seller unpublishes to edit"
    DRAFT --> ARCHIVED: "seller deletes"
    ARCHIVED --> DRAFT: "seller restores"
    ARCHIVED --> [*]
```

`GET /vehicles/:idOrSlug` returns an unpublished listing to its owner and to an
admin. To everyone else it is a **404, not a 403** — a 403 would confirm the
listing exists, which is enough to probe for ids.

A seller previewing their own listing does not inflate its view count.

## 4. Moderation

```mermaid
sequenceDiagram
    participant S as Seller
    participant API as Vehicles module
    participant A as Admin
    participant N as Notifications
    participant L as Audit log

    S->>API: PATCH /vehicles/:id/status — PENDING_REVIEW
    Note over S,API: The only statuses a seller may set are<br/>DRAFT, PENDING_REVIEW and ARCHIVED.<br/>ACTIVE is not reachable from here
    A->>API: GET /vehicles/pending-review
    Note over A,API: Needs vehicle:publish AND user:read.<br/>A seller has the first but not the second
    A->>API: PATCH /vehicles/:id/moderate
    alt Approved
        API->>API: status ACTIVE, publishedAt set
    else Rejected
        API->>API: status DRAFT with a reason
    end
    API->>N: notify the seller
    API->>L: append the decision, actor and target
```

Publication is a decision, so it has exactly one door. `PATCH /vehicles/:id`
cannot set `status` at all — the update schema omits the field, and the handler
spreads validated input straight into the write, so anything the schema accepts
is something the caller can set. `PATCH /vehicles/:id/status` accepts only the
statuses above, and checks the transition against the listing's current state.
A published listing can be unpublished to `DRAFT` in one step — that costs the
seller their approval, which is the point — but an archived listing returns to
`DRAFT` rather than straight back to review.

A seller may also mark a vehicle `SOLD` from any state that is on the market.
Cars are sold on the forecourt and in driveways, and a listing that cannot say
so is a listing people stop trusting; marking it sold is also better than
archiving it, because the vehicle stays visible with its outcome and
time-to-sale reporting keeps working. It is not a moderation bypass — it takes
a listing off sale rather than putting one up. Two guards apply to everyone,
administrators included: a vehicle in a scheduled or live auction cannot be
marked sold, and a vehicle sold through a real order cannot be reopened by
relabelling it — cancelling the order is what returns it to the marketplace.

`IN_AUCTION` is absent from both, because it describes a running auction rather
than a choice a seller makes; the auction flow sets and clears it.

## 5. Fixed-price purchase

```mermaid
sequenceDiagram
    participant B as Buyer
    participant API as Orders module
    participant DB as PostgreSQL
    participant S as Seller

    B->>API: POST /orders
    API->>DB: BEGIN
    API->>DB: check no live order exists for this vehicle
    API->>API: platform fee from the sale price
    API->>DB: create order — AWAITING_PAYMENT
    API->>DB: create payment — PENDING
    API->>DB: vehicle to SOLD
    Note over API,DB: Reserving the vehicle inside the same transaction<br/>is what stops a second buyer ordering it
    DB-->>API: COMMIT
    API-->>B: order reference

    B-->>S: pays by whatever means the order names
    S->>API: POST /orders/:id/payment
    Note over S,API: The seller records that funds arrived, not the buyer.<br/>Needs payment:manage AND being the seller on this order
    API->>DB: payment PAID, order AWAITING_DELIVERY

    S->>API: POST /orders/:id/complete
    API->>DB: order COMPLETED
```

### Order states

```mermaid
stateDiagram-v2
    [*] --> AWAITING_PAYMENT: "order created"
    AWAITING_PAYMENT --> PAID: "payment recorded"
    PAID --> AWAITING_DELIVERY: "settlement"
    AWAITING_DELIVERY --> COMPLETED: "delivery confirmed"
    AWAITING_PAYMENT --> CANCELLED: "cancelled"
    PAID --> DISPUTED: "buyer disputes"
    DISPUTED --> COMPLETED: "resolved"
    CANCELLED --> [*]
    COMPLETED --> [*]
```

Cancelling releases the vehicle: the order goes `CANCELLED`, the payment goes
`CANCELLED`, and the vehicle returns to `ACTIVE` with `soldAt` cleared.

### The fee

Charged on the sale price, added to the buyer's total:

| Sale price | Fee |
| --- | --- |
| $1,000 | $150 — the floor |
| $20,000 | $1,000 |
| $1,000,000 | $2,500 — the ceiling |

The floor keeps small lots worth processing; the ceiling stops a percentage
becoming absurd on an expensive vehicle.

## 6. Auction lifecycle

```mermaid
stateDiagram-v2
    [*] --> DRAFT: "seller creates"
    DRAFT --> SCHEDULED: "start time set"
    SCHEDULED --> LIVE: "worker opens it"
    LIVE --> LIVE: "bid inside the anti-snipe window extends it"
    LIVE --> ENDED: "worker closes it"
    ENDED --> SETTLED: "winner's order completes"
    DRAFT --> CANCELLED: "seller cancels"
    SCHEDULED --> CANCELLED: "seller cancels"
    LIVE --> CANCELLED: "admin cancels"
    SETTLED --> [*]
    CANCELLED --> [*]
```

## 7. Placing a bid

The most correctness-sensitive path in the platform.

```mermaid
sequenceDiagram
    participant B as Bidder
    participant API as Auctions module
    participant DB as PostgreSQL
    participant WS as Auction room
    participant Q as Queue

    B->>API: POST /auctions/:id/bids
    API->>API: bid:place, verified email, not the seller
    API->>DB: BEGIN SERIALIZABLE
    API->>DB: load the auction and the current price
    API->>API: check the amount clears the minimum increment
    API->>DB: mark previous leaders OUTBID
    API->>DB: insert the new bid as WINNING
    API->>DB: update currentBidCad and bidCount
    alt Inside the last two minutes
        API->>DB: extend endsAt by two minutes
    end
    DB-->>API: COMMIT or 40001
    alt Committed
        API-->>WS: broadcast to everyone watching
        API->>Q: notify the outbid bidder
        API-->>B: 201 with the new state
    else Serialization conflict
        API-->>B: 409 — review the price and bid again
    end
```

**Why serializable.** Two bidders hitting the same auction in the same
millisecond must not both be told they are winning. PostgreSQL aborts one and
the caller gets a 409 telling them to look at the new price — an honest answer
instead of a silently lost bid.

Verified under load: ten simultaneous bids produced two accepted, seven
serialization conflicts and one below-minimum rejection, leaving exactly one
`WINNING` row.

### Minimum increments

| Current price | Minimum raise |
| --- | --- |
| Below $5,000 | $100 |
| $5,000 – $19,999 | $250 |
| $20,000 – $49,999 | $500 |
| $50,000 – $99,999 | $1,000 |
| $100,000 and above | $2,500 |

### Bid states

```mermaid
stateDiagram-v2
    [*] --> WINNING: "highest bid"
    WINNING --> OUTBID: "someone bids higher"
    OUTBID --> WINNING: "they bid again and lead"
    WINNING --> WON: "auction closes with the reserve met"
    WINNING --> LOST: "auction closes below the reserve"
    OUTBID --> LOST: "auction closes"
    WON --> [*]
    LOST --> [*]
```

## 8. Auction close and settlement

```mermaid
sequenceDiagram
    participant W as Auction worker
    participant DB as PostgreSQL
    participant WS as Auction room
    participant N as Notifications
    participant B as Winner

    W->>DB: find auctions past endsAt
    W->>DB: BEGIN
    W->>DB: take the top bid, earliest first on a tie
    alt Top bid clears the reserve
        W->>DB: that bid WON, all others LOST
        W->>DB: auction ENDED with a winner
    else Reserve not met or no bids
        W->>DB: all bids LOST
        W->>DB: auction ENDED with no winner
        W->>DB: vehicle back to ACTIVE
    end
    DB-->>W: COMMIT
    W-->>WS: broadcast the close
    W->>N: notify the winner and the seller

    B->>DB: POST /orders for the won vehicle
    Note over B,DB: Only the winning bidder is accepted,<br/>and the price is the closing bid
```

Closing is idempotent. An auction already `ENDED` or `SETTLED` is left alone,
so a worker that runs twice cannot pick a second winner.

The reserve is never exposed. The API returns `reserveMet` and `hasReserve`;
the amount itself never leaves the server.

## 9. Inspection

```mermaid
sequenceDiagram
    participant A as Admin
    participant I as Inspector
    participant API as Inspections module
    participant V as Public listing

    A->>API: assign an inspection
    API->>API: status SCHEDULED
    I->>API: GET /inspections/mine
    I->>API: POST /inspections — begin
    API->>API: IN_PROGRESS
    I->>API: grade each section, note damage, attach photos
    I->>API: POST /inspections/:id/submit
    API->>API: COMPLETED with an overall grade
    API->>V: report appears on the listing
```

A completed report cannot be edited by its author. Correcting one means a new
inspection, which leaves both in the record.

## 10. Dealer verification

```mermaid
sequenceDiagram
    participant D as Dealer
    participant API as Dealers module
    participant A as Admin
    participant L as Audit log

    D->>API: register with dealership details
    API->>API: dealer PENDING
    Note over D,API: They can list immediately.<br/>Verification affects the badge, not the ability to sell
    A->>API: PATCH /dealers/:id/verification
    Note over A,API: Needs dealer:verify — which no dealer holds
    alt Verified
        API->>API: VERIFIED, badge on every listing
    else Rejected
        API->>API: REJECTED with a reason
    else Misconduct
        API->>API: SUSPENDED
    end
    API->>L: append the decision
```

## 11. Messaging

```mermaid
sequenceDiagram
    participant B as Buyer
    participant API as Messaging module
    participant S as Seller

    B->>API: POST /conversations with a vehicle and a message
    API->>API: one conversation per buyer per vehicle
    API-->>B: conversation
    API->>S: notification
    S->>API: POST /conversations/:id/messages
    API->>B: notification
    Note over B,S: Both sides read the same thread.<br/>Only the two participants can open it
```

The uniqueness constraint on `(vehicleId, buyerId)` is what stops a buyer
opening five threads about the same car.

## 12. Account suspension

```mermaid
sequenceDiagram
    participant A as Admin
    participant API as Users module
    participant U as The user
    participant L as Audit log

    A->>API: PATCH /admin/users/:id/status — SUSPENDED
    API->>L: append actor, target and reason
    U->>API: any request with a still-valid token
    API->>API: JwtAuthGuard re-reads the user
    API-->>U: 403 — the token is valid but the account is not
```

## 13. Audit

Every security- and money-relevant action is appended, never updated:
moderation decisions, dealer verification, account status changes, order
transitions, payment records. `audit:read` gates the query, so an admin can
read the trail and a dealer cannot.

---

# Status reference

| Entity | States |
| --- | --- |
| User | `PENDING` · `ACTIVE` · `SUSPENDED` · `DEACTIVATED` |
| Dealer | `PENDING` · `VERIFIED` · `REJECTED` · `SUSPENDED` |
| Vehicle | `DRAFT` · `PENDING_REVIEW` · `ACTIVE` · `IN_AUCTION` · `SOLD` · `ARCHIVED` |
| Auction | `DRAFT` · `SCHEDULED` · `LIVE` · `ENDED` · `SETTLED` · `CANCELLED` |
| Bid | `ACTIVE` · `OUTBID` · `WINNING` · `WON` · `LOST` · `RETRACTED` |
| Order | `INITIATED` · `AWAITING_PAYMENT` · `PAID` · `AWAITING_DELIVERY` · `COMPLETED` · `CANCELLED` · `DISPUTED` |
| Payment | `PENDING` · `AUTHORIZED` · `PAID` · `PARTIALLY_REFUNDED` · `REFUNDED` · `FAILED` · `CANCELLED` |
| Inspection | `SCHEDULED` · `IN_PROGRESS` · `COMPLETED` · `CANCELLED` |

# What these flows do not cover

- **Payments are recorded, not processed.** `POST /orders/:id/payment` stores a
  provider reference that something else must produce. There is no gateway, no
  authorisation hold and no settlement to a seller's bank account. The
  authorization around it says who may make that assertion; nothing verifies
  that the assertion is true, which is why a signed provider webhook has to
  replace this endpoint before it carries real money.
- **Disputes have a status but no workflow.** `DISPUTED` exists on the order;
  what happens next is a manual conversation.
- **Refunds are a permission without a flow.** `payment:manage` covers recording
  payment today; the refund and correction endpoints it is also meant to gate
  have not been built.
- **Proxy bidding is stored, not automated.** A bid can carry a ceiling, but
  nothing bids on the buyer's behalf as the price rises.

See [future work](./reference/future-work.md).
