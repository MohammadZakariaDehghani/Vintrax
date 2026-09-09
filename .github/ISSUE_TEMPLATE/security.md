---
name: Security issue
about: A weakness in Atlas, or hardening work arising from an audit
title: ''
labels: 'type:security'
assignees: ''
---

> **Stop and check where this belongs.**
>
> This repository is public, and so is this issue. An unfixed, exploitable
> weakness written up here is a set of instructions for anyone who finds it
> first.
>
> Use a **private security advisory** instead — repository → Security →
> Advisories → *Report a vulnerability* — when the weakness is exploitable
> against a running deployment and not yet fixed.
>
> A public issue is the right place for: hardening work with no live exposure,
> a finding already fixed, a dependency advisory that is public anyway, or a
> follow-up from `documentation/security-audit.md`. When in doubt, go private;
> it can always be made public afterwards.

## Description

<!-- What the weakness is, at a level that lets you act on it without
     publishing a working exploit. -->

## Security impact

<!-- What an attacker gains. Read access to whose data? A privilege they
     should not hold? Money moved? Availability lost? -->

## Affected component

<!-- Package, module, endpoint, guard, or permission. For example:
     "POST /api/orders/:id/payment — TransactionsService.confirmPayment". -->

## Attack scenario

<!-- Who the attacker is — an anonymous visitor, a signed-in buyer, a dealer,
     a compromised admin — and the sequence of steps. Keep it to what is
     needed to reproduce and fix. -->

## Severity

<!-- Critical / High / Medium / Low, with one line of reasoning. Weigh both
     how easily it is reached and what it exposes. -->

## Evidence

<!-- Enough to confirm the finding is real, and no more.

     Never paste: real passwords, JWT secrets, private keys, API tokens,
     database credentials, or customer personal data. Report a secret's
     location, type and risk — never its value. -->

## Suggested mitigation

<!-- The fix as you see it. In this codebase the durable answer is usually to
     move the rule somewhere it has to be stated: a field removed from the
     schema rather than ignored in a handler, and the schema strict so sending
     it is refused loudly. See D-022 in the decision log. -->

## Requirements

- [ ] Weakness confirmed with evidence, not assumed
- [ ] Fixed at the layer that enforces the rule, not only at the caller
- [ ] A negative-case test proves the attack is refused

## Acceptance criteria

- [ ] The original attack is attempted against the fix and fails
- [ ] Legitimate use of the same path still works
- [ ] No other caller depended on the permissive behaviour
- [ ] `documentation/security-audit.md` updated if this came from the audit
- [ ] Secrets have not been committed, logged, or pasted into this issue

## Technical notes

<!-- Guards, permissions, schemas, and any related findings. -->

## Dependencies

<!-- Blocked by #, relates to #, or "none". -->

## Definition of done

- [ ] Fix implemented
- [ ] Negative-case test added and passing
- [ ] The original attack re-run against a running instance and refused
- [ ] Self-review done
- [ ] CI green, including the security job
- [ ] Documentation updated
- [ ] Pull request opened and linked to this issue
- [ ] Pull request reviewed
- [ ] Merged, and deployed if the weakness is live
