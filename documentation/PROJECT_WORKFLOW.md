# How Atlas Is Run

GitHub is the single source of truth for what needs doing, what is being done,
and what is finished. If a piece of work is not an Issue, it does not exist.

Atlas has **one developer**, assisted by AI coding agents. Everything below is
shaped by that. There is no reviewer to hand work to, no QA gate, no release
manager. What replaces them is a written Definition of Done, automated CI, and
the developer reading the diff before merging. Nothing here exists to satisfy a
process; each rule is there because skipping it has a cost.

## The board

One GitHub Project — **Atlas Development** — with six columns.

| Column | Means |
| --- | --- |
| **Backlog** | Captured, not committed to. Most issues live here. |
| **Todo** | Chosen for the current stretch of work. Refined enough to start. |
| **In Progress** | Being worked on now. Keep this to one or two items. |
| **Review** | Pull request open. Waiting on the developer's read of the diff. |
| **Testing** | Merged or ready to merge, being exercised against a running instance. |
| **Done** | Merged, deployed where relevant, verified. |

`Testing` is a real column and not ceremony. Most of the bugs found in this
project so far were found by clicking, not by the test suite — a stripped form
field that reported success, a dead dashboard tile, an uploaded photo silently
ignored. None of those had a failing test. The column exists to make "did you
actually use it?" a step rather than a hope.

## Issues

**One issue, one outcome.** If it cannot be described in a sentence, it is an
epic and should be split.

Every issue carries three labels: a `type:`, an `area:`, and a `priority:`.
`status:` labels are added only when they are true.

Templates live in `.github/ISSUE_TEMPLATE/`: Feature, Bug, Technical task,
Improvement, and Security issue. Blank issues are enabled on purpose — a
thought worth capturing should never be lost to a form.

### Epics

Issues titled `[EPIC] …` map the platform's long-running areas. They are
labelled `epic`, carry **no milestone** (an area is not time-boxed; the work
inside it is), and act as the place to link related issues so a subject has one
front door.

## Labels

Four axes. Defined in `.github/project/labels.yml`, applied by the
**Project setup** workflow.

| Axis | Question it answers |
| --- | --- |
| `type:` | What kind of work — feature, bug, task, improvement, refactor, documentation, security, devops, test |
| `area:` | Where in Atlas — frontend, backend, api, database, marketplace, auctions, inspections, customer, dealer, admin, mobile, authentication, payments, messaging, infrastructure, deployment, monitoring |
| `priority:` | How soon — critical, high, medium, low |
| `status:` | Why it is stuck — blocked, needs-review, needs-testing |

Two more: `epic` for the area issues, and `ai-assisted` for work an AI agent
wrote, because that changes who has to look at it before it merges.

### Priority, in plain terms

- **critical** — production is broken, data is at risk, or a live weakness is
  exposed. Drop everything.
- **high** — blocks the current milestone.
- **medium** — planned, not urgent. The default.
- **low** — worth doing eventually. Honest about it.

## Milestones

Five, in `.github/project/milestones.yml`: Hardening & Launch Readiness,
Marketplace Growth, Inspections & Trust, Auctions & Ecosystem, Production
Launch.

There is no "Foundation" milestone. Phase 1 shipped before this board existed,
and a milestone that is born closed is filing, not planning. A milestone is
created when there is real work waiting to go in it.

## Branches

```
feature/    new capability          feature/saved-searches
bugfix/     something is wrong      bugfix/auth-token-expiration
refactor/   same behaviour          refactor/vehicle-api
hotfix/     urgent, on production   hotfix/payment-confirmation-guard
chore/      dependencies, tooling   chore/update-dependencies
```

Branch from `main`. Small documentation fixes can go straight to a branch and
PR without an issue — the PR is the record. Anything touching behaviour gets an
issue first.

## Pull requests

Every change reaches `main` through a pull request, including AI-authored work
and including the developer's own. The PR is where CI runs and where the diff
gets read in one piece.

