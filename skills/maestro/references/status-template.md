# Status — <NNN>-<slug>

**Request:** <one line>
**Size:** XS | S | M | L
**Profile:** <claude-led | free-only | ...>   **Leader:** <agent / model>
**Current phase:** 0-Intake | 1-Analysis | 2-Decisions (WAITING ON USER) | 3-Plan | 4-Cards | 5-Delegation | 6-Escalation (WAITING ON USER) | 7-Final review | 8-Done
**Last updated:** <YYYY-MM-DD HH:MM>

## Gates
- [ ] Decisions presented (<date>)
- [ ] Decisions answered (<date>), see decisions.md

## Workstreams
| WS | Name | Cards | Sub-lead | State |
|----|------|-------|----------|-------|
| W1 | backend API | T01–T04 | haiku sub-agent | done |
| W2 | UI | T05–T06 | haiku sub-agent | in progress |

## Cards
| ID | Type | Sens. | Implemented by | Reviewed by | Attempts | Verdict | Commit | Notes |
|----|------|-------|----------------|-------------|----------|---------|--------|-------|
| T01 | feature | normal | opencode:opencode/big-pickle | opencode:opencode/mimo-v2.6-flash-free | 1 | PASS | abc123 | |
| T02 | feature | sensitive | opencode:opencode/big-pickle | pi:gpt-oss:120b | 2 | FIX→PASS | def456 | zen limited once → fell back |
| T03 | migration | sensitive | — | — | 3 | TAKEOVER | 789abc | leader rewrote card |

## Limits seen
- opencode-zen limited 14:05 → 15:05 (T02)

## Final verification
- test: <command> → <real result>
- lint: <command> → <real result>
- build: <command> → <real result>

## Follow-ups / deferred
- ...

## Resume note
<Exactly what happens next, so a fresh session can continue.>
