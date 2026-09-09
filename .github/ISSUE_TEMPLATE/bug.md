---
name: Bug
about: Something behaves differently from how it should
title: ''
labels: 'type:bug'
assignees: ''
---

## Description

<!-- One sentence on what is wrong. -->

## Steps to reproduce

1.
2.
3.

## Expected behaviour

<!-- What should have happened. -->

## Actual behaviour

<!-- What happened instead. A silent no-op counts: "the form said it saved and
     nothing changed" is a bug report, and historically the most common kind
     in this repository. -->

## Environment

- Where: <!-- local dev / Ubuntu server / CI -->
- Browser and version: <!-- if it is a web issue -->
- Signed in as: <!-- role — buyer, seller, dealer, inspector, admin, or signed out -->
- Commit or version:

## Logs and errors

<!-- API log lines, the browser console, the failing CI job. Redact tokens,
     passwords, connection strings and customer data before pasting. -->

## Screenshots

<!-- If it is visual. -->

## Requirements

- [ ] Root cause identified, not just the symptom
- [ ] Fixed
- [ ] A test covers the case that broke, where the bug is testable

## Acceptance criteria

- [ ] The reproduction above no longer reproduces
- [ ] The class of bug is addressed where that is cheap, not only this instance
- [ ] Existing behaviour still works
- [ ] Security implications considered — a bug in an authorization path is a
      security issue and belongs on the security template instead

## Technical notes

<!-- Where the fault actually is, once known. -->

## Dependencies

<!-- Blocked by #, relates to #, or "none". -->

## Definition of done

- [ ] Fix implemented
- [ ] Regression test added where appropriate
- [ ] Self-review done
- [ ] CI green
- [ ] Reproduction re-run against the fix
- [ ] Documentation updated if the behaviour was documented
- [ ] Pull request opened and linked to this issue
- [ ] Pull request reviewed
- [ ] Merged
