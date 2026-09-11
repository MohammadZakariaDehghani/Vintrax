# Vintrax Platform Infrastructure Brief

**Prepared 10 September 2026 · draft for decision**

A cloud architecture and cost decision for Vintrax, Vintrax and Mobile at 500 users,
operated by one developer. Covers the capacity model, the compute decision,
security, disaster recovery, and the FinOps controls to put in place before
go-live.

|           |                    |
| --------- | ------------------ |
| Scope     | 3 applications     |
| Target    | 500 users          |
| Team      | 1 developer        |
| Residency | Canada             |
| Status    | Draft for decision |

---

## 00 — Pricing status: read this before using any number here

> **Verification could not be completed.**
>
> This brief was prepared in an environment whose network egress proxy **blocks
> `aws.amazon.com` and `calculator.aws` outright**. Google Cloud and Oracle
> pricing pages are reachable but render their price tables in JavaScript, so an
> automated fetch returns the service names and units with **no figures
> attached**. Web search surfaces AWS pricing pages but returns **US-region
> reference prices** — it explicitly could not resolve `ca-central-1`.
>
> The result: **current, region-specific unit prices for the three providers
> could not be verified.** Rather than attach invented source URLs and
> check-dates to recalled figures — the one failure mode that actually damages a
> procurement decision — every number below carries a confidence marker, and §07
> is a worksheet you fill from the three calculators in about 30 minutes.

### Confidence markers

| Marker       | Means                                                                                              | Safe to act on?   |
| ------------ | -------------------------------------------------------------------------------------------------- | ----------------- |
| `[verified]` | Confirmed against vendor documentation during preparation. Source and figure given inline.         | Yes               |
| `[derived]`  | Calculated from this repository — schema, limits, module structure. Independent of vendor pricing. | Yes               |
| `[estimate]` | Order-of-magnitude from prior knowledge. Directionally right; assume ±30%.                         | Planning only     |
| `[look up]`  | Materially affects the bill and must be confirmed in the provider calculator.                      | No — verify first |

### What was actually verified

- **AWS EKS control plane — US$0.10 per cluster-hour** (standard support),
  US$0.60 in extended support. `[verified]` via
  <https://aws.amazon.com/eks/pricing/>. Regional variance for `ca-central-1`
  not confirmed.
- **AWS NAT Gateway — approx. US$0.045/hour plus US$0.045/GB processed**, quoted
  as US East (Ohio). `[verified]` via
  <https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-pricing.html>.
  **The Canadian rate is higher** — treat this as a floor.

Both matter because they are fixed monthly charges that exist whether or not
anyone uses the platform. One NAT Gateway alone is roughly **US$33/month**
before a single byte moves.

**Exchange rate:** all CAD figures use **1 USD = 1.37 CAD** `[estimate]`.
Confirm the spot rate on the day you build the budget; a 5¢ move on a $500 bill
is $25.

---

## 01 — Executive summary

The brief asked which of three hyperscalers should host a Kubernetes platform.
The analysis says the more consequential decision is upstream of that: **whether
to run Kubernetes at all.**

> **The finding.** At 500 users the three clouds differ by roughly
> **US$150–250/month** for equivalent designs. The difference between running
> Kubernetes and running managed containers is roughly **US$400–700/month plus
> one to three days of engineering time every month**.
>
> For a one-developer team, the operating-model choice is worth several times
> the vendor choice. Choosing the cloud first is optimising the smaller variable.

### Five conclusions

1. **Do not deploy Kubernetes yet.** The workload is three stateless containers,
   one Postgres and one Redis. That is squarely inside what a managed container
   runtime handles with no cluster to patch, no control-plane fee, no node pools
   and no cluster autoscaler to tune. §04 works the numbers.
2. **Google Cloud, Montreal (`northamerica-northeast1`), on Cloud Run.** Best
   fit for a containerised monorepo run by one person, with Canadian residency.
3. **OCI Toronto is the cost-optimised alternative** and is credible — cheapest
   compute of the three and the most generous egress allowance. It costs
   developer velocity: a smaller ecosystem means more problems you solve alone.
4. **Skip managed search entirely.** The codebase already runs search behind a
   provider interface defaulting to Postgres. A managed OpenSearch cluster would
   add roughly US$150–300/month to solve a problem you do not have at 500 users,
   or at 5,000.
5. **Target 99.9%, not 99.95%.** Nothing above 99.9% is achievable by a team
   that sleeps. §15 is explicit about why claiming more is a liability.

### Expected spend

Ranges, not point estimates, because §00. Production plus staging, one region,
no Kubernetes. All rows `[estimate]`.

| Scenario                     | Low USD/mo | Expected USD/mo | High USD/mo | Expected CAD/mo |
| ---------------------------- | ---------: | --------------: | ----------: | --------------: |
| 500 users, low traffic       |        150 |             230 |         330 |             315 |
| 500 users, normal production |        220 |             340 |         480 |             466 |
| 500 users, high traffic      |        300 |             470 |         680 |             644 |
| 2,000 users                  |        380 |             600 |         850 |             822 |
| 10,000 users                 |        900 |           1,500 |       2,200 |           2,055 |
| 50,000 users                 |      3,200 |           5,500 |       8,500 |           7,535 |

The 500-user rows are the ones to verify first; the 50,000-user row is a
planning signal, not a budget.

---

## 02 — Application landscape

Taken from the Vintrax repository directly, not from the brief's description.
Vintrax and Mobile were not available for inspection and are modelled from the
brief. `[derived]`

| Component                | Stack                   | Shape                                                 | Statefulness                         |
| ------------------------ | ----------------------- | ----------------------------------------------------- | ------------------------------------ |
| **Vintrax API**          | NestJS 11, Node 22      | 15 modules, REST + WebSocket, 25 runtime dependencies | Stateless, except WebSocket sessions |
| **Vintrax Web**          | Next.js 15 App Router   | 32 routes, server-rendered                            | Stateless                            |
| **Vintrax Mobile**       | Next.js PWA             | 16 routes, service worker, camera capture             | Stateless                            |
| **Vintrax API**          | FastAPI / Python        | Dealer workflows, document upload                     | Stateless `[estimate]`               |
| **Vintrax Admin + site** | Web                     | Admin console, marketing site                         | Stateless `[estimate]`               |
| **PostgreSQL 16**        | Prisma 6                | ~25 models, serializable transactions on the bid path | **Stateful**                         |
| **Redis 7**              | ioredis + BullMQ        | Cache, plus 4 queues                                  | Semi-stateful                        |
| **Object storage**       | Local disk or S3 driver | 5 folders, 10 MB cap, 30 images/listing               | **Stateful**                         |

