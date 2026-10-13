# Email

How Vintrax sends email, how to run it on Resend, and what to check when it
goes wrong. Decision record: [D-068](./decision-log.md).

## How it works

All email leaves through one service, `MailService`
(`backend/src/common/mail`). It has exactly one active **driver**:

| `MAIL_DRIVER` | What happens                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `log`         | Nothing leaves the server. In development the message — links included — is written to the API log. Tests always use this. |
| `resend`      | Sent through the [Resend](https://resend.com/docs) API with the official SDK.                                              |
| `smtp`        | Sent through any SMTP server. Kept for deployments that already use one.                                                   |

There is no fan-out: a message is never sent through two providers.

There are two kinds of email, and they are kept apart:

- **Platform email** — account and security mail, notifications, admin alerts.
  It is rendered from the template catalogue (`templates/catalog.ts`), logged
  in the `EmailMessage` table, and sent in the background so no request waits
  on the provider.
- **CRM email** — what dealers and the support desk send to leads and
  customers: one-off messages, appointment confirmations, campaigns and
  automations. It has its own outbox (`CrmEmail`) with scheduling, consent
  (CASL), unsubscribe, suppression and tracking, and calls the same service to
  deliver. See [crm.md](./crm.md).

Transactional and marketing mail stay separate: CRM marketing email needs
consent and carries an unsubscribe link; security and account email is never
switched off by an unsubscribe.

### Platform email templates

| Template                 | Category     | Sent when                                                                          |
| ------------------------ | ------------ | ---------------------------------------------------------------------------------- |
| `auth.verify-email`      | security     | An account is created, its email changes, or verification is re-requested          |
| `auth.password-reset`    | security     | Someone asks to reset a password (`/forgot-password`)                              |
| `auth.password-changed`  | security     | A password is changed in settings or through a reset link                          |
| `auth.email-changed`     | security     | The sign-in email changes — sent to the **old** address                            |
| `account.created`        | account      | An administrator creates an account (no password is ever emailed)                  |
| `account.status-changed` | account      | An administrator suspends, deactivates or reactivates an account                   |
| `notification.generic`   | notification | An in-app notification the person also wants by email                              |
| `finance.application`    | notification | A buyer applies for financing on a listing                                         |
| `auction.outbid`         | notification | A bidder is outbid                                                                 |
| `contact.message`        | notification | Someone writes through the Contact page (sent to the inbox set in Admin → Contact) |
| `admin.alert`            | admin        | See [Admin alerts](#admin-alerts)                                                  |

Every template has an HTML part and a plain-text part, the same branded frame,
and strictly validated variables. Every value is HTML-escaped; links are built
only from `APP_URL` and fixed paths, never from input. The two templates that
carry a single-use link (`verify-email`, `password-reset`) are marked
**secret**: their variables are never written to the database, so the email
log cannot be used to sign in as anyone.

The links land on `/verify-email`, `/reset-password` and `/forgot-password`
in the web app.

### Delivery, retries and duplicates

- **Logged first.** Each platform email is a row in `EmailMessage` before it
  is sent: template, category, recipient, subject, status, provider message id,
  attempts and the last error (sanitised — never a token, key or body).
- **One logical email, one send.** Each row has a unique idempotency key, and
  the same key is passed to Resend, so a retry after a timeout cannot produce a
  second copy at either end.
- **Retries.** A transient failure (rate limited, a 5xx, a network error) is
  retried with bounded exponential backoff and jitter, up to
  `MAIL_MAX_ATTEMPTS`. A permanent one (an invalid address, an unverified
  sender, a revoked key) is not retried. A quota error waits at least an hour.
- **Restarts.** A sweep runs every minute on every API process (rows are
  claimed with `FOR UPDATE SKIP LOCKED`, so two processes never take the same
  one). It re-sends ordinary messages a stopped process left behind, from their
  stored template variables. A secret-link message cannot be re-sent — its link
  was never stored — so it is marked failed and the person asks for a new link.
- **Rate.** Requests to Resend are spaced to `RESEND_MAX_REQUESTS_PER_SECOND`.

### Statuses: accepted is not delivered

| Status       | Meaning                                                             |
| ------------ | ------------------------------------------------------------------- |
| `QUEUED`     | Logged, waiting to send or to retry                                 |
| `SENDING`    | Being sent                                                          |
| `ACCEPTED`   | The provider took it. **It has not necessarily reached the inbox.** |
| `DELAYED`    | The receiving server deferred it, or it soft-bounced                |
| `DELIVERED`  | The receiving server accepted it (a webhook event)                  |
| `BOUNCED`    | Hard bounce — the address is now suppressed                         |
| `COMPLAINED` | Marked as spam — the address is now suppressed                      |
| `FAILED`     | Refused, or out of attempts                                         |
| `SUPPRESSED` | Not sent: the address bounced or complained earlier                 |
| `SKIPPED`    | Not sent: notification email is switched off                        |

Only a webhook event moves a message past `ACCEPTED`. Events that arrive out
of order never move a message backwards: a `delivered` after a `complained`
records its time but leaves the status `COMPLAINED`.

Suppression is shared with the CRM (`CrmSuppression` rows with no dealer), so a
hard bounce from either stops both. Security email is still attempted for a
suppressed address — the provider has the final say.

### Admin alerts

Sent to `MAIL_ADMIN_TO` (empty: none), at most once an hour per alert:

- a new dealer registration waiting for verification;
- platform email failures reaching `MAIL_ALERT_FAILURE_THRESHOLD` in an hour;
- a CRM automation stopping an enrollment after repeated step failures.

Alerts carry no customer data and link to the admin screen to look at.

### Admin → Emails

`/admin/emails` (permission `email:read`) lists every platform email with its
status and sanitised failure reason, and shows totals for the last week.
`email:manage` adds **Retry** on a failed message: it re-sends the same
template to the same recipient with the same variables — nothing can be
changed — and is written to the audit log. Secret-link messages and suppressed
addresses cannot be retried.

## Admin → Settings → Email

`/admin/settings/email` lets a **super admin** (permission `settings:manage`)
set the provider without touching the server: Resend, the API key, the sender
name and address, and the reply-to address. Decision record:
[D-069](./decision-log.md).

- **Precedence.** While the stored settings are switched off — or their key
  cannot be decrypted — the environment's `MAIL_*` / `RESEND_*` settings keep
  sending, exactly as before. Switched on, the stored settings are used by every
  email the platform sends: registration and verification, password reset,
  account notices, admin alerts and CRM email. Changes take effect at once on
  the process that saved them and within 30 seconds on any other.
- **The API key is write-only.** It is encrypted before it reaches the
  database (AES-256-GCM, a fresh IV per save, the purpose bound in as
  associated data) under `SETTINGS_ENCRYPTION_KEY`, which lives only in the
  server environment. The page shows only whether a key is stored, its last
  four characters and when it was saved. It is never returned by the API,
  written to a log, or recorded in the audit log — the audit entry says
  `apiKey.added`, `apiKey.replaced` or `apiKey.removed`.
- **Replacing and removing.** Leave the key field empty to keep the stored key;
  enter a new one to replace it. Removing the key also switches the stored
  settings off.
- **Test connection** checks a key — the one typed into the form, or the
  stored one — against Resend without saving anything, and reports whether the
  sender's domain is verified. A sending-only key (Resend's recommended kind)
  is valid but cannot read domains; the test says so.
- **Send a test email** goes to the signed-in super admin's own verified
  address — the request names no recipient — through whatever is sending now,
  and reports Resend's answer.
- **Limits.** Both tests: 5 per 10 minutes per address; test emails also 10
  an hour per admin, counted in the database.

If `SETTINGS_ENCRYPTION_KEY` is not set, the page says so and refuses to store
a key; the other fields can still be saved. If the encryption key changes, a
stored key can no longer be decrypted: the page says so, the environment
settings take over, and the key has to be entered again.

### Enabling it on the server

Do this once, before a super admin saves a key:

```bash
ssh root@<server>
openssl rand -base64 32                     # copy the output
nano /opt/vintrax/env/vintrax.env           # SETTINGS_ENCRYPTION_KEY=<that value>
chmod 600 /opt/vintrax/env/vintrax.env
```

Keep a copy in your password manager: without it the stored key cannot be
read, and has to be entered again. Copy the updated
`compose/docker-compose.prod.yml` to the server (it passes the variable to the
API), then deploy. The release applies the additive migration
`20261014000000_email_provider_settings`.

## Configuration

Set on the server in `/opt/vintrax/env/vintrax.env` (chmod 600). Secrets
(`RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`) live only there — never in the
repository, a ticket or a chat.

| Variable                         | Default                            | Purpose                                                            |
| -------------------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| `MAIL_DRIVER`                    | `log`                              | `resend`, `smtp` or `log`                                          |
| `MAIL_FROM`                      | `Vintrax <no-reply@vintrax.local>` | Sender, `Name <address>`; with Resend, on a verified domain        |
| `MAIL_REPLY_TO`                  | —                                  | Where replies go, e.g. `support@vintrax.ca`                        |
| `MAIL_ADMIN_TO`                  | —                                  | Alert recipients, comma-separated                                  |
| `MAIL_NOTIFICATIONS_ENABLED`     | `true`                             | Notification and alert email. Security/account email is always on. |
| `MAIL_MARKETING_ENABLED`         | `true`                             | CRM marketing email; `false` holds it as suppressed                |
| `MAIL_MAX_ATTEMPTS`              | `5`                                | Attempts before a platform email is marked failed                  |
| `MAIL_ALERT_FAILURE_THRESHOLD`   | `10`                               | Failures in an hour that send one alert                            |
| `RESEND_API_KEY`                 | —                                  | `re_…`; required when `MAIL_DRIVER=resend`                         |
| `RESEND_WEBHOOK_SECRET`          | —                                  | `whsec_…`; unset, the webhook endpoint answers 404                 |
| `RESEND_MAX_REQUESTS_PER_SECOND` | `2`                                | Request pacing to Resend                                           |
| `APP_URL`                        | —                                  | Already set; every link in every email is built from it            |

The API refuses to start with `MAIL_DRIVER=resend` and no `re_` key, with a
`MAIL_FROM` on a placeholder domain (`.local`, `.test`, `.example`), or with any
driver but `log` under `NODE_ENV=test`.

How the issue's suggested names map onto the project's existing ones:
`EMAIL_PROVIDER` → `MAIL_DRIVER`; `EMAIL_FROM_NAME` + `EMAIL_FROM_ADDRESS` →
`MAIL_FROM`; `EMAIL_REPLY_TO` / `EMAIL_SUPPORT_ADDRESS` → `MAIL_REPLY_TO`;
`EMAIL_ADMIN_ADDRESS` → `MAIL_ADMIN_TO`; `EMAIL_NOTIFICATIONS_ENABLED` /
`EMAIL_MARKETING_ENABLED` → the `MAIL_` equivalents; `APP_PUBLIC_URL` →
`APP_URL`. A separate `API_PUBLIC_URL` is not needed: the API is served under
`/api` on the site's own origin (see `infrastructure/nginx`).

## Setting up Resend for production

Nothing below has been done for you; each step needs the domain's DNS and a
Resend account. Do not mark the domain verified until Resend says so.

1. **Create a Resend account** at <https://resend.com> and check the current
   plan limits on its pricing page. Do not assume the free tier allows
   unlimited sending, or that the account is approved for production volume.
2. **Add the domain.** Resend → Domains → Add domain → `vintrax.ca` (or a
   subdomain you reserve for sending). Pick the region closest to the server.
3. **Add exactly the DNS records Resend shows**, at your DNS provider. Copy
   each name, type and value from the dashboard; do not retype them from
   anywhere else. Resend's records cover DKIM (a TXT record under
   `_domainkey`) and SPF for its sending subdomain, and an MX record for
   bounce handling — see Resend's
   [domain guide](https://resend.com/docs/dashboard/domains/introduction).
4. **SPF: one record per name.** A domain may have only one SPF (`v=spf1`) TXT
   record at a given name. If one already exists there, merge Resend's
   `include:` into it rather than adding a second record — two SPF records
   make both fail.
5. **DMARC.** Add a TXT record at `_dmarc.vintrax.ca`. Start with monitoring,
   e.g. `v=DMARC1; p=none; rua=mailto:dmarc@vintrax.ca`, read the reports for
   a few weeks, then move to `p=quarantine` and later `p=reject` once only
   legitimate senders appear.
6. **Wait for verification** in the Resend dashboard (DNS can take minutes to
   hours). Use **Verify** to re-check.
7. **Create an API key** (Resend → API Keys) with **sending access** only,
   restricted to the domain. Put it on the server, not in Git:
   ```bash
   ssh root@<server>
   nano /opt/vintrax/env/vintrax.env      # RESEND_API_KEY=re_…
   chmod 600 /opt/vintrax/env/vintrax.env
   ```
8. **Set the sender:**
   ```
   MAIL_DRIVER=resend
   MAIL_FROM=Vintrax <noreply@vintrax.ca>
   MAIL_REPLY_TO=support@vintrax.ca
   MAIL_ADMIN_TO=<an inbox the operators read>
   ```
   Make sure `support@vintrax.ca` actually receives mail before it is the
   reply-to.
9. **Create the webhook.** Resend → Webhooks → Add endpoint:
   `https://vintrax.ca/api/webhooks/resend` (if the API is also served from
   `api.vintrax.ca`, `https://api.vintrax.ca/api/webhooks/resend` reaches the
   same endpoint). Subscribe to `email.sent`, `email.delivered`,
   `email.delivery_delayed`, `email.bounced`, `email.complained`,
   `email.failed` and `email.suppressed`. Copy its **signing secret** into
   `RESEND_WEBHOOK_SECRET=whsec_…`. Unsigned or stale requests are refused.
10. **Update the server's compose file.** `deploy.sh` does not replace
    `/opt/vintrax/compose/docker-compose.prod.yml`; copy the new one from the
    repository (it passes the `MAIL_*` and `RESEND_*` variables to the API):
    ```bash
    cp /opt/vintrax/compose/docker-compose.prod.yml{,.bak}
    # then fetch compose/docker-compose.prod.yml from the repository (docker.md § 3.4)
    ```
11. **Deploy.** The release applies the additive migration
    `20261013000000_email_delivery` with `prisma migrate deploy` before the new
    API starts — the normal path, nothing extra. To pick up only an env change
    without a release: `cd /opt/vintrax/scripts && ./deploy.sh "$(cat ../state/current-version)"`.
12. **Send a controlled test.** Use **Forgot your password?** on the site for an
    account whose inbox you control. Then check:
    - Admin → Emails: the message is `ACCEPTED`, then `DELIVERED` once the
      webhook arrives;
    - Resend → Emails: the same message, with its events;
    - `docker logs vintrax-api | grep email.` — `email.accepted id=…` lines,
      with no addresses or tokens in them.

## Troubleshooting

| Symptom                                                                 | Likely cause and fix                                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API will not start: `RESEND_API_KEY`                                    | The key is missing or not a `re_` key.                                                                                                                                                                                     |
| API will not start: `MAIL_FROM`                                         | A placeholder sender with `MAIL_DRIVER=resend`; use the verified domain.                                                                                                                                                   |
| Every message `FAILED` with `invalid_from_address` / `validation_error` | The sending domain is not verified, or `MAIL_FROM` is not on it. Check Resend → Domains.                                                                                                                                   |
| `invalid_api_key` / `restricted_api_key`                                | The key was revoked or lacks sending access to the domain. Create a new one.                                                                                                                                               |
| Messages `QUEUED` with `rate_limit_exceeded`                            | Bursts above the team's rate. They retry on their own; lower `RESEND_MAX_REQUESTS_PER_SECOND` if it persists.                                                                                                              |
| `daily_quota_exceeded` / `monthly_quota_exceeded`                       | The plan's quota. Messages wait at least an hour between tries; upgrade or reduce volume.                                                                                                                                  |
| Stuck at `ACCEPTED`, never `DELIVERED`                                  | The webhook is not reaching the API: check the endpoint URL, that `RESEND_WEBHOOK_SECRET` matches, and the webhook's attempts in Resend. A `401` in the API log (`webhook.resend.rejected`) is a secret or clock mismatch. |
| Webhook answers `404`                                                   | `RESEND_WEBHOOK_SECRET` is not set on the API.                                                                                                                                                                             |
| Bounces                                                                 | The address is wrong or gone; it is suppressed automatically. Fix the person's address.                                                                                                                                    |
| Spam complaints                                                         | The address is suppressed. Review what was sent; for CRM marketing, check consent records.                                                                                                                                 |
| Mail lands in spam                                                      | Check SPF, DKIM and DMARC pass (view the message headers), and that `MAIL_FROM` matches the verified domain.                                                                                                               |
| Nothing at all is sent, no errors                                       | `MAIL_DRIVER=log` — the log says `MAIL_DRIVER=log in production: no email will be delivered`.                                                                                                                              |

## Cost and volume

- Platform email is sent only on real events; ordinary sign-ins send nothing.
- Admin alerts are limited to one per alert per hour.
- Notification email follows each user's preferences and can be switched off
  entirely with `MAIL_NOTIFICATIONS_ENABLED=false`.
- CRM marketing needs consent, honours unsubscribes and suppression, and can
  be held entirely with `MAIL_MARKETING_ENABLED=false`.
- Admin → Emails shows the week's volume and failures. Resend's own usage page
  is the authority on quota.

## What is not done

- **Delivery state in the CRM's own screens** is updated by the same webhook,
  but the CRM's per-email event list does not show `DELAYED` or `SENT`
  separately — CRM email shows `SENT`, then `DELIVERED`, `BOUNCED` or
  complaints, as before.
- **Opens and clicks** are measured by the CRM itself for CRM email; Resend's
  open and click events are ignored, and platform email is not tracked.
- **Template editing for platform email** is in code (the catalogue), not in
  the admin. CRM templates remain editable in each CRM.
- **Localised platform email.** The web app has English and French; platform
  email is English only, because accounts do not store a language yet.