The template is `.github/pull_request_template.md`. `Closes #123` in the body
links the issue and closes it on merge.

**A second human reviewer is not required, because there isn't one.** What
replaces it:

1. CI must be green. It is not advisory.
2. The developer reads the whole diff before merging. `/code-review` is a
   useful first pass, not a substitute.
3. The PR states what was actually exercised, and what happened.

## Definition of done

An issue is Done when all of it is true:

- [ ] Implemented
- [ ] Tests added where the logic warrants them
- [ ] Self-reviewed — the full diff, read
- [ ] CI green
- [ ] Exercised against a running instance, not only in tests
- [ ] Documentation updated if a developer or user would otherwise be surprised
- [ ] `documentation/decision-log.md` updated if a significant decision was made or reversed
- [ ] Pull request merged
- [ ] Deployed, if the change is live-facing

## CI

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`:

| Job | Does |
| --- | --- |
| **verify** | Installs, generates the Prisma client, applies migrations against a real Postgres and Redis, then `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and runs the seed twice to prove it is idempotent |
| **security** | `pnpm audit --audit-level high` as a blocking gate, plus a Trivy filesystem scan for vulnerabilities, secrets and misconfiguration, published as an artifact |
| **docker** | Builds the API, web and mobile images. Runs only after `verify` passes |

Nothing deploys automatically. Deployment is `scripts/update-ubuntu.sh` on the
server, run deliberately.

**Do not weaken a check to make it pass.** A failing `pnpm audit` is fixed
through the `pnpm.overrides` block in the root `package.json`, not by lowering
the threshold.

## Production changes

The developer approves, every time. That covers:

- Merging to `main`
- Deploying
- Database migrations against production
- Infrastructure changes — Terraform, Kubernetes, DNS, certificates
- Anything touching secrets or environment configuration
- Changing a permission in `ROLE_PERMISSIONS`
- Reversing a decision in `documentation/decision-log.md`

## Working with AI assistants

AI agents do the work. They do not decide what the work is, and they do not
decide when it is finished.

### The loop

1. Read the issue.
2. Inspect the relevant code before proposing anything.
3. Name the affected files, the architectural impact, and the security
   implications — who may call this, and what may they see?
4. Implement on a branch named as above.
5. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and the build.
6. Exercise the change against a running instance.
7. Open a pull request referencing the issue, labelled `ai-assisted`.
8. Report what was done and what was actually verified — including what failed.
9. **Stop. Wait for the developer.**

### Rules

An AI assistant must **not**:

- Merge a pull request unless told to, in that instance
- Change production infrastructure, or run migrations against production
- Delete or rename branches, issues, milestones, labels, or project data
- Commit, print, or move a secret — report a secret's **location, type and
  risk**, never its value
- Change repository or environment secrets
- Weaken a security control, a guard, or a CI check to get a green run
- Rewrite architecture, or swap a major dependency, without explicit approval
- Mark something done that it has not verified

And must:

- Report failures plainly. A test that fails is reported with its output; a
  step that was skipped is named as skipped
- Say when a check proved nothing. A screenshot taken while the API was down
  is not evidence the page works
- Distinguish **Confirmed** from **Likely** from **Potential** when reporting a
  security finding

### Why `ai-assisted` exists

Not as a warning label. It tells the developer that nobody has read this diff
with a human's understanding of the product yet, which is exactly the review
the checklist above cannot replace.

## Keeping this system honest

The board is worth having only while it reflects reality. Two habits keep it
there: close issues when they are done rather than in a sweep, and delete
nothing — a superseded decision is marked superseded, an abandoned issue is
closed as not planned with a reason. The history is the point.

## Changing the project setup

Labels and milestones are code. Edit `.github/project/labels.yml` or
`.github/project/milestones.yml`, open a pull request, and after merging run
**Actions → Project setup → Run workflow**. It creates what is missing and
corrects what has drifted. It never deletes — removing a label strips it from
every issue carrying it, so that stays a deliberate manual act.

Run it with **dry run** ticked first to see what would change.