### Three facts that shape the architecture

- **WebSockets are load-bearing.** Live auctions run over an `/auctions` socket
  namespace. Any compute platform must support long-lived connections with
  session affinity — this rules some serverless options out and constrains others.
- **Four background queues exist** — `notifications`, `search-indexing`,
  `auction-lifecycle`, `email`. These are _long-running consumers_, not request
  handlers. A scale-to-zero runtime cannot host them without a dedicated
  always-on service.
- **Search already abstracts its backend.** `SEARCH_PROVIDER` defaults to
  `postgres` with OpenSearch behind the same interface. Managed search is a
  switch to flip later, not an architecture to build now.

---

## 03 — Capacity model

Everything downstream depends on these numbers. The brief's warning is correct —
500 registered users is nowhere near 500 concurrent users. `[derived]` where the
codebase constrains it, `[estimate]` for traffic shape.

| Metric                   |      Value | Basis                                                             |
| ------------------------ | ---------: | ----------------------------------------------------------------- |
| Registered users         |        500 | Given                                                             |
| Monthly active           |        200 | 40% — marketplace norm; buyers return in bursts around a purchase |
| Daily active             |         35 | 7% of registered                                                  |
| Peak concurrent          |      12–20 | Weekday evening peak; auction close spikes higher                 |
| Requests/second, average |        1–2 | Derived from DAU × session depth                                  |
| Requests/second, peak    |      15–25 | Auction close is the peak, not browsing                           |
| API requests/day         |    120,000 | Includes SSR fetches and unread-count polling every 60 s          |
| DB transactions/day      |    180,000 | ~1.5× requests; bid path uses serializable isolation              |
| Concurrent WebSockets    |       5–40 | Only during live auctions; near zero otherwise                    |
| Uploads/day              |     60–150 | Listing photos, inspection photos, licences. 10 MB cap enforced   |
| Object storage, year 1   | 150–400 GB | See §11 for the growth calculation                                |
| Database size, year 1    |    8–20 GB | Rows are small; images are not in Postgres                        |
| CDN egress/month         | 100–300 GB | Image-dominated. The single most volatile line                    |
| Logs + metrics/month     |   15–40 GB | The most commonly under-budgeted line item                        |

**Sensitivity.** Only three of these are worth monitoring closely. **CDN egress**
scales with image bytes and is the first line to surprise you. **Log volume**
grows with request count and with debug logging left on after an incident.
**Object storage** only ever grows unless lifecycle rules exist.

Compute and database at this scale are nearly flat — you are paying for
availability, not throughput. Doubling users from 500 to 1,000 moves the bill by
well under 20%.

**The headroom reality:** peak load is **15–25 requests per second**. A single
modern 2 vCPU container running Node handles that with the CPU mostly idle. This
is the number that makes the Kubernetes question answer itself.

---

## 04 — The compute decision: Kubernetes or not

The brief flags this comparison as important. It is the most important thing in
this document.

| Option                 | What it is                                                                                                                | Cost `[estimate]` | Verdict             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------- |
| **Managed containers** | Cloud Run, App Runner, OCI Container Instances. Push an image, get TLS, a URL, autoscaling and health checks. No cluster. | ~US$180–320/mo    | **Recommended**     |
| **Two VMs + Docker**   | Cheapest. You patch the OS, manage TLS renewal, handle restarts, and own uptime personally.                               | ~US$120–200/mo    | Viable, higher toil |
| **Managed Kubernetes** | Control plane fee, minimum 3 nodes for HA, ingress controller, cert-manager, autoscaler, upgrades every ~4 months.        | ~US$600–1,000/mo  | Premature           |

### Why Kubernetes costs more than its line items

The invoice difference is roughly **US$400–700/month**. The larger cost is not on
the invoice:

- **Cluster version upgrades.** Managed Kubernetes moves roughly three times a
  year and support windows expire. AWS charges **6× the control-plane rate** for
  clusters left on an unsupported version — US$0.60/hour against US$0.10
  `[verified]`. That is a US$365/month penalty for falling behind on upgrades,
  which is exactly what a one-person team does when shipping features.
- **You inherit an ingress controller, cert-manager, an autoscaler and a metrics
  stack** — four more components to keep patched, each with its own CVE feed.
- **Three nodes minimum for real HA.** At 20 requests/second those nodes are
  idle. You pay for scheduling capacity you cannot use.
- **Debugging surface.** When a pod will not start at 23:00, the failure could be
  the image, the manifest, RBAC, a network policy, a PVC, a taint, or the node
  pool. On a managed container runtime it is the image or the environment
  variables.

> **When Kubernetes becomes correct.** Adopt it when any two of these are true:
> **more than about eight distinct services**; **a second engineer** who can own
> the platform; **sustained load above roughly 200 requests/second**; or a
> genuine need for pod-level scheduling control. None hold today.

**What about the existing Kubernetes and Terraform in the repo?** Keep both. The
Terraform is the foundation you will use from day one. The manifests in
`infrastructure/kubernetes/` are a documented migration path — valuable as an
artefact, expensive as a deployment target. Nothing here throws that work away.

---

## 05 — Three clouds, three designs

| Layer                    | AWS · ca-central-1                | GCP · northamerica-northeast1 | OCI · ca-toronto-1               |
| ------------------------ | --------------------------------- | ----------------------------- | -------------------------------- |
| Region city              | Montreal                          | Montreal                      | Toronto                          |
| Second Canadian region   | Calgary                           | Toronto                       | Montreal                         |
| Containers (recommended) | App Runner                        | **Cloud Run**                 | Container Instances              |
| Containers (K8s path)    | EKS                               | GKE Autopilot                 | OKE                              |
| PostgreSQL               | RDS PostgreSQL                    | Cloud SQL                     | DB with PostgreSQL               |
| Redis                    | ElastiCache                       | Memorystore                   | OCI Cache with Redis             |
| Object storage           | S3                                | Cloud Storage                 | Object Storage                   |
| CDN                      | CloudFront                        | Cloud CDN                     | OCI CDN                          |
| WAF                      | AWS WAF                           | Cloud Armor                   | OCI WAF                          |
| Secrets                  | Secrets Manager                   | Secret Manager                | Vault                            |
| Email                    | SES                               | via SendGrid/Resend           | Email Delivery                   |
| Egress posture           | Charged per GB, NAT charged twice | Charged per GB                | Large monthly allowance included |

### The structural differences that matter

