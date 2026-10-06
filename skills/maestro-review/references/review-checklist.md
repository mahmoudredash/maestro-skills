# Review checklist

## A. Per card (free-model output)
Correctness
- [ ] Logic matches the card's steps and business rules, including every worked example
- [ ] Every edge case in the card's table is handled as specified
- [ ] No invented APIs: every import and call resolves to real code (typecheck or grep)
- [ ] Errors are handled per the card and the repo conventions (nothing swallowed, no silent defaults)

Scope and hygiene
- [ ] Only the listed files changed; no drive-by refactors or reformatting
- [ ] No new dependencies unless the card lists them
- [ ] Existing tests and snapshots untouched
- [ ] No debug output, commented-out code, TODOs, or placeholder values
- [ ] No hard-coded secrets, URLs, or credentials

Tests
- [ ] The tests the card requires exist, under the specified names
- [ ] The tests assert real values (not just "does not throw" or `toBeDefined`)
- [ ] The tests would fail if the feature were removed

## B. Final (whole feature)
- [ ] Every success criterion in analysis.md is met
- [ ] Every approved decision (D#) is implemented as approved
- [ ] Full test, lint, typecheck, and build pass
- [ ] Migrations are reversible, or have a documented rollback; existing data is handled
- [ ] Security: input validation, authorization checks, no injection, no PII in logs
- [ ] Performance: no N+1 queries, no unbounded loops, pagination on growing tables
- [ ] Concurrency and idempotency where relevant (retries, double submits, webhooks)
- [ ] Time zones, currency, and rounding are consistent with the decisions
- [ ] Logs and errors are good enough to debug in production
- [ ] Docs, README, and env examples updated if behavior or config changed
- [ ] Consistent across cards: the same naming and patterns, no duplicated helpers
