<!--
Vintrax has one developer, and the reviewer is usually that same person a day
later, or an AI assistant reading cold. Both need the same thing from this
description: what changed, why, and what you actually ran. Fill it in for
them, not for a process.
-->

## Related issue

Closes #

## Summary

<!-- What changed and why. Lead with the reason — the diff already shows the
     what. If this reverses an earlier decision, say so and name it. -->

## Changes

-
-
-

## Testing

<!-- Tick what you ran, and say what you found. "Tested manually" with no
     detail is not a report — name the case you exercised and the result. -->

- [ ] Unit tests (`pnpm test`)
- [ ] End-to-end tests (`pnpm test:e2e`)
- [ ] Typecheck and lint (`pnpm typecheck`, `pnpm lint`)
- [ ] Exercised against a running instance
- [ ] CI green

What was exercised, and what happened:

## Security

- [ ] No secrets committed — no keys, tokens, passwords or connection strings
- [ ] Authorization reviewed: who may call this, and is ownership checked in
      the service and not only by the route guard?
- [ ] Input validated by a schema, with fields a caller must not control kept
      out of it rather than ignored in the handler
- [ ] Sensitive data handling reviewed — personal data, documents, payment records
- [ ] Not applicable, because:

## Database

- [ ] No migration
- [ ] Migration included, and `pnpm db:migrate` is needed on deploy
- [ ] Change is backwards-compatible with the currently deployed API

## Checklist

- [ ] Follows the existing architecture and conventions
- [ ] No unrelated changes riding along
- [ ] Tests added or updated where warranted
- [ ] Documentation updated where needed
- [ ] `documentation/decision-log.md` updated if this makes or reverses a
      significant decision
- [ ] Ready for review

<!--
Merging is the developer's call, not the assistant's. An AI-authored pull
request waits for human approval — see documentation/PROJECT_WORKFLOW.md.
-->