**AWS** — deepest service catalogue and the best chance any given problem
already has a public answer. Its networking is the most expensive of the three:
NAT Gateway charges an hourly fee _and_ a per-GB fee, and traffic through it
also pays egress — the same byte billed twice. App Runner is competent but less
mature than Cloud Run.

**GCP** — Cloud Run is the best fit in the market for exactly this workload. A
container, a port, and it handles TLS, scaling, revisions and traffic splitting.
Two constraints to verify: WebSockets need session affinity enabled and cap at a
60-minute request lifetime, and queue workers need a minimum-instance service
rather than scale-to-zero.

**OCI** — cheapest compute of the three by a wide margin on Ampere ARM, and the
most generous included egress, which becomes decisive above roughly 10,000
users. The cost is ecosystem depth: fewer integrations, thinner community
answers, and managed services that lag their AWS and GCP equivalents.

### Three tiers, for each cloud

| Tier                           | Shape                                                                                                                                   | Availability | Fits                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------ | -------------------------- |
| **A — Cost optimised**         | Managed containers, single-zone Postgres with PITR, single Redis, CDN, WAF, daily backups. No K8s, no read replica, no cross-region DR. | ~99.5% real  | 500 users. **Start here.** |
| **B — Recommended enterprise** | Tier A plus HA Postgres with automatic failover, HA Redis, staging environment, full observability, cross-region backup copies.         | ~99.9%       | 500–10,000 users           |
| **C — HA / growth**            | Tier B plus read replica, multi-zone everywhere, warm standby in the second Canadian region, aggressive autoscaling, tracing.           | ~99.95%      | 10,000+ users              |

**Deploy Tier A now, Tier B within 90 days.** Tier A alone is not enough for a
platform handling payments: it has no database failover, so a zone incident is a
multi-hour outage. Tier B is the honest production target.

---

## 06 — Cost model: Tier B, 500 users

Production plus staging, one region, no Kubernetes. Every figure is `[estimate]`
or `[look up]` per §00. Use §07 to replace them.

| Line item                            | Type     |     AWS |     GCP |     OCI | Confidence         |
| ------------------------------------ | -------- | ------: | ------: | ------: | ------------------ |
| Container compute — 3 services, prod | Infra    |      95 |      80 |      45 | `[look up]`        |
| Queue worker — always on             | Infra    |      25 |      25 |      12 | `[look up]`        |
| PostgreSQL — HA, 2 vCPU / 8 GB       | Managed  |     140 |     130 |      85 | `[look up]`        |
| PostgreSQL storage — 100 GB          | Infra    |      25 |      22 |      15 | `[estimate]`       |
| DB backup storage + PITR             | Managed  |      12 |      10 |       6 | `[estimate]`       |
| Redis — HA, ~2 GB                    | Managed  |      55 |      50 |      30 | `[look up]`        |
| Object storage — 300 GB              | Infra    |       8 |       8 |       7 | `[estimate]`       |
| CDN — 200 GB egress                  | Transfer |      18 |      17 |       0 | `[look up]`        |
| Load balancer                        | Infra    |      22 |      20 |      12 | `[estimate]`       |
| **NAT gateway / equivalent**         | Infra    |      35 |      32 |       0 | `[verified floor]` |
| Egress beyond CDN                    | Transfer |      10 |       9 |       0 | `[estimate]`       |
| WAF                                  | Managed  |      20 |      18 |      12 | `[look up]`        |
| DNS                                  | Managed  |       2 |       2 |       1 | `[estimate]`       |
| Secrets + KMS                        | Managed  |       8 |       7 |       3 | `[estimate]`       |
| Container registry                   | Infra    |       5 |       5 |       3 | `[estimate]`       |
| **Logs + metrics — 25 GB**           | Managed  |      40 |      35 |      20 | `[look up]`        |
| Uptime + alerting                    | Managed  |       5 |       3 |       3 | `[estimate]`       |
| Transactional email — 20k            | Managed  |       2 |      10 |       2 | `[estimate]`       |
| **Staging environment**              | Infra    |      70 |      60 |      35 | `[estimate]`       |
| **Subtotal, infrastructure**         |          | **597** | **543** | **291** |                    |
| Cloud support plan                   | Support  |     100 |      29 |       0 | `[look up]`        |
| Sentry / error tracking              | Optional |      26 |      26 |      26 | `[estimate]`       |
| Domain registration                  | Fixed    |       2 |       2 |       2 | `[estimate]`       |
| **Total USD / month**                |          | **725** | **600** | **319** |                    |
| **Total CAD / month**                |          | **993** | **822** | **437** |                    |

> **Do not treat these totals as quotes.** The _relative ordering_ — OCI
> cheapest, GCP middle, AWS highest — is robust and rests on structural
> differences: ARM pricing, included egress, and NAT charging models. The
> _absolute figures_ are unverified and could each be wrong by 30%.

**Tier A, for comparison.** Dropping to single-zone database, single Redis, and
no staging removes roughly US$250–300/month — putting GCP near US$300/month and
OCI near US$170. That is the true launch floor, and the gap between Tier A and
Tier B is the price of database failover and a place to test.

---

## 07 — Pricing worksheet

The quantities are derived from this codebase and are sound. Take them to the
three calculators and fill in the unit prices. Roughly 30 minutes per cloud.

