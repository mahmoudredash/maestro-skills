---
name: maestro-workstream
description: Sub-lead playbook — coordinates one workstream of task cards end to end (dispatch each card to a free model via maestro-router, run checks, get a cross-review from a different free model, retry/fallback, commit passing cards) and returns a short summary to the leader. Use when maestro hands you a workstream (as a sub-agent), or when the leader runs a workstream inline because sub-agents are unavailable.
license: MIT
metadata:
  version: 1.0.0
---

# Workstream sub-lead

The sub-lead exists to **keep the leader's context and tokens small**. You absorb the noise
(logs, diffs, retries) and hand back a short summary. You do not redesign anything: the
cards are the contract.

## Inputs
- The run folder `.workflow/<NNN>-<slug>/`
- The workstream ID, e.g. `W2`, with its cards listed in `workstreams.md`
- `MR` = `node <skills-root>/maestro-router/scripts/maestro.mjs`

## Loop, per card in dependency order
1. **Pre-flight:** `git status --porcelain` must be empty. If it isn't, it holds your own uncommitted work: finish that card first, or stash it and note that.
2. **Dispatch the implementer:**
   ```bash
   $MR dispatch --brief tasks/T0X-*.md --out logs/T0X --type <Type> --sensitivity <Sensitivity> --role implementer
   ```
   Read the printed JSON (`dispatch.json`). Act on it:
   - `exhausted` → stop the workstream and report it (see "Return").
   - `retry_later` → run `$MR wait --until <retryAfter>` in the background (timeout ≥ `waitMinutes` + 5 min), then repeat this same dispatch with `--cycle <nextCycle>`. Do not report this to the leader unless it ends in `exhausted`.
   - `failed` or `stopped` → stop the workstream and report it.
   - `completed` → continue with step 3.
3. **Check it** (`maestro-review`, "Per-card review"):
   - Scope: only the card's files changed.
   - Run the card's verify commands **yourself**, and save the output to `logs/T0X/verify.txt`.
   - Read the done criteria.
4. **Cross-review:** build `logs/T0X/review-brief.md` from `maestro-review/references/review-brief-template.md`, then:
   ```bash
   $MR dispatch --brief logs/T0X/review-brief.md --out logs/T0X/review --type review --role reviewer --read-only \
      --exclude-model <implementer agent:model> --avoid-provider <implementer provider>
   ```
5. **Verdict** (rules in `maestro-review`):
   - **PASS** → if `git.commit` is `per_card` (the default), commit only the card's files: `T0X: <title>`, with a trailer `Implemented-by: <agent:model>` / `Reviewed-by: <agent:model>`. If it is `never`, leave the changes uncommitted and record PASS in `status.md`.
   - **FIX** → append the feedback to the card. Re-dispatch with `--session <sessionId> --pin <same agent:model> --allow-dirty` (the tree still holds the attempt; the brief is just the feedback delta), up to 2 times per model. After that, revert the attempt (`git stash`) and dispatch with no pin, so the router picks the next model.
   - **TAKEOVER** → after 3 failed attempts across models, or when the card itself is wrong: stash the attempt, mark the card TAKEOVER, and continue with the cards that don't depend on it.
6. **Sensitive cards:** after the reviewer's PASS, do **not** commit. Mark the card `AWAITING-LEADER` and include its diff stat in the summary. The leader reads the diff and commits it.
7. Update the card's row in `status.md`.

## Return (your final message to the leader: short, no diffs, no logs)
```
WORKSTREAM W2 — <name>
DONE: T05 (opencode:opencode/mimo-v2-pro-free → reviewed by pi:gpt-oss:120b, 1 attempt), T06 (...)
AWAITING-LEADER (sensitive): T07 — diffstat: 2 files, +48 −3 — logs/T07
TAKEOVER: T08 — reason: <one line> — logs/T08
BLOCKED: exhausted at T09 — retryAfter 15:05Z — limited: provider:opencode-zen, model:commandcode:laguna-s-2.1-free
VERIFY: <the command> → <pass/fail counts>
```

## Sub-lead prompt (the leader passes this when starting you as a sub-agent)
> You are the sub-lead for workstream {W} of run `.workflow/{run}`. Load and follow the
> `maestro-workstream` skill exactly. The skills root is `{skills-root}`. Process the cards
> {list} in order. Do not edit the cards except to append feedback, and do not change the plan.
> Return only the summary block from the skill's "Return" section.

## Nesting
A free-model implementer may itself use sub-agents inside its own CLI (for example,
OpenCode's subagents). That is allowed and invisible to you. You judge only the resulting diff.
