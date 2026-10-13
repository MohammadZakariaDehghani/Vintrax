# Vehicle Reviews & Comments

Reviews and comments on every public vehicle page, moderated before they appear. The decision record is [D-067](./decision-log.md). The endpoints are listed in the [API reference](./api-reference.md#vehicle-reviews).

## How it works

- **Who can post.** Anyone can post a review: a 1–5 star rating and 10–2,000 characters of text. Visitors do not need an account.
- **Moderation.** Every review starts as `PENDING` and is invisible until an administrator approves it under **Admin → Reviews**.
- **The rating.** Only `APPROVED` reviews are listed, counted in the rating and put in the page's structured data.
- **Signed-in authors** get one live review per vehicle. They see its state on the vehicle page and can edit it or withdraw it. An edit sends the review back to `PENDING`.
- **Anonymous reviews** are signed "Anonymous" or with a nickname. An anonymous author cannot edit a review afterwards.
- **What the public sees.** Never an email address, account, network address or moderation detail. A public review is: id, rating, text, display name, verified purchase, date, and whether it was edited.

### States

```
submitted / edited ─▶ PENDING ──approve──▶ APPROVED ──hide──▶ HIDDEN
                         │                    ▲  ▲               │
                         └──reject──▶ REJECTED┘  └───restore─────┘
any state but DELETED ──delete──▶ DELETED ──restore──▶ PENDING (looked at again)
```

- **Transitions.** Any other transition is refused with `409`.
- **Concurrent moderators.** A change only applies if the review is still in the state the moderator saw, so two moderators acting at once cannot both win.
- **Deletion is soft.** The row and its history stay.

## Data

The data lives in migration `20261010000000_vehicle_reviews`. It only adds things: new enums, three tables, indexes and constraints.

| Table                        | Holds                                                                                                                                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VehicleReview`              | The review: rating, normalised text, a duplicate fingerprint, the display name and status, the moderation timestamps and reason, report counters, moderator flags, and HMACs of the sender's address and user agent. |
| `VehicleReviewReport`        | One report: the reason, optional details, an account or an anonymous reporter hash, and whether it has been resolved.                                                                                                |
| `VehicleReviewModerationLog` | Every state change: the actor, the action, the status before and after, the reason and the time.                                                                                                                     |

**Constraints:**

- `CHECK (rating BETWEEN 1 AND 5)`.
- One live review per signed-in author per vehicle: a partial unique index that excludes `DELETED`.
- One report per account, or per anonymous address, per review.

**Indexes** cover each read path:

- the public list, by vehicle and status, sorted by date and by rating;
- the moderation queue;
- the per-address limits;
- duplicate detection.

## Protection

| Concern        | What is done                                                                                                                                                                                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Validation     | Zod schemas in `@vintrax/shared` (`reviewCreateSchema` and others). The browser and the API share them. Unknown fields, such as `status` or `userId`, are refused. The vehicle comes from the URL and the author from the session.                                                                   |
| XSS            | Text is normalised (`normalizeReviewText`): tags and control characters are removed, whitespace is collapsed and at most one blank line is kept. It is shown as text, never as HTML. The structured data escapes `<`.                                                                                |
| Spam and abuse | A `website` honeypot field, the same as the contact form. Moderator flags: links, contact details, shouting, repeated characters, several reviews from one address.                                                                                                                                  |
| Rate limits    | Per network address: `REVIEW_MAX_PER_IP_PER_HOUR` reviews, `REVIEW_MAX_PENDING_PER_IP` waiting for moderation, and `REVIEW_MAX_REPORTS_PER_IP_PER_HOUR` reports. These are counted in Postgres, so they hold across API instances and without Redis. Route throttles (`@Throttle`) also stop bursts. |
| Duplicates     | The same text on the same vehicle within `REVIEW_DUPLICATE_WINDOW_HOURS` is refused (`409`). Signed in: one review per vehicle. Anonymous: one pending review per vehicle per address.                                                                                                               |
| Privacy        | A raw IP address or user agent is never stored. They are HMAC'd with a key derived from `JWT_ACCESS_SECRET`. Logs carry ids and event names (`review.created`, `review.approved` …), never personal data.                                                                                            |
| Authorization  | Admin routes need `review:read`, `review:moderate` or `review:delete`. All three come with the `ADMIN` and `SUPER_ADMIN` roles. A seller, or their dealership's staff, cannot review their own listing. Another user's review answers `404` to edit or delete.                                       |
| Client IP      | `ClientIp` and the audit trail now use Express's `req.ip`, which honours `trust proxy`. Before, they read the first `X-Forwarded-For` entry, which a client can set.                                                                                                                                 |

## Reports

- **Who can report.** Anyone can report an approved review, choosing a reason: spam, offensive, harassment, fake review, incorrect information, personal information, or other.
- **The review stays up.** Its report count rises, and at `REVIEW_AUTO_FLAG_REPORT_THRESHOLD` open reports it is flagged.
- **Where reports go.** Reported reviews appear in the **Reported** view. **Mark reports as reviewed** resolves them and clears the flag.
- **Repeats.** A repeat report from the same account or address is refused.

## Verified purchase

"Verified purchase" appears only when the books prove it: a `POSTED` accounting `VehicleSale` of the vehicle to a `Customer` linked to the author's account. It is checked when the review is submitted or edited and again when it is approved. Anonymous reviews are never verified.

## Admin

The admin pages are **Admin → Reviews** (`/admin/reviews`) and the review page (`/admin/reviews/:id`).

- **Views:** Pending (the default), Reported, Approved, Rejected, Hidden, Deleted, All.
- **Search:** vehicle title, VIN, stock number or review text.
- **Filters:** rating, anonymous or signed in, date range, newest or oldest first.
- **Bulk actions:** approve, reject (with a reason), hide or delete selected reviews. Reject and delete ask for confirmation.
- **The review page shows:**
  - the text and its flags;
  - the author's account (email visible to admins only);
  - how many other reviews came from the same address in 30 days;
  - the reports;
  - every action available in the review's state;
  - the full moderation history.
- **Metrics** (`GET /admin/reviews/metrics`, cached for a minute) appear on the Reviews page. The dashboard has a "Reviews to approve" tile.
- **Audit log.** Every moderation action is also written to the platform audit log.

## Notifications

When a pending review by a signed-in author is approved or rejected, the author gets an in-app notification (`REVIEW_APPROVED` / `REVIEW_REJECTED`). Email follows the user's notification settings. The rejection reason is not included. `REVIEW_NOTIFY_AUTHOR=false` turns these notifications off.

There are no administrator notifications for new or reported reviews; the queue and the dashboard tile show them.

## Public page and SEO

- **Server-rendered.** The vehicle page renders the first five approved reviews and the summary on the server, in a separate request. The vehicle API itself is unchanged.
- **In the browser:** sorting (most recent, highest, lowest), **Load more** with cursor pagination, writing, editing and reporting.
- **Structured data.** The `Car` structured data gains `aggregateRating` and the shown `review`s only when there is at least one approved review. Authors appear under their display name only.
- **Accessibility.**
  - The star input is a radio group: arrow keys, Home and End, one tab stop, a label per star.
  - Dialogs are native `<dialog>`: focus is trapped, Esc closes them and focus returns.
  - Status messages are announced (`role="status"`).
  - Verified and status badges use words as well as colour.

## Configuration

| Variable                             | Default | Purpose                                                          |
| ------------------------------------ | ------- | ---------------------------------------------------------------- |
| `REVIEW_MAX_PER_IP_PER_HOUR`         | `5`     | Reviews per network address (or account) per hour                |
| `REVIEW_MAX_PENDING_PER_IP`          | `3`     | Reviews from one address waiting for moderation at once          |
| `REVIEW_MAX_REPORTS_PER_IP_PER_HOUR` | `10`    | Reports per address per hour                                     |
| `REVIEW_DUPLICATE_WINDOW_HOURS`      | `72`    | The window for duplicate text on the same vehicle                |
| `REVIEW_AUTO_FLAG_REPORT_THRESHOLD`  | `3`     | Open reports that flag a review                                  |
| `REVIEW_NOTIFY_AUTHOR`               | `true`  | Tell signed-in authors when their review is approved or rejected |

The text length limits (10–2,000) are constants in `@vintrax/shared`, so the form and the API agree.

## Tests

- **`backend/src/modules/reviews/reviews.api.db.spec.ts`** (20 tests, real Postgres) covers:
  - anonymous and signed-in submission, and the one-review rule;
  - validation: rating, empty, too short, too long, display name, server-only fields;
  - 404 for missing and non-public vehicles;
  - XSS payloads, the honeypot, duplicate text, a seller reviewing their own listing;
  - the per-address hourly and pending limits;
  - visibility of approved, pending, rejected, hidden and deleted reviews, and a public response with no private fields;
  - every transition, and refused ones, with the history and audit log;
  - non-admins refused, author notification, author edit and withdraw;
  - verified purchase from a posted sale;
  - cursor pagination with no repeats or gaps; the three sorts; the summary;
  - reports: repeats, the threshold, resolving, the rate limit, non-public reviews;
  - bulk actions and metrics.
- **`backend/src/modules/reviews/review-signals.spec.ts`** covers text normalisation, flags, address hashing and the cursor.
- **`frontend/src/components/reviews/reviews.spec.ts`** covers:
  - section, summary and distribution rendering, and reviews escaped;
  - Load more, the empty state, the star controls' accessibility;
  - client validation messages and the structured data.

The interactive flows were exercised in Chromium against the built API and web app: write, validation, Esc, keyboard stars, the pending message, admin approve, the public review, report, the signed-in "already reviewed" state, edit, admin reject with history, Load more, sorting, and no sideways overflow at 390 px.

## Limits

- **No CAPTCHA.** Vintrax has none. The honeypot, limits, duplicate checks and moderation are the defence. A CAPTCHA could be added to `POST /vehicles/:id/reviews` later.
- **Shared addresses.** Limits per network address treat people behind one address (an office, a carrier NAT) as one source.
- **Pre-moderation load.** Every review needs a moderator before it appears.
- **No translations.** The site has no localisation system, so the text is in English like the rest of it.