| Service                           | Unit               |              Quantity | Unit price |  Monthly |
| --------------------------------- | ------------------ | --------------------: | ---------: | -------: |
| Container compute — API           | vCPU-hr + GB-hr    |   1 vCPU / 2 GB × 730 |        ___ |      ___ |
| Container compute — Web           | vCPU-hr + GB-hr    |   1 vCPU / 2 GB × 730 |        ___ |      ___ |
| Container compute — Mobile        | vCPU-hr + GB-hr    | 0.5 vCPU / 1 GB × 730 |        ___ |      ___ |
| Container compute — Worker        | vCPU-hr + GB-hr    | 0.5 vCPU / 1 GB × 730 |        ___ |      ___ |
| Managed PostgreSQL, HA            | instance-hr        |   2 vCPU / 8 GB × 730 |        ___ |      ___ |
| PostgreSQL storage                | GB-month           |                   100 |        ___ |      ___ |
| PostgreSQL backup                 | GB-month           |                   150 |        ___ |      ___ |
| Managed Redis, HA                 | GB-hr              |            2 GB × 730 |        ___ |      ___ |
| Object storage — standard         | GB-month           |                   300 |        ___ |      ___ |
| Object storage — requests         | per 10k            |              ~500k/mo |        ___ |      ___ |
| CDN egress                        | GB                 |                   200 |        ___ |      ___ |
| Load balancer — base              | hour               |                   730 |        ___ |      ___ |
| Load balancer — capacity          | LCU / unit-hr      |              ~2 × 730 |        ___ |      ___ |
| NAT — hourly                      | hour               |                   730 |        ___ |      ___ |
| NAT — data processed              | GB                 |                   100 |        ___ |      ___ |
| Internet egress (non-CDN)         | GB                 |                   120 |        ___ |      ___ |
| WAF — base + rules                | month + per rule   |       1 ACL, ~6 rules |        ___ |      ___ |
| WAF — requests                    | per million        |                     4 |        ___ |      ___ |
| DNS hosted zone + queries         | zone + per M       |         2 zones, ~3 M |        ___ |      ___ |
| Secrets manager                   | secret-month       |                   ~25 |        ___ |      ___ |
| KMS keys                          | key-month          |                     3 |        ___ |      ___ |
| Container registry                | GB-month           |                    20 |        ___ |      ___ |
| Log ingestion                     | GB                 |                    25 |        ___ |      ___ |
| Log retention — 30 days           | GB-month           |                    25 |        ___ |      ___ |
| Custom metrics                    | per metric-month   |                  ~150 |        ___ |      ___ |
| Uptime checks                     | per check          |                     6 |        ___ |      ___ |
| Transactional email               | per 1,000          |                    20 |        ___ |      ___ |
| Cross-region backup copy          | GB + transfer      |                   150 |        ___ |      ___ |
| Support plan                      | % of spend or flat |                     — |        ___ |      ___ |
| **Production total**              |                    |                       |            | **\___** |
| **Staging (≈ 40% of production)** |                    |                       |            | **\___** |
| **Grand total, USD/month**        |                    |                       |            | **\___** |

### Where to get the numbers

- **AWS** — <https://calculator.aws/>, region Canada (Central).
- **GCP** — <https://cloud.google.com/products/calculator>, region
  `northamerica-northeast1`.
- **OCI** — <https://www.oracle.com/cloud/costestimator.html>, region Canada
  Southeast (Toronto).

Four line items to check with particular care, because they are the ones that
surprise people: **NAT data processing**, **log ingestion**, **CDN egress**, and
**the support plan minimum**.

---

## 08 — Growth model and TCO

All `[estimate]`, GCP Tier B basis.

| Users      | USD/mo | USD/yr | Dominant driver        | Architecture change                       | Redesign?         |
| ---------- | -----: | -----: | ---------------------- | ----------------------------------------- | ----------------- |
| 500 low    |    230 |  2,760 | Fixed baseline         | None — Tier A                             | No                |
| 500 normal |    340 |  4,080 | Database HA            | Tier B                                    | No                |
| 500 high   |    470 |  5,640 | Egress, logs           | Tune CDN cache                            | No                |
| 2,000      |    600 |  7,200 | Compute, egress        | Larger DB tier                            | No                |
| 10,000     |  1,500 | 18,000 | Database, CDN          | Read replica; consider OpenSearch         | No                |
| 50,000     |  5,500 | 66,000 | Database, egress, logs | Kubernetes, sharded caching, multi-region | **Yes — planned** |

### Three-year TCO

| Year             | Assumption                               |  Infra USD | Tooling USD |  Total USD |  Total CAD |
| ---------------- | ---------------------------------------- | ---------: | ----------: | ---------: | ---------: |
| Year 1           | Tier A → B, 500 → 1,500 users            |      4,300 |         700 |      5,000 |      6,850 |
| Year 2           | Tier B, 1,500 → 6,000 users, 1-yr commit |      9,800 |         900 |     10,700 |     14,659 |
| Year 3           | Tier B/C, 6,000 → 15,000 users           |     21,000 |       1,400 |     22,400 |     30,688 |
| **3-year total** |                                          | **35,100** |   **3,000** | **38,100** | **52,197** |

**Not included:** engineering salary, which dwarfs all of it. That is exactly why
§04 optimises for operational simplicity over invoice minimum — one day per
month of avoided Kubernetes toil is worth more than the entire infrastructure
difference between the three clouds.

**Commitment discounts.** Do not commit in year one. Usage patterns are unknown
and a one-year commitment on the wrong instance family is a year of waste. From
month 9, when the baseline is established, one-year commitments on the database
and the always-on compute typically return 20–35% `[estimate]`. Never commit on
burst compute, and never on storage.

---

## 09 — Reference architecture

```
                        Internet
                           │
                    ┌──────┴──────┐
                    │  Cloud DNS  │  authoritative, health checks
                    └──────┬──────┘
                           │
                  ┌────────┴────────┐
                  │   CDN  +  WAF   │  static assets, images, OWASP rules,
                  └────────┬────────┘  rate limiting, DDoS absorption
                           │
                  ┌────────┴────────┐
                  │  Load balancer  │  TLS termination, managed certificate
                  └────────┬────────┘
                           │
╔══════════════════════════╪══════════════════════════════════════════╗
║  PUBLIC SUBNET           │                                          ║
║   · load balancer        │                                          ║
║   · NAT egress           │                                          ║
╠══════════════════════════╪══════════════════════════════════════════╣
║  PRIVATE APPLICATION SUBNET — no inbound from internet              ║
║                          │                                          ║
║   ┌──────────┐   ┌───────┴────┐   ┌──────────┐   ┌──────────────┐  ║
║   │ Vintrax    │   │ Vintrax API  │   │ Vintrax    │   │ Queue worker │  ║
║   │ Web      │   │ REST + WS  │   │ Mobile   │   │ always on    │  ║
║   └────┬─────┘   └──────┬─────┘   └────┬─────┘   └──────┬───────┘  ║
║        │                │              │                │          ║
║   ┌────┴─────┐   ┌──────┴─────┐                                    ║
║   │ Vintrax  │   │ Vintrax    │        separate service accounts,  ║
║   │ API      │   │ Admin      │        separate DB credentials      ║
║   └────┬─────┘   └──────┬─────┘                                    ║
╠════════╪════════════════╪═══════════════════════════════════════════╣
║  PRIVATE DATA SUBNET — no route to internet at all                  ║
║        │                │                                           ║
║   ┌────┴────────────────┴────┐   ┌──────────┐   ┌────────────────┐ ║
║   │  PostgreSQL  (HA pair)   │   │  Redis   │   │ Object storage │ ║
║   │  primary + standby       │   │  HA      │   │ private bucket │ ║
║   └──────────────────────────┘   └──────────┘   └────────────────┘ ║
╚═════════════════════════════════════════════════════════════════════╝
```

