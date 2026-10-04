# Dealer Accounting

Double-entry accounting for Canadian dealerships, inside the dealer portal at
**Dealer → Accounting** (`/dealer/accounting`). Decision record:
[D-065](./decision-log.md). The endpoints are listed in the
[API reference](./api-reference.md#dealer-accounting).

> **Not tax or legal advice.** Tax rates and rules are configuration. The
> defaults below were checked against official sources when they were
> written. A dealer should confirm them with their accountant and the CRA,
> Revenu Québec or their provincial ministry of finance before relying on
> them.

## Contents

- [Shape](#shape)
- [The ledger](#the-ledger)
- [Who can do what](#who-can-do-what)
- [Business flows and their entries](#business-flows-and-their-entries)
- [Sales tax](#sales-tax)
- [Reports](#reports)
- [Accounting health](#accounting-health)
- [Using it](#using-it)
- [Demo data](#demo-data)
- [Tests](#tests)
- [Assumptions and limits](#assumptions-and-limits)

## Shape

Accounting is one domain module of the existing monolith:
`backend/src/modules/accounting`. It uses the same Postgres database, users,
dealers and vehicles. It is not a separate service.

- **Dealership.** The tenant is the `Dealer`. Every accounting row carries
  `dealerId`.
- **Inventory.** The dealership's inventory is the owner's existing
  `Vehicle` rows. Purchases, costs and sales attach to those rows.
- **Ledger.** One `JournalEntry` and its `JournalLine`s per posting.
  Customers, vendors, invoices, bills, payments, expenses, deposits, sales,
  bank accounts and reconciliations are documents. Each one posts through the
  same `PostingService`.
- **Reports.** Every report reads posted journal lines (`reports/ledger.ts`)
  and nothing else. A sale's profit, a vehicle's cost and the balance sheet
  come from the ledger, never from a stored figure. Reports are built on the
  server; the browser only displays them.

| Folder                                                      | Responsibility                                                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `core/`                                                     | Money in integer cents, `YYYY-MM-DD` dates, the request context, `AccountingGuard`, audit, document numbers and dealer-scoped lookups |
| `accounts/`                                                 | The default Canadian dealership chart of accounts and custom accounts                                                                 |
| `journal/`                                                  | The posting engine (`post`, `reverse`) and manual journal entries                                                                     |
| `periods/`                                                  | Fiscal years on the dealer's calendar, monthly periods, close, reopen, year-end close                                                 |
| `tax/`                                                      | The versioned tax engine, default rules, dealer overrides and the Tax Center                                                          |
| `inventory/`, `sales/`                                      | Vehicle purchases, trade-ins, deposits and sales                                                                                      |
| `receivables/`, `payables/`, `payments/`, `expenses/`       | Accounts receivable, accounts payable, payments and expenses                                                                          |
| `banking/`, `floor-plan/`                                   | Bank accounts, reconciliation and the floor plan                                                                                      |
| `reports/`, `export/`, `health/`, `search/`, `attachments/` | Statements and dealer reports, CSV/Excel/PDF export, health checks, search, attachments, the audit trail and saved filters            |
| `controllers/`                                              | The REST API under `/dealer/accounting`, plus platform tax rules under `/admin/accounting/tax-rules`                                  |

## The ledger

**Money.** Amounts are stored as `NUMERIC(15,2)` and handled in code as
integer cents. Conversion goes through strings, never floating point. Rates
are `NUMERIC(8,5)` percentages applied with scaled integers and round
half-up. Input such as `"1,234.50"` is parsed digit by digit, and `1.005` is
refused, not rounded.

**Dates.** Dates are `YYYY-MM-DD` (`DATE` columns). "Today" means today in
`America/Toronto`.

**The database enforces the rules, not only the code.** Migration
`20261008000000_accounting` adds these triggers:

| Rule                                                                                      | Enforced by                                                      |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| A posted entry's debits equal its credits                                                 | Deferred constraint triggers on `JournalEntry` and `JournalLine` |
| A posted entry and its lines never change. Only `reconciliationId` may be set or cleared. | `acct_protect_posted_entry`, `acct_protect_posted_line`          |
| Nothing is posted into a closed period                                                    | `acct_reject_closed_period`                                      |
| The audit log and tax lines are append-only                                               | `acct_append_only`                                               |
| A posted document (sale, bill, invoice, payment …) is never deleted                       | `acct_forbid_delete_posted_document`                             |
| Amounts are non-negative, and a line is a debit or a credit, not both                     | `CHECK` constraints                                              |

**Corrections.** Corrections are reversals: an equal and opposite entry that
links to the original. A manual entry is reversed from the journal. A
document's entry is reversed through the document (void the bill, reverse the
sale), so the document and the ledger never disagree.

**Numbering and concurrency.** Entry numbers come from a counter row in
`AccountingSettings`. Each posting locks that row, which serializes postings
for one dealer. A sale also locks its vehicle (`FOR UPDATE`), so a vehicle
cannot be sold twice.

**Fiscal years.** Fiscal years follow the dealer's start month and day, for
example April 1. A year is named for the calendar year it ends in. Monthly
periods are created on demand.

- **Closing a period** stops any posting dated inside it.
- **Reopening a period** needs a reason, which is audited.
- **Year-end close** posts a closing entry that moves every revenue, cost and
  expense balance into Retained Earnings. Reopening the year reverses that
  entry.

## Who can do what

Owners have every permission. Staff are added by email under **Settings &
team**. They sign in with their own Vintrax account, and a `DealerMember` row
gives them a role:

| Permission                                                               | Owner | Manager | Accountant | Sales manager | Salesperson |
| ------------------------------------------------------------------------ | :---: | :-----: | :--------: | :-----------: | :---------: |
| `accounting.view` (statements, ledgers, every report)                    |   ✓   |    ✓    |     ✓      |               |             |
| `accounting.create` / `edit` / `post` / `reverse`                        |   ✓   |    ✓    |     ✓      |               |             |
| `accounting.close_period`                                                |   ✓   |    ✓    |     ✓      |               |             |
| `accounting.reopen_period`                                               |   ✓   |         |     ✓      |               |             |
| `accounting.export`                                                      |   ✓   |    ✓    |     ✓      |               |             |
| `accounting.manage_accounts`, `manage_tax`, `reconcile_bank`, `settings` |   ✓   |    ✓    |     ✓      |               |             |
| `accounting.sales` (deal desk, customers, trade-ins, draft deals)        |   ✓   |    ✓    |     ✓      |       ✓       |      ✓      |
| `accounting.post_sales` (post a sale, take a deposit)                    |   ✓   |    ✓    |     ✓      |       ✓       |             |
| `accounting.manage_team`                                                 |   ✓   |         |            |               |             |

- **Server-side checks.** `AccountingGuard` resolves the dealership and role
  from the session on every request. Someone on more than one dealership's
  staff picks one with the `x-dealer-id` header. The guard accepts only a
  dealership they belong to.
- **Hidden figures.** Sales staff never receive cost of sale or gross profit
  from the API. The deal desk strips those fields.
- **Platform administrators.** An administrator gets **no** access to a
  dealer's books by virtue of being an administrator. Administrators with
  `settings:manage` maintain the platform's default tax rules.

## Business flows and their entries

| Flow                                                       | Entry                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vehicle purchase** (auction, private, dealer, wholesale) | Dr Vehicle Inventory for the price, fees, transport, inspection and reconditioning, each tagged with the vehicle and a cost category. Dr GST/HST Recoverable when the seller charged it. Cr Bank (paid), Accounts Payable plus a bill (on account), or Floor Plan Payable plus a note (floor plan).                                                                                                 |
| **Vehicle cost later** (bill or expense)                   | Dr Vehicle Inventory for the vehicle; the cost becomes part of its book value                                                                                                                                                                                                                                                                                                                       |
| **Deposit**                                                | Dr Bank, Cr Customer Deposits (a liability until the sale). A refund reverses it.                                                                                                                                                                                                                                                                                                                   |
| **Trade-in**                                               | Appraised on the deal desk, then bought into inventory when the sale posts. Dr Vehicle Inventory at actual cash value (the lower of appraisal and allowance). An allowance above that value is a sale discount (Dr Sales Revenue), not inventory. A lien payoff goes to Accounts Payable with a bill to the lien holder.                                                                            |
| **Sale**                                                   | One transaction. Applied deposits (Dr Customer Deposits), down payment (Dr Bank), receivable from the customer and from the finance lender (Dr AR). Cr revenue by kind (vehicle, fees, accessories, warranty, finance reserve). Cr each tax type. Dr Cost of Sales / Cr Vehicle Inventory at the vehicle's **book value read from the ledger**. The vehicle is marked sold and invoices are raised. |
| **Invoice / bill**                                         | Dr AR / Cr revenue and tax, or Dr expense or asset and recoverable tax / Cr AP. PST a dealer pays is part of the cost. Credit notes reverse the direction.                                                                                                                                                                                                                                          |
| **Payment**                                                | Dr Bank / Cr AR (received), or Dr AP / Cr Bank (sent), applied to invoices or bills. Anything not applied stays on account.                                                                                                                                                                                                                                                                         |
| **Expense**                                                | One of four treatments: operating (Dr expense), vehicle direct cost (Dr Vehicle Inventory), cost of sales, or capital (Dr Fixed Assets). Recurring expenses post when someone chooses to post them.                                                                                                                                                                                                 |
| **Bank transaction**                                       | Deposit, withdrawal, fee, transfer or adjustment against a chosen account                                                                                                                                                                                                                                                                                                                           |
| **Floor plan**                                             | Dr Bank / Cr Floor Plan Payable on the advance. Principal, interest (Dr Interest Expense) and payoff payments.                                                                                                                                                                                                                                                                                      |
| **Reconciliation**                                         | Ticks posted bank lines as cleared. It completes only when the statement and cleared balances agree, or with an adjustment entry that names its account and reason.                                                                                                                                                                                                                                 |

**The spec's example.** A vehicle bought for $20,000, plus an $800 auction fee,
$500 transport and $1,200 reconditioning, carries $22,500 in Vehicle
Inventory. Sold for $28,000, the ledger shows $5,500 gross profit.
`flows.db.spec.ts` and `accounting.api.db.spec.ts` both check this figure.

## Sales tax

`tax/tax-engine.ts` is a pure function over **rules**. Each rule has:

- a province, a tax type (GST, HST, PST, QST) and a rate;
- `effectiveFrom` / `effectiveTo` dates;
- the categories it taxes or exempts;
- an optional vehicle price band;
- whether a trade-in reduces the base;
- whether it is recoverable as an input tax credit.

**Rates in effect on a date.** The rules for a province and date are the
platform defaults (migration `20261008000100_accounting_tax_defaults`). A
dealer's own rules replace the default for the same tax type from their
effective date.

**A rate change is a new version.** The old version stays, so past
transactions keep the rate they were charged. Each tax line also stores a
snapshot of the rate it used.

Taxes are shown as separate components: GST and PST in BC, GST and QST in
Quebec, HST in the harmonized provinces.

### Default rules

| Province / territory           | Tax                                                                                                                                                                                                                                           | Source                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| AB, BC, MB, NT, NU, QC, SK, YT | GST 5%                                                                                                                                                                                                                                        | CRA GST/HST rates                    |
| ON                             | HST 13%                                                                                                                                                                                                                                       | CRA GST/HST rates                    |
| NB, NL                         | HST 15% from 2016-07-01                                                                                                                                                                                                                       | CRA GST/HST rates                    |
| PE                             | HST 15% from 2016-10-01                                                                                                                                                                                                                       | CRA GST/HST rates                    |
| NS                             | HST 15% to 2025-03-31, **14% from 2025-04-01**                                                                                                                                                                                                | CRA; Notice 342                      |
| QC                             | QST 9.975% from 2013-01-01                                                                                                                                                                                                                    | Revenu Québec                        |
| BC                             | PST on passenger vehicles from 2018-04-01, by price before the trade-in: 7% up to $54,999.99, then 8%, 9%, 10% (from $57,000), 15% (from $125,000), 20% (from $150,000). Applies to the vehicle and dealer fees; a trade-in reduces the base. | BC Bulletin PST 308; Notice 2018-003 |
| BC                             | PST 7% general                                                                                                                                                                                                                                | BC PST Act                           |
| SK                             | PST 6% from 2018-04-11                                                                                                                                                                                                                        | Saskatchewan PST                     |
| MB                             | RST 7% from 2019-07-01                                                                                                                                                                                                                        | Manitoba RST                         |

**Not modelled.**

- Quebec's "estimated value" rule for used vehicles. QST is charged on the
  sale price.
- Special rules such as ON's used-vehicle minimum taxable value, PEI's
  vehicle rules and First Nations exemptions.

A dealer whose situation differs adds a dealer rule, or marks the line's
category exempt.

**Tax Center** (`/dealer/accounting/tax`) has these parts:

- **Collected and paid figures** for a range: tax collected, tax paid,
  recoverable credits and net owing, by return (GST/HST, PST/RST, QST).
- **Filing periods**, monthly, quarterly, annual or custom. Each moves
  through the statuses Open → In review → Filed → Closed, with adjustments
  and a confirmation number.
- **Rules.** The rules for any province, with version history.
- **Calculator.** Works out the tax on an amount.

## Reports

All reports filter by date with presets (today, this week, this month, last
month, quarter, year to date, current and previous **fiscal** year) or a
custom range. Where it makes sense, they compare with the previous period or
the same period last year.

- **Statements**
  - **Profit and loss**: totals, optionally by month.
  - **Balance sheet**: as of a date, capped at today. It includes Current
    Year Earnings and reports whether it balances.
  - **Cash flow**: indirect method; reports whether it reconciles to cash.
  - **Trial balance**: reports whether debits equal credits.
  - **General ledger**: running balance when one account is chosen. Filter by
    account, source, VIN, vehicle, customer, vendor or reference.
- **Dealer reports**
  - **Vehicle profitability**: per vehicle, from tagged lines. Filter by
    status, make, profitability, salesperson or age.
  - **Inventory valuation**: book value, aging, and a check against the
    Vehicle Inventory account.
  - **KPIs**: units, average price and gross, margin, turnover, days in
    stock, reconditioning and advertising per vehicle, and figures by
    salesperson, brand and body type.
  - **AR and AP aging**: buckets Current, 1–30, 31–60, 61–90 and 90+.
  - **Monthly report and fiscal-year dashboard**: comparisons, with charts.
- **Export.** `GET /dealer/accounting/exports/:report?format=csv|xlsx|pdf`
  builds files with no extra dependencies (`export/`):
  - CSV has a byte-order mark, and its text cells are neutralised against
    formula injection.
  - Excel has real numbers in an accounting format.
  - PDF is landscape, with repeated headers and page numbers.
- **Saved views.** A user can save a report's filters under a name.

## Accounting health

`GET /dealer/accounting/health` (**Accounting health** in the UI) lists
problems with links to the records. The checks:

- unbalanced posted entries;
- missing system accounts;
- tax lines that disagree with tax accounts;
- inventory that does not match its vehicles;
- negative inventory;
- sold vehicles without a sale, and sales whose vehicle is still listed;
- vehicle costs entered only on the Costs page;
- AR or AP that does not match open documents;
- reconciliations with a difference;
- unreconciled bank activity;
- entries dated in closed periods;
- duplicate vendor references or payment references;
- orphaned entries;
- floor-planned vehicles sold but not paid off;
- old drafts.

## Using it

**First run.** The owner opens **Accounting** and fills in the one-time setup:
legal name, province, tax numbers, fiscal year start, filing frequency, and
optionally the operating bank account with its opening balance. Setup
creates:

- about 70 accounts in the Canadian dealership chart of accounts;
- the current fiscal year;
- a cash account.

The fiscal calendar is fixed once anything posts.

**Sales staff** land on the deal desk.

- **Building a deal.** Choose a vehicle and customer, enter price, fees and
  add-ons, pick a trade-in and deposits, then the down payment and financing.
  The recap updates as they type, with each tax as its own line.
- **Saving.** A salesperson saves a draft; a sales manager or accountant
  posts it.
- **Missing cost.** A vehicle with no recorded purchase cannot be sold until
  its cost is on the books. Otherwise cost of sales and gross profit would be
  wrong. A dealer who accepts that can switch it off in settings.

**Navigation.** Every page is under `/dealer/accounting/…`. Drill-down runs
from report → general ledger → journal entry → source document, and back.
Search covers VINs, customers, vendors, invoice and bill numbers, journal
references, payments and accounts.

**Attachments** (PDF, JPEG, PNG) go to private document storage and download
only through the API, for the same dealership. **Payment card numbers are
never stored**: a reference that looks like a card number is refused.

## Demo data

`pnpm db:seed` (development only; it refuses production unless
`ALLOW_DEMO_SEED=true`) gives North Shore Motors (BC, fiscal year from April

1. a set of demo books. It posts everything through the real services:

- purchases, one of them floor-planned, and a reconditioning bill with a
  part payment;
- rent, advertising, utilities and software expenses;
- a deposit, a sale with a trade-in, financing and a finance reserve, and a
  sale with a balance owing;
- a deposit held on stock, and a bank fee.

Posted entries cannot be deleted, so the books are created once and a
re-run leaves them alone.

The password for every demo account is in the
[developer guide](./developer-guide.md).

| Account                            | Role                         |
| ---------------------------------- | ---------------------------- |
| `sales@northshoremotors.test`      | Owner                        |
| `accountant@northshoremotors.test` | Accountant                   |
| `rep@northshoremotors.test`        | Salesperson (deal desk only) |

## Tests

These tests need a migrated Postgres. CI provides one; locally, point
`DATABASE_URL` at a test database. Without it they are skipped.

- **`journal/journal.db.spec.ts`:**
  - the triggers: unbalanced entries, edits to posted lines and deletes are
    refused;
  - reversal, drafts, closed periods, an append-only audit trail and exact
    money.
- **`flows.db.spec.ts`:**
  - every business flow, the $5,500 example, trade-in at actual cash value
    with a payoff;
  - concurrency: two deals posted at once sell a vehicle only once, and
    concurrent postings are numbered without gaps or duplicates;
  - Quebec GST and QST, and an old rate preserved after a rate change;
  - reconciliation, floor plan, dealership isolation, and year-end close and
    reopen.
- **`accounting.api.db.spec.ts`** (the API end to end):
  - setup and team;
  - salespeople refused financial reports, and post rights by role;
  - cost hidden from sales staff;
  - balanced statements;
  - CSV, Excel and PDF exports;
  - an unbalanced entry rejected;
  - cross-dealership isolation;
  - administrators without access.
- **`tax/tax-engine.spec.ts`** and **`export/export.spec.ts`** are unit tests.
  The frontend has `lib/accounting.spec.ts`.

## Assumptions and limits

- **Recurring expenses do not post on their own.** There is no scheduler.
  Due items are flagged, and someone posts them with one click.
- **One currency.** Everything is in CAD.
- **Costs page entries.** Vehicle costs entered on the older Costs page
  before accounting was set up are management figures only. Health lists
  them so they can be posted.
- **Payroll** is an expense account, not a payroll system. There is no CRA
  e-filing; the Tax Center prepares the figures.
- **Bank import.** There is no bank-feed import. Transactions are recorded
  in Vintrax and ticked on the reconciliation screen.
