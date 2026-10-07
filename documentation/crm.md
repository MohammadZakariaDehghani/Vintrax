# CRM: Dealer CRM and Support Desk

Two CRMs that share one module:

- The **Dealer CRM** is in the dealer portal at **Dealer → CRM** (`/dealer/crm`). It covers leads, follow-up, email, automations and campaigns for a dealership's sales team.
- The **Admin support CRM** is at **Admin → CRM** (`/admin/crm`). It is Vintrax's own support desk for users and dealers.
- Users reach support at **Dashboard → Support** (`/dashboard/support`).

The decision record is [D-066](./decision-log.md). The endpoints are listed in the [API reference](./api-reference.md#crm).

> **Not legal advice.** The consent and unsubscribe handling below follows Canada's anti-spam law (CASL) as the spec describes it. A dealership is responsible for its own compliance and should confirm its practice with counsel.

## Contents

- [Shape](#shape)
- [Who can do what](#who-can-do-what)
- [Leads](#leads)
- [Tasks, appointments and the calendar](#tasks-appointments-and-the-calendar)
- [Email](#email)
- [Consent and suppression](#consent-and-suppression)
- [Automations](#automations)
- [Campaigns](#campaigns)
- [Where leads come from](#where-leads-come-from)
- [The support desk](#the-support-desk)
- [Reports and audit](#reports-and-audit)
- [Configuration](#configuration)
- [Demo data](#demo-data)
- [Tests](#tests)
- [Assumptions and limits](#assumptions-and-limits)

## Shape

The CRM is one domain module of the monolith, `backend/src/modules/crm`. It uses the same database, users, dealers, vehicles, customers and sales as everything else, and the platform's mail, queue and notification services. There is no second Dealer, User, Customer, Vehicle or Sale model.

| Folder         | Responsibility                                                                                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/`        | The request context and `CrmGuard`, staff access (`DealerMember`, as in accounting), the audit log, time zones and send windows, per-dealer defaults, the signal bus and notifications |
| `leads/`       | Leads, the unified timeline, scoring, assignment, duplicates and merge, CSV import                                                                                                     |
| `work/`        | Tasks (with reminders and repeats), appointments, the calendar                                                                                                                         |
| `email/`       | Templates and their sanitiser, rendering, the outbox, the dispatcher, tracking, consent and suppression, campaigns                                                                     |
| `automation/`  | Default sequences, conditions, the engine and the scheduler                                                                                                                            |
| `events/`      | `CrmEvents` (the other modules' way in) and its queue worker                                                                                                                           |
| `support/`     | Tickets, admin tasks, Dealer 360, User 360, the support desk's reports                                                                                                                 |
| `reports/`     | The dealer dashboard, reports, search, export and audit views                                                                                                                          |
| `controllers/` | `/api/crm` (dealer), `/api/admin/crm` (support desk), `/api/support` (users), and the public tracking, unsubscribe and webhook routes                                                  |

### Data model

All of these tables are in migration `20261009000000_crm`.

- **Dealer CRM.** `CrmSettings`, `CrmLeadStatus`, `CrmLeadSource`, `CrmTag`, `CrmLead`, `CrmLeadTag`, `CrmActivity`, `CrmTask`, `CrmAppointment`, `CrmLeadScoreEvent`, `CrmScoringRule`, `CrmAssignmentRule`, `CrmTeamMember`, `CrmLeadImport`, `CrmNotificationPreference`.
- **Email, shared by both CRMs.** `CrmEmailTemplate` (with versions), `CrmEmail` (the outbox), `CrmEmailEvent`, `CrmSuppression`, `CrmConsent`, `CrmCampaign`.
- **Automations, shared.** `CrmAutomation`, `CrmAutomationEnrollment`.
- **Support desk.** `SupportSettings`, `SupportCategory`, `SupportTeam`, `SupportTicket`, `SupportTicketTag`, `SupportTicketMessage` (`PUBLIC` or `INTERNAL`), `SupportTicketEvent`, `AdminTask`.
- **Audit.** `CrmAuditLog` for both CRMs, told apart by `scope`.

How rows are scoped:

- Dealer rows carry `dealerId`. Platform rows (the support desk's templates and automations, and global suppressions) have `dealerId` null.
- Partial unique indexes keep platform template and automation keys unique.
- `NULLS NOT DISTINCT` keeps platform tags and suppressions unique.
- A trigger makes `CrmAuditLog` append-only.

A lead links to the existing records. `CrmLead` points at:

- the `Vehicle` the customer is interested in;
- the accounting `Customer` the lead becomes;
- the `Conversation` and `User` the lead came from.

## Who can do what

The dealer CRM uses the same staff model as accounting ([D-065](./decision-log.md)):

- The owner has the `OWNER` role.
- Staff need a `DealerMember` row with a role.
- Someone on several dealerships' staff chooses one with the `x-dealer-id` header.

`CrmGuard` resolves the dealership and role on the server for every request.

| Permission                                                                          | Owner, Manager | Sales manager | Salesperson | Accountant |
| ----------------------------------------------------------------------------------- | :------------: | :-----------: | :---------: | :--------: |
| `crm.view`: open the CRM, see own and unassigned leads                              |       ✓        |       ✓       |      ✓      |     ✓      |
| `crm.all_leads`: see every lead                                                     |       ✓        |       ✓       |             |     ✓      |
| `crm.work`: create and edit leads, activities, status, tasks, appointments, consent |       ✓        |       ✓       |      ✓      |            |
| `crm.email`: email a lead, start or stop an automation for a lead                   |       ✓        |       ✓       |      ✓      |            |
| `crm.manage`: assign, merge, import, delete, bulk actions, suppression, audit log   |       ✓        |       ✓       |             |            |
| `crm.marketing`, `crm.automations`, `crm.templates`                                 |       ✓        |       ✓       |             |            |
| `crm.reports`                                                                       |       ✓        |       ✓       |             |     ✓      |
| `crm.settings`                                                                      |       ✓        |               |             |            |

Other rules:

- **Salespeople.** A salesperson sees only the leads assigned to them and unassigned ones. A lead outside that scope answers `404`, not `403`, so its existence is not revealed.
- **Accountants** read leads and reports and change nothing.
- **Platform administrators** get nothing in a dealer's CRM because they are administrators. A dealer's leads belong to the dealer.
- **The support desk** needs the `support:manage` permission, which the `ADMIN` and `SUPER_ADMIN` roles have. Dealers and users get `403`.
- **The user portal** (`/api/support`) returns only the caller's own tickets and only `PUBLIC` messages. Internal notes, assignees and the event log are never part of it.

## Leads

**What a lead holds:**

- Contact details: an email or a phone number is required.
- Province, source, campaign, and the vehicle of interest: a Vintrax vehicle, a VIN or a link.
- Budget, financing interest and trade-in.
- Status, salesperson or team, next follow-up, and tags.

**Statuses.**

- Each dealer starts with twelve default statuses and can rename, reorder, add and switch them off.
- Each status has a kind: `OPEN`, `WON`, `LOST`, `NURTURE` or `UNRESPONSIVE`. The engine works from the kind, not the label.
- Moving a lead to a `LOST` status requires a reason.

**Pipeline.** A drag-and-drop board of the pipeline statuses. On a phone, each card has a status picker instead.

**Timeline.** One timeline per lead, newest first. It shows:

- calls, notes, meetings, texts;
- emails sent, opened, clicked and replied;
- status changes, assignments, tasks, appointments, consent and score changes;
- automations.

Only real contact moves `lastActivityAt`. A status change does not count as activity, and neither does an automated email.

**Journey.** The lead page shows how far the lead has come: first contact, appointment, test drive, negotiation and sale. Each step is read from the timeline.

**Scoring.**

- Signals add points: inquiry, opens, clicks, reply, appointment, test drive, financing request, trade-in.
- No response and long inactivity take points away.
- The dealer sets the points per signal. The defaults are in `DEFAULT_SCORING`.
- A score of 50 or more is HOT, 20 or more is WARM, and anything lower is COLD. The dealer can change these thresholds.
- Every change is a `CrmLeadScoreEvent` with its reason.

**Assignment.** There are three modes:

- `MANUAL`;
- `ROUND_ROBIN`: across the salespeople, or across a team;
- `RULES`: by source, vehicle make or province, falling back to round robin.

A salesperson may claim an unassigned lead. A new lead can get a first-contact task, due at the dealer's response target.

**Duplicates and merge.**

- Possible duplicates are found by email (case-insensitive), phone (digits only), full name or VIN.
- A merge moves everything to the surviving lead: activities, tasks, appointments, emails, consents, score events and timeline.
- Blank fields on the surviving lead are filled from the duplicate. The duplicate stays, hidden, pointing at the surviving lead.
- A merge is refused when the two leads are linked to different accounting customers.

**Import.**

- A CSV of up to 2,000 rows is previewed first, with errors per row.
- A row that matches an existing lead is skipped, updated or created anyway, as the dealer chooses.
- Each import keeps a history entry with an error report.

**Customers.** A lead becomes an accounting `Customer` with **Make customer**, or automatically when a sale or deposit is posted for it.

## Tasks, appointments and the calendar

- **Tasks.**
  - Each task has a due time, a priority, and an optional reminder and repeat (daily, weekly, monthly).
  - Completing a repeating task opens the next one.
  - Overdue tasks notify their owner once.
- **Appointments.**
  - Types: test drive, viewing, appraisal, finance meeting and delivery.
  - Each has a salesperson, a vehicle and a reminder.
  - Completing a test drive adds its score and moves the journey on.
- **Calendar.** Day, week and month views of appointments and dated tasks, in the dealer's time zone (`CrmSettings.timezone`).

## Email

```
compose / automation / campaign / ticket
        │  OutboxService: render variables, sanitise, check consent, idempotency key
        ▼
   CrmEmail (QUEUED or SCHEDULED)
        │  CrmScheduler tick → DispatcherService.dispatchDue
        │  claims rows with FOR UPDATE SKIP LOCKED and a 5-minute lease
        ▼
   check consent and suppression again → MailService.deliver (SMTP or log)
        ├─ sent       → SENT, timeline, first contact
        ├─ 4xx/error  → QUEUED again; back-off 1 min doubling, at most 6 h;
        │               FAILED after CRM_EMAIL_MAX_ATTEMPTS
        └─ 5xx        → BOUNCED and a platform-wide HARD_BOUNCE suppression
```

- **Provider.**
  - `MailService.deliver()` sends through the platform's existing mail driver: SMTP in production, `log` in development.
  - It returns the provider and message id. It throws `MailDeliveryError` and marks a 5xx as permanent.
  - An email provider's webhook can report delivered, bounced, complained, opened, clicked and replied messages at `POST /api/crm/webhooks/email` when `CRM_WEBHOOK_SECRET` is set.
- **Queue.**
  - The outbox is a table, not Redis, so an email survives a restart and is visible in the CRM.
  - The idempotency key makes an automation step or a campaign send once even when it runs twice: `auto:{enrollment}:{step}` for an automation, and per campaign per lead for a campaign.
  - Several API instances can dispatch at once: rows are claimed with row locks.
- **Templates.**
  - There are 20 default dealer templates and 4 support templates.
  - Variables use the `{{customer.first_name}}` form. Saving a template with an unknown variable is refused.
  - Values are HTML-escaped when filled in, so data cannot become markup.
  - Template HTML is sanitised against an allowlist: no scripts, styles, frames, event handlers or `javascript:` links. Images must be `https`.
  - Each save keeps the previous version, which can be restored.
- **Scheduling and send windows.**
  - An email can be sent now or at a time.
  - Automated email waits for the dealer's send window: business hours on sending days, in the dealer's time zone. The defaults are 9:00 to 19:00, Monday to Saturday.
- **Tracking.**
  - Links in dealer email go through `/api/crm/t/c/<token>`. The redirect is signed (HMAC) to the email and the URL. An altered link goes to the home page, never to the URL it names.
  - Opens come from a 1×1 pixel and are approximate.
  - The unsubscribe link is never wrapped by tracking.
  - Tracking is switched off with `CRM_EMAIL_TRACKING=false`.
- **Replies.** Inbound email is not read. A reply is recorded when:
  - a salesperson marks an email replied;
  - the customer answers in Vintrax messaging;
  - a call is logged with the customer.

## Consent and suppression

Every email has a purpose: `TRANSACTIONAL` (replies, confirmations, service) or `MARKETING`. `ComplianceService.canSend` decides whether it may go. It checks when the email is queued and again just before it is sent.

| Rule                                                           | Transactional | Marketing |
| -------------------------------------------------------------- | :-----------: | :-------: |
| Address on a suppression list (hard bounce, complaint, manual) |    blocked    |  blocked  |
| Current consent required                                       |               |     ✓     |
| Unsubscribed from this dealership                              |               |  blocked  |
| Dealer's business address set (sender identification)          |               |     ✓     |

- **Consent records.** Each `CrmConsent` stores its type, source, evidence and expiry, and who recorded it.
  - **Express** consent does not expire.
  - **Implied** consent from an inquiry lasts 6 months (183 days).
  - **Implied** consent from a purchase lasts 2 years (730 days).
  - A Vintrax message to the dealer records implied inquiry consent automatically. A sale records implied purchase consent automatically. The dealer can switch either off in settings.
  - Withdrawing a consent is audited.
- **Footer.** Every dealer email carries the dealership's name, address, phone and email.
- **Unsubscribing.**
  - Marketing email also carries an unsubscribe link to `/unsubscribe?t=…`. The page asks for confirmation, so mail scanners that follow links do not unsubscribe anyone.
  - It also carries RFC 8058 `List-Unsubscribe` and `List-Unsubscribe-Post` headers for one-click unsubscribe in mail apps.
  - An unsubscribe takes effect immediately and stops that lead's running automations.
- **Suppression lists.** A dealer has its own list. The platform keeps a global list for bounces and complaints.

## Automations

An automation has three parts:

- **A trigger.**
  - Dealer triggers: lead created, vehicle inquiry, status changed, appointment booked or completed, test drive, financing request, trade-in, deposit, sale, no response, customer inactive.
  - Support triggers: ticket created, ticket waiting, ticket resolved.
- **A list of steps.**
- **Stop conditions:** replied, won, lost, appointment completed, unsubscribed, email invalid, ticket closed, user replied.

Step types:

| Step                                                               | Does                                                                       |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `WAIT`                                                             | Waits a number of minutes                                                  |
| `CONDITION`                                                        | Checks rules about the lead or ticket, then goes to the `yes` or `no` step |
| `SEND_EMAIL`                                                       | Queues a template: to the customer, or to the salesperson                  |
| `CREATE_TASK`, `NOTIFY`                                            | Creates a task, or notifies the assignee, the managers or the team         |
| `ASSIGN`, `SET_STATUS`, `ADD_TAG`, `REMOVE_TAG`, `MOVE_TO_NURTURE` | Change the lead or ticket                                                  |
| `APPOINTMENT_REMINDER`                                             | Emails the next appointment's reminder                                     |
| `START_AUTOMATION`, `STOP`                                         | Hand over to another automation, or end                                    |

**How a sequence runs.**

- Each lead or ticket in an automation is a persistent `CrmAutomationEnrollment` with a current step and `nextRunAt`.
- The engine runs due enrollments on each scheduler tick and checks the stop conditions before every step.
- A failing step is retried with back-off. After 5 attempts it is `FAILED`, and the failure is visible and retryable in the CRM.

**Validation.**

- The schema refuses a sequence that loops, or that points at a step that does not exist.
- It refuses a step with missing settings, such as a wait with no length or an email with no template.

**Defaults.**

- Eight dealer automations are provided **switched off**: new-lead follow-up, appointment confirmation, no response, test-drive follow-up, financing, trade-in, post-sale and re-engagement. Each dealer turns on what they want.
- The three support automations are on: ticket received, waiting reminder, resolved and survey.
- Turning an automation off stops its running enrollments.

**Scheduler.**

- `CrmScheduler` runs in the API process every `CRM_SCHEDULER_INTERVAL_MS`. It runs sooner after an action that queued work.
- Once a minute it also runs the time checks:
  - no response and inactivity;
  - overdue tasks and task reminders;
  - appointment reminders;
  - waiting tickets and ticket auto-close;
  - admin task reminders.
- It is off when `NODE_ENV=test`, and can be switched off per instance with `CRM_SCHEDULER_ENABLED=false`.

## Campaigns

A campaign sends a marketing template to an audience. The audience is filtered by status, source, tag, province, temperature, vehicle make and whether the lead is a customer.

- **The audience preview** shows who is reached and who is skipped, and why: no consent, unsubscribed or suppressed.
- **Sending.** The campaign is sent now or at a time. Emails are queued with an idempotency key per lead, then sent within the send window.
- **Results.** The campaign tracks recipients, sent, opened, clicked and unsubscribed. The dealer can record what the campaign cost.

## Where leads come from

Other modules tell the CRM what happened through `CrmEvents`.

- `CrmEvents` is a global, optional dependency. A module that does not have it works exactly as before.
- It enqueues jobs on the `crm` queue, which is the platform's BullMQ, or inline when `QUEUE_DRIVER=inline`.
- The CRM's worker turns each job into CRM data. A failure there never breaks the action that caused it.

| Event                             | Source     | CRM result                                                                                                                                                                                          |
| --------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A buyer messages a dealer         | messaging  | Creates or updates a lead (`VEHICLE_INQUIRY` when about a vehicle); implied inquiry consent; assignment and first-contact task; a reply from the customer is a reply; a dealer's message is contact |
| A finance application             | finance    | Lead with financing interest and the `FINANCING_REQUEST` trigger                                                                                                                                    |
| A deposit received, a sale posted | accounting | `DEPOSIT`, `SALE` and `WON`; the lead links to the customer; implied purchase consent                                                                                                               |
| The contact form                  | contact    | A support ticket                                                                                                                                                                                    |

## The support desk

**Tickets.**

- Each ticket has a number, requester, category, priority, status, assignee and team. It can be linked to a dealer and a vehicle, and carries tags and an SLA due time.
- Tickets open from the user portal, from the contact form, from a site-chat conversation, or by an administrator on someone's behalf.

**Messages.** A message is either `PUBLIC` or `INTERNAL`.

- **Public** messages are the conversation with the requester. They are emailed to the requester and shown in their portal.
- **Internal** notes are for administrators only.
- When an administrator replies publicly, the ticket moves to _waiting for user_ (or _waiting for dealer_). When the requester replies, it reopens.
- A ticket closed more than 30 days ago is not reopened; the requester opens a new one.

**Assignment.** A new ticket goes, in turn, to the members of its team or of the default team. Without a team, the administrator with the fewest open tickets gets it.

**Settings.**

- **SLA.** First-response and resolution targets per priority set the due time.
- **Reminders and closing.** Waiting tickets remind the requester after a set number of days. Resolved tickets close after a set number of days.

**Dealer 360 and User 360** show, for one dealer or one user:

- the account and its status;
- staff or dealership memberships;
- inventory counts or listings;
- open and closed tickets, admin tasks and internal notes;
- support email and notifications;
- account activity and the support audit history.

A 360 page also lets an administrator message the dealer or user by email, in the app, or both. Dealer 360 deliberately shows no leads and no financial records.

**Admin tasks.** Follow-ups, account checks and escalations. Each can be linked to a ticket, a dealer or a user, with a due time and a reminder.

## Reports and audit

- **Dealer dashboard.** For the period:
  - new leads and uncontacted leads;
  - overdue tasks and today's appointments;
  - response time against the target;
  - conversion, by source and by salesperson.
- **Dealer reports.**
  - Status mix, and source performance with cost per lead and per sale.
  - The funnel from contact to appointment, test drive and sale.
  - Lost reasons and response-time buckets.
  - Follow-up discipline.
  - Email delivery, open, click, reply, bounce and unsubscribe rates.
  - Campaign and automation results.
  - Ranges are resolved in the dealer's time zone.
- **Support reports.**
  - Created, resolved, open, overdue and reopened tickets.
  - Average first-response and resolution times.
  - Tickets by category, priority, source, dealer and administrator.
  - Communication volume.
- **Audit.** These are written to the audit log:
  - lead creation, edits, deletion, merge and export;
  - status changes, consent and suppression changes;
  - template, automation and campaign changes;
  - settings changes, and every support-desk change.

  The log is append-only, enforced by a trigger.

## Configuration

| Variable                    | Default     | Purpose                                                                   |
| --------------------------- | ----------- | ------------------------------------------------------------------------- |
| `CRM_SCHEDULER_ENABLED`     | `true`      | Run the scheduler in this API instance (always off under `NODE_ENV=test`) |
| `CRM_SCHEDULER_INTERVAL_MS` | `15000`     | Tick interval                                                             |
| `CRM_EMAIL_MAX_ATTEMPTS`    | `5`         | Attempts before an email is `FAILED`                                      |
| `CRM_EMAIL_TRACKING`        | `true`      | Open and click tracking in dealer email                                   |
| `CRM_WEBHOOK_SECRET`        | unset       | At least 16 characters; enables `POST /api/crm/webhooks/email`            |
| `SUPPORT_REPLY_TO`          | `MAIL_FROM` | Reply-To on support email                                                 |

Mail itself uses the platform's existing `MAIL_DRIVER`, `MAIL_FROM` and `SMTP_*` settings. Tracking links and unsubscribe links are built from `APP_URL`.

## Demo data

`pnpm --filter @vintrax/backend prisma:seed` (`prisma/seed-crm.ts`) gives North Shore Motors the following, once per database:

- six leads in different stages, with consent records, activities, an overdue task and an upcoming test drive;
- its sender identity;
- one support ticket from `jordan.lee@example.test`, with a public reply and an internal note.

The seed goes through the real CRM services. It sends no email: anything the services queue is cancelled. Automations stay switched off.

## Tests

- **`crm.unit.spec.ts`** covers:
  - the sanitiser against script, handler, `javascript:` and entity-obfuscation attacks;
  - template rendering, escaping and unknown variables;
  - signed tracking links;
  - time zones, send windows and report ranges;
  - automation conditions and the graph validation.
- **`crm.api.db.spec.ts`** runs both CRMs end to end over a real database. Only authentication and the mail transport are stood in for. It covers:
  - role and dealership isolation, and the salesperson's lead scope;
  - read-only accountants;
  - lost-reason enforcement, duplicates and merge, scoring;
  - compose → dispatch → first contact;
  - retry with back-off, and hard bounce → global suppression;
  - marketing consent, the unsubscribe link and one-click unsubscribe;
  - open and click tracking, and forged-link refusal;
  - an automation's email → wait → branch → task, idempotency, and stop-on-reply;
  - loop rejection;
  - ticket internal-note isolation, requester-only access, admin-only routes;
  - the append-only audit log.

Run them with a database, for example:

```bash
DATABASE_URL=postgresql://…/vintrax_test pnpm --filter @vintrax/backend test -- crm
```

## Assumptions and limits

- **Not production-proven.** The CRM is tested as described above and was exercised against a running API with demo data. It has not run with real dealer traffic or a real SMTP provider's bounce feed.
- **Inbound email** is not read. Replies are recorded by hand, from Vintrax messages, or from logged calls.
- **SMS** is logged as an activity only. Nothing sends texts.
- **Opens** are approximate, because mail apps block or pre-load images.
- **Delivery events** beyond SMTP's own answer need a provider webhook. Without one, `SENT` means accepted by the SMTP server.
- **The scheduler** runs inside the API process. A long outage delays sends and reminders until the next start; nothing is lost.
- **CASL.** This is an implementation of the rules described in the issue, not legal advice.
- **The mobile app** has no CRM screens. The web CRM is responsive, with a phone layout for the pipeline, lists and lead page.