- **Three subnet tiers.** Only the load balancer and NAT sit in public.
  Application containers have no public IP. The data tier has no internet route
  in either direction.
- **NAT exists for outbound only** — package registries, the email provider,
  OAuth token verification. It is a cost line and a chokepoint worth monitoring.
- **Object storage is private.** Public read is never enabled. The CDN reads
  through an origin identity; the application issues time-limited signed URLs.
- **Vintrax and Vintrax share the network but not identity.** Separate service
  accounts, separate database roles, separate buckets. Logical isolation is
  sufficient at this size; separate accounts per product would triple the
  operational surface for one developer.

---

## 10 — Database architecture

> **One instance, three databases.** Run **one managed PostgreSQL instance**
> hosting separate logical databases for Vintrax and Vintrax, each with its own
> role and no cross-database grants. Mobile has no database of its own — it is a
> client of both APIs. Separate instances would roughly double the database bill
> and double the patching, backup verification and connection management, to buy
> isolation that separate roles already provide at this scale.

**Revisit when** the two products have materially different load profiles, when a
compliance obligation demands physical separation, or when one product's traffic
can starve the other. None applies at 500 users.

| Aspect       | Tier A                     | Tier B (target)        | Tier C                           |
| ------------ | -------------------------- | ---------------------- | -------------------------------- |
| Instance     | 2 vCPU / 8 GB, single zone | 2 vCPU / 8 GB, HA pair | 4 vCPU / 16 GB, HA + replica     |
| Failover     | Manual restore             | Automatic, 1–2 min     | Automatic + read routing         |
| Backups      | Daily automated            | Daily + PITR 7 days    | Daily + PITR 35 days             |
| Backup copy  | Same region                | Second Canadian region | Second region + quarterly export |
| Read replica | No                         | No                     | Yes                              |
| Storage      | 100 GB, autogrow           | 100 GB, autogrow       | 250 GB                           |

**Connection pooling is not optional.** Managed containers scale horizontally and
each instance opens its own Prisma pool. Five instances × 10 connections
exhausts a small Postgres instance's limit quickly. Put **PgBouncer in
transaction mode** in front, or use the provider's built-in pooler. This is the
single most likely cause of a first production outage on this architecture.

**Migrations.** The repository already runs `prisma migrate deploy` in CI against
a real Postgres, which is the right pattern. In production, migrations run as a
discrete step before the new revision takes traffic — never inside container
startup, where three parallel instances would race the same migration.

---

## 11 — Storage architecture

| Bucket                | Contents                      | Access                              | Lifecycle            | Retention                   |
| --------------------- | ----------------------------- | ----------------------------------- | -------------------- | --------------------------- |
| `vintrax-vehicles`    | Listing photos                | CDN via origin identity             | → infrequent at 90 d | Life of listing + 1 yr      |
| `vintrax-inspections` | Inspection photos             | CDN, public reports only            | → infrequent at 90 d | 7 years                     |
| `vintrax-articles`    | Editorial images              | CDN                                 | Standard             | Indefinite                  |
| `vintrax-documents`   | Titles, CarFax, bills of sale | **Private. Signed URL only**        | → archive at 1 yr    | 7 years                     |
| `vintrax-licences`    | **Driver's licence images**   | **Private. Signed URL, short TTL**  | **No tiering**       | **30–90 days, auto-delete** |
| `platform-backups`    | DB dumps, config              | No public access, versioned, locked | → archive at 30 d    | 1 year                      |

**Growth** `[derived]` — the upload cap is 10 MB and a listing takes up to 30
images. Realistically: 2 MB average after processing × 12 images × 40 new
listings/month ≈ **1 GB/month** from listings. Inspections add ~0.5 GB. Licences
are small and deleted on schedule. **Year 1 lands at 150–400 GB.**

**Image processing pays for itself.** Sharp is already a backend dependency.
Generating WebP derivatives at three widths on upload cuts CDN egress — the most
volatile line in §06 — by roughly 60–70% against serving originals. Highest-return
optimisation available, and it costs one background job.

---

## 12 — Security architecture

The existing codebase already establishes the right patterns — permission checks
in services rather than only on routes, documents withheld by default, strict
schemas that refuse rather than silently strip. The infrastructure layer should
match that standard.

- **Identity.** Workload identity rather than static keys — containers assume a
  service identity, no credentials in environment variables. Separate identity
  per service. Human access via SSO with mandatory MFA.
- **Secrets.** Managed secret store, injected at runtime, never baked into
  images. Automatic rotation for database credentials. The `JWT_ACCESS_SECRET`
  and `JWT_REFRESH_SECRET` the app validates at boot live here — the app already
  refuses placeholder values in production, which is correct.
- **Network.** Three-tier subnets per §09. Database and Redis unreachable from
  the internet. Security groups default-deny.
- **Edge.** WAF with managed OWASP rules, rate limiting on `/auth/*` matching the
  application's own credential throttle, bot control on search endpoints.

### Driver's licence images — the highest-sensitivity path

> **Treat as regulated personal data under PIPEDA.** A driver's licence image is
> government identity documentation. If it leaks, the harm is identity theft,
> not embarrassment.

1. **Private bucket, no exceptions.** Never CDN-fronted. Public access blocked at
   the account level, not just the bucket.
2. **Signed URLs with a 5-minute TTL**, issued only after an authorization check
   that names the specific record.
3. **Separate KMS key** from all other data, with its own access policy and audit
   trail.
4. **Malware scan on upload** before the object becomes readable.
5. **Automatic deletion at 30–90 days**, enforced with a lifecycle rule, not a
   cron job someone might disable. If the reason for holding it has passed,
   holding it is pure liability.
6. **Every access logged** — who, which record, when. Retained a year.
7. **Never in application logs.** No filenames, no URLs, no base64 fragments.

**Pipeline security.** CI already runs `pnpm audit --audit-level high` as a
blocking gate plus a Trivy filesystem scan. Add container image scanning in the
registry, SAST via CodeQL on pull requests, and secret scanning with push
protection. DAST is not justified yet.

**Backup protection.** Backups in a separate bucket with object versioning and a
retention lock, in a second region, under credentials the application never
holds. The threat is a compromised deployment credential deleting backups
alongside data.

**SIEM — not yet.** Native cloud audit logging with alerting on the handful of
events that matter (root login, IAM change, security group change, KMS key
deletion, backup deletion) covers the realistic threat model. A SIEM is a product
that needs an operator.

---

## 13 — Observability

> **Managed, not self-hosted.** Running Prometheus, Grafana and Loki yourself
> trades roughly US$30–40/month of managed cost for a distributed system you now
> operate — one that, by construction, must stay up when everything else is down.

| Need                 | Use                        | USD/mo | Why                                           |
| -------------------- | -------------------------- | -----: | --------------------------------------------- |
| Metrics + dashboards | Native cloud monitoring    |  10–20 | Already collecting; zero setup                |
| Logs                 | Native, 30-day retention   |  20–35 | Structured JSON from the app                  |
| Error tracking       | **Sentry**                 |     26 | The one paid add-on worth it                  |
| Uptime               | Native checks, 6 endpoints |    3–5 | External view of what users see               |
| Alerting             | Native → email + phone     |    0–3 | One person on call; keep alerts few and real  |
| Tracing              | **Defer**                  |      0 | Valuable across many services. There are six. |
| APM                  | **Defer**                  |      0 | Sentry performance covers it to ~10,000 users |

### The five alerts worth waking up for

1. Health endpoint failing for 3 minutes
2. API 5xx rate above 2% for 5 minutes
3. Database CPU above 85% for 10 minutes, or connections above 80% of limit
4. Queue depth growing for 15 minutes — earliest signal of a stuck worker
5. Certificate expiring within 14 days

Everything else is a dashboard, not a page. An on-call rotation of one person
fails through alert fatigue faster than through missing alerts.

**The log cost trap.** Log ingestion is billed per GB and debug logging left on
after an incident is the classic way a US$35 line becomes US$300. Set a budget
alert on the logging service specifically, not just on the account total.

---

## 14 — CI/CD and infrastructure as code

**GitHub Actions plus Terraform plus the provider CLI is sufficient.** Argo CD,
Flux and cloud-native pipelines all solve problems that appear with many services
and many engineers.

```
  push to feature branch
        │
        ├─→ CI: install → prisma generate → migrate → typecheck
        │       → lint → test → build → seed idempotency check
        ├─→ Security: pnpm audit (blocking) → Trivy → CodeQL
        │
  pull request → review → merge to main
        │
        ├─→ build image → scan → push to registry, tagged by SHA
        ├─→ terraform plan (posted to PR) → apply on merge
        ├─→ deploy to STAGING → smoke tests
        │
        └─→ manual approval  ← the one human gate
                │
                ├─→ run migrations as a discrete step
                ├─→ deploy revision, 10% traffic
                ├─→ watch error rate 10 min
                ├─→ shift to 100%
                └─→ rollback = shift traffic to previous revision
```

Managed container runtimes keep the previous revision addressable, which makes
**rollback a traffic shift measured in seconds** rather than a redeploy measured
in minutes.

### Terraform layout

```
infrastructure/
  modules/
    network/        subnets, NAT, firewall rules
    data/           postgres, redis, private access
    runtime/        container services, service accounts
    edge/           load balancer, CDN, WAF, DNS
    observability/  dashboards, alert policies, budgets
  environments/
    staging/        main.tf, terraform.tfvars, backend.tf
    production/     main.tf, terraform.tfvars, backend.tf
  bootstrap/        state bucket, lock table, CI identity
```

**State** lives in a versioned object-storage bucket with locking, one state file
per environment, created by `bootstrap/` before anything else and never destroyed
by the pipeline that uses it. CI authenticates by workload identity federation —
**no cloud credentials stored as GitHub secrets.**

**Environments are the same modules with different variables.** Staging differing
structurally from production means staging tests something that does not exist.

---

## 15 — SLA, RPO and RTO

| Target | Downtime/month | Downtime/year | What it demands                                             | Feasible with one developer? |
| ------ | -------------: | ------------: | ----------------------------------------------------------- | ---------------------------- |
| 99.9%  |         43 min |         8.8 h | HA database, managed runtime, good alerting                 | **Yes**                      |
| 99.95% |         22 min |         4.4 h | Multi-zone everywhere, tested failover, fast human response | Only in business hours       |
| 99.99% |        4.3 min |        53 min | Multi-region active-active, follow-the-sun on-call          | **No**                       |

> **Recommended: 99.9%, and do not publish more.** A 99.99% target means the
> entire yearly downtime budget is spent by one person sleeping through one
> alert. Committing to it contractually creates an obligation you cannot meet.

| Objective                     | Tier A    | Tier B (target)            | Tier C                     |
| ----------------------------- | --------- | -------------------------- | -------------------------- |
| **RPO** — data loss tolerated | 24 hours  | **5 minutes**              | 1 minute                   |
| **RTO** — zone failure        | 2–4 hours | **15 minutes**             | 5 minutes                  |
| **RTO** — region failure      | Undefined | **4–8 hours**              | 1 hour                     |
| Backup frequency              | Daily     | Daily + continuous WAL     | Daily + continuous         |
| Retention                     | 7 days    | 30 days + monthly for 1 yr | 35 days + monthly for 7 yr |

Moving from Tier A to Tier B costs roughly US$250–300/month `[estimate]` and buys
automatic database failover, a staging environment, and cross-region backup
copies. **That is the best-value increment in this entire document.**

---

## 16 — Disaster recovery runbook

Scenario: the primary Canadian region is unavailable with no published
restoration estimate. Target RTO 4–8 hours, RPO 5 minutes.

|   # | Step                    | Elapsed | Detail                                                                                                                                       |
| --: | ----------------------- | ------: | -------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | Declare                 |    0:00 | Confirm via the provider status page and an external uptime check — not your own dashboard, which shares the failure. Post a status message. |
|   2 | Recreate infrastructure |    0:15 | `cd environments/production-dr && terraform apply`. Same modules, second region variable. Works only if rehearsed.                           |
|   3 | Restore database        |    1:00 | Restore the cross-region backup copy to a new instance. Longest step — 30–90 min for 100 GB. Verify row counts.                              |
|   4 | Object storage          |    1:15 | Already replicated if cross-region replication was enabled. If not, this is where you learn that.                                            |
|   5 | Secrets                 |    1:30 | Recreate from the secret store's cross-region replica. Database credentials will differ — the new instance issues its own.                   |
|   6 | Redeploy applications   |    2:00 | Same images from the registry, pointed at new endpoints. Registry must be multi-region or this stalls.                                       |
|   7 | DNS cutover             |    2:30 | Update records to the new load balancer. **Keep TTL at 60 seconds in normal operation** — a 3,600-second TTL adds an hour here.              |
|   8 | Validate                |    3:00 | Sign in, load a listing, place a test bid, upload an image, send an email. Check the five alerts report.                                     |
|   9 | Fail back               |   +days | When the primary returns: replicate deltas back, cut DNS in a low-traffic window, decommission DR.                                           |

> **An untested DR plan is a hope.** Rehearse **twice yearly** against a real
> restore into a scratch environment, and time it. The first rehearsal always
> reveals something — most commonly a secret created by hand that exists nowhere
> in Terraform. Budget a full day; the drill costs roughly US$40–80 in transient
> resources `[estimate]`.

**Ongoing DR cost:** cross-region backup copies and replication run roughly
US$30–60/month `[estimate]`. A warm standby would cost 60–80% of production and
is not justified below roughly 10,000 users.

---

## 17 — Scorecard

Weighted per the brief. Cost is scored on the _structural_ cost position — ARM
pricing, included egress, NAT model — which holds even though the absolute
figures are unverified.

| Criterion              |   Weight |     AWS |     GCP |     OCI | Reasoning                                                                                                         |
| ---------------------- | -------: | ------: | ------: | ------: | ----------------------------------------------------------------------------------------------------------------- |
| Cost                   |      25% |       5 |       7 |       9 | OCI's ARM pricing and egress allowance are structurally cheaper; AWS's NAT and egress model is the most expensive |
| Security               |      15% |       9 |       9 |       7 | AWS and GCP have deeper tooling and more mature defaults                                                          |
| Reliability            |      15% |       9 |       9 |       7 | Longer public track records in Canadian regions                                                                   |
| Scalability            |      10% |       9 |       9 |       8 | All three scale far past 50,000 users                                                                             |
| Operational simplicity |      15% |       6 |       9 |       7 | **Cloud Run is the decisive factor**                                                                              |
| Developer experience   |      10% |       7 |       9 |       6 | GCP's CLI and console are cleanest; OCI has the thinnest community answers                                        |
| FinOps flexibility     |       5% |       9 |       8 |       7 | AWS has the richest commitment instruments                                                                        |
| Canadian residency     |       5% |       9 |       9 |       9 | All three have two Canadian regions                                                                               |
| **Weighted score**     | **100%** | **7.4** | **8.5** | **7.7** |                                                                                                                   |

**GCP wins on operational simplicity carrying its full 15% weight**, plus a
respectable cost position. OCI's cost advantage is real and it finishes second —
if the weighting moved cost to 40%, OCI would win outright. AWS finishes third
not because it is a worse cloud but because its strengths are worth less to a
one-developer team than to a platform group of twenty.

**Lock-in** is low in all three and worth protecting deliberately. The
application is containers, Postgres and S3-compatible storage — portable by
construction. Avoid provider-specific queues, provider-specific auth, and managed
services with no open equivalent.

---

## 18 — Recommendation

> **For Vintrax + Vintrax + Mobile with 500 users, I recommend Google Cloud,
> Montreal, on Cloud Run — with no Kubernetes — because the binding constraint is
> one developer's time, and Cloud Run removes an entire operational layer for
> roughly the same money.**

|                   |                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Cloud             | Google Cloud Platform                                                                                                           |
| Region            | `northamerica-northeast1` (Montreal), DR in `northamerica-northeast2` (Toronto)                                                 |
| Architecture      | Cloud Run × 5 services · Cloud SQL PostgreSQL HA · Memorystore Redis · Cloud Storage · Cloud CDN · Cloud Armor · Secret Manager |
| Monthly infra     | US$340 expected (US$220–480) · CAD ~$466                                                                                        |
| Monthly operating | US$55 — Sentry, support, domains                                                                                                |
| Annual            | US$4,700 expected · CAD ~$6,440                                                                                                 |
| 3-year TCO        | US$38,100 · CAD ~$52,200                                                                                                        |
| Target SLA        | 99.9%                                                                                                                           |
| RPO / RTO         | 5 minutes / 15 min zone, 4–8 h region                                                                                           |

**Choose OCI Toronto instead if** the monthly bill is the dominant constraint and
you accept solving more problems without a community to ask. It is roughly 45%
cheaper on the modelled configuration and it is a legitimate choice, not a
compromise.

### Deploy now

- Cloud Run — API, Web, Mobile, Worker
- Cloud SQL PostgreSQL, HA, PITR
- Memorystore Redis, HA
- Cloud Storage, six buckets, lifecycle rules
- Cloud CDN + Cloud Armor
- Secret Manager, workload identity
- Staging environment
- Terraform, GitHub Actions, Sentry
- Five alerts, four budget thresholds

### Do not deploy yet

- **Kubernetes** — until §04's thresholds are met
- **Managed search** — the Postgres provider is sufficient
- **Read replica** — no read pressure exists
- **Warm DR standby** — backups meet the RTO
- **Tracing / APM** — six services do not need it
- **SIEM** — needs an operator you do not have
- **Multi-region active** — not before 50,000 users
- **Commitment discounts** — not before month 9

### Top five FinOps controls, week one

1. **Billing budget with alerts at 50 / 75 / 90 / 100%** of US$500, to email and
   phone. Ten minutes to set up; catches every runaway before it becomes a month.
2. **Mandatory labels enforced in Terraform** — `env`, `app`, `owner`,
   `cost-centre`. Retrofitting labels onto live infrastructure is miserable.
3. **Staging shuts down outside working hours.** Scheduled scale-to-zero on
   nights and weekends removes roughly 65% of staging's cost.
4. **Log retention capped at 30 days**, with a separate budget alert on the
   logging service. This is the line item that quietly triples.
5. **Storage lifecycle rules from day one**, including the licence auto-delete.
   Both a cost control and a privacy control.

---

## 19 — Implementation roadmap

| Phase                 | Deliverable                                                                       | Effort | Cloud cost | Done when                                         |
| --------------------- | --------------------------------------------------------------------------------- | -----: | ---------: | ------------------------------------------------- |
| **0 — Architecture**  | This document, signed off; pricing worksheet filled; cloud chosen                 |    2 d |         $0 | Verified budget approved                          |
| **1 — Foundation**    | Organisation, billing, IAM, VPC, Terraform state, workload identity federation    |    3 d |       ~$20 | `terraform apply` from CI with no static keys     |
| **2 — Platform**      | Cloud SQL, Memorystore, buckets, registry, secrets, load balancer, DNS, TLS       |    4 d |      ~$250 | Empty database reachable only from the app subnet |
| **3 — Applications**  | Five Cloud Run services, migrations, config, PgBouncer, WebSocket affinity        |    5 d |      ~$310 | All three apps serving on real domains            |
| **4 — CI/CD**         | Build, scan, push, staging deploy, approval gate, canary, rollback                |    3 d |      ~$330 | A merge reaches production untouched by hand      |
| **5 — Security**      | Cloud Armor, image scanning, CodeQL, audit alerts, backup lock, licence lifecycle |    3 d |      ~$355 | Backup deletion attempt is refused                |
| **6 — Observability** | Dashboards, five alerts, uptime checks, Sentry, log retention                     |    2 d |      ~$395 | A killed container pages you within 3 min         |
| **7 — Launch**        | Load test, restore test, DR rehearsal, go-live checklist                          |    3 d |      ~$400 | Restore verified with matching row counts         |
| **8 — FinOps**        | Budgets, labels, shutdown schedule, first monthly review                          |    1 d |      ~$400 | Bill attributable to app and environment          |

**Total: about 26 working days** for one developer with existing cloud
familiarity — six to eight calendar weeks alongside feature work. Phases 1 and 2
gate everything; 5 and 6 can run in parallel with 4.

---

## 20 — FinOps policy

**Budget and alerts.** Monthly budget **US$500** for year one. Alerts at 50%,
75%, 90% and 100% to email and phone. A separate US$60 budget on logging.

**Mandatory labels**, enforced in Terraform modules so an unlabelled resource
cannot be created:

```
env          = production | staging | dev
app          = vintrax | vintrax | mobile | shared
owner        = the responsible person
cost-centre  = platform | product
managed-by   = terraform
```

**Schedules and expiry.** Staging scales to zero 19:00–07:00 and all weekend. Any
resource tagged `temporary` carries an `expires` date and is reviewed monthly.

**Review cadence.** _Monthly:_ 20 minutes — top five line items, anything up more
than 20%, anything unlabelled. _Quarterly:_ rightsizing against actual
utilisation, and a commitment review from month 9.

### Top cost drivers and their risks

|   # | Driver             | Risk                                                | Control                                              |
| --: | ------------------ | --------------------------------------------------- | ---------------------------------------------------- |
|   1 | Managed PostgreSQL | Over-sized on day one and never revisited           | Start at 2 vCPU; resize on measured CPU              |
|   2 | Container compute  | Min-instances set high "to be safe"                 | Min 1 on API only; others scale from zero            |
|   3 | CDN egress         | Unoptimised images; low cache hit rate              | WebP derivatives, long cache TTLs, monitor hit ratio |
|   4 | Logs               | Debug logging left on after an incident             | Retention cap, dedicated budget alert                |
|   5 | Managed Redis      | Sized for cache when it is mostly queues            | 2 GB is ample; measure before growing                |
|   6 | NAT / egress       | Charged twice on some paths; invisible until billed | Private service endpoints where offered              |
|   7 | Staging            | Runs 24/7 for a team that sleeps                    | Scheduled shutdown — the biggest easy saving         |
|   8 | Object storage     | Grows forever without lifecycle rules               | Tiering at 90 days, licence auto-delete              |
|   9 | Backups            | Long retention on large snapshots                   | 30 days plus monthly points                          |
|  10 | Support plan       | Percentage-of-spend plans grow silently             | Start at the lowest paid tier; revisit annually      |

The two most likely wastes here are **a staging environment nobody turned off**
and **a database sized for a traffic level that will not arrive for two years**.
Both are set-and-forget mistakes made in week one and discovered in month six.

---

## 21 — Risks and mitigations

| Risk                                                 | Impact   | Likelihood | Mitigation                                                                           |
| ---------------------------------------------------- | -------- | ---------- | ------------------------------------------------------------------------------------ |
| **Pricing in this document proves materially wrong** | High     | **High**   | §07 worksheet before any commitment. See §00.                                        |
| Connection pool exhaustion on autoscale              | High     | High       | PgBouncer from day one; alert on connection count                                    |
| Single developer unavailable during an incident      | High     | Medium     | Runbooks in the repo; a second person with break-glass access; provider support plan |
| WebSocket behaviour differs under managed containers | Medium   | Medium     | Load-test auctions in staging before launch; session affinity verified in Phase 3    |
| Licence images retained beyond need                  | **High** | Medium     | Lifecycle rule, not a cron job; audited quarterly                                    |
| DR plan never rehearsed                              | High     | Medium     | Twice-yearly drill as a calendar obligation                                          |
| Cost creep past budget                               | Medium   | Medium     | Four alert thresholds; monthly 20-minute review                                      |
| Vendor lock-in through convenience services          | Medium   | Low        | Keep to containers, Postgres and S3-compatible storage                               |

---

## 22 — Go-live checklist

**Infrastructure**

- [ ] All resources created by Terraform, none by hand
- [ ] State bucket versioned and locked
- [ ] Database unreachable from the internet — verified by attempting it
- [ ] Redis unreachable from the internet — same
- [ ] Buckets deny public access at the account level
- [ ] TLS valid, auto-renewing, expiry alert set
- [ ] DNS TTL at 60 seconds

**Data**

- [ ] Automated backups on, PITR enabled
- [ ] **Restore tested — row counts match**
- [ ] Cross-region backup copy verified
- [ ] Backup deletion refused under app credentials
- [ ] Lifecycle rules applied to all six buckets
- [ ] Licence auto-delete verified with a test object
- [ ] PgBouncer in place, pool sized

**Security**

- [ ] No static cloud credentials in GitHub secrets
- [ ] MFA on every human account
- [ ] WAF in blocking mode, not monitoring
- [ ] Rate limits on `/auth/*`
- [ ] Image scanning blocking on critical findings
- [ ] Secret scanning with push protection on
- [ ] Audit alerts firing on a test IAM change

**Operations**

- [ ] Five alerts tested by causing each condition
- [ ] Uptime checks from outside the region
- [ ] Sentry receiving releases with source maps
- [ ] Budget alerts confirmed by lowering a threshold
- [ ] Rollback rehearsed — previous revision restored
- [ ] DR runbook walked end to end once
- [ ] Load test at 3× expected peak

> **Two items that are not optional:** the **restore test** and the **rollback
> rehearsal**. Every other line above can be inferred from configuration. These
> two are the only ones that prove a capability actually exists, and they are the
> two most often skipped because everything appears to work without them.

---

_Cost figures are unverified except where marked `[verified]` — see §00. Complete
the §07 worksheet in the three provider calculators before committing budget or
signing an agreement. Architecture, security, DR and FinOps guidance is
independent of pricing and stands on its own._
