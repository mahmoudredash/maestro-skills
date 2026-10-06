---
name: maestro-router
description: Picks the best FREE agent+model for a task card from the per-agent model files (opencode, pi, Command Code, ...), dispatches it through the matching delegate-skills relay, and automatically falls back to the next model or provider when one hits a usage/rate limit, applying the on_exhaustion policy when everything is limited. Use whenever maestro (or a sub-lead) needs to send work to a free model, to inspect limits, or to check the agent setup.
license: MIT
compatibility: Node 18+, git. Requires delegate-skills relays (npx skills add amElnagdy/delegate-skills) and the agent CLIs you enable.
metadata:
  version: 1.0.0
---

# Maestro router

`MR` = `node <this-skill-dir>/scripts/maestro.mjs`. It has zero dependencies and works
under any orchestrating agent that can run shell commands.

## Configuration it reads
- `config.yaml`: `profile`, `roles`, `routing`, `on_exhaustion`, `wait_and_retry`, `dispatch`.
- `agents/*.yaml`: **one file per agent CLI**, each with an **open list of models from any provider**.

They are looked up in this order: `--config-dir`, then `$MAESTRO_HOME`, then `<repo>/.maestro/`,
then `~/.config/maestro/`, then the shipped defaults in `<skills-root>/maestro/defaults/`.
Create an editable copy with `$MR init --global` or `$MR init --project`.

### Agent file essentials
```yaml
agent: opencode                  # name used in refs: "opencode:<model id>"
enabled: true
priority: 1                      # tie-breaker between agents (lower first)
delegate_skill: opencode-delegate
list_models_cmd: "opencode models"
relay_flags: { model: --model, effort: --variant }   # pi adds provider: --provider
effort_map: { low: minimal, medium: "", high: high, max: max }
limit_signals: ["429", "rate limit", "quota", ...]
limit_scope: provider            # a limit blocks the whole provider (in every agent) | model
cooldown_minutes: 60
models:
  - id: opencode/big-pickle      # exact --model value
    provider: opencode-zen       # quota bucket shared across agents
    tier: 4                      # 1 weak … 5 strongest (your estimate)
    good_for: [feature, refactor, general]
    avoid_for: [migration]
    status: active               # active | standby (fallback only) | disabled
    fallback_order: 1
```
To add a model, add an entry. To add an agent CLI, add a file whose `delegate_skill` is one
of the delegate-skills relays (`pi-delegate`, `commandcode-delegate`, `codex-delegate`,
`kimi-delegate`, …). Then run `$MR doctor`.

## How a model is chosen
1. **Filters:** the agent is enabled; the model is not `disabled`; the model is not cooling down from a limit; the card's type is not in `avoid_for`; the type is in `good_for` (or `good_for` includes `general`); `tier` ≥ the floor; the provider or model is not excluded.
   - The tier floor is `routing.sensitive_min_tier` for sensitive cards and `reviewer_min_tier` for reviewers, or the role's own `min_tier`.
2. **Order:** `active` before `standby`; exact `good_for` before `general`. Then:
   - **sensitive → the strongest tier first.**
   - **normal → the cheapest sufficient tier first**, which saves the strong models' quota.
   - Ties go by agent `priority`, then `fallback_order`.
3. The ordered list **is the fallback chain**.

Preview it without running anything:
```bash
$MR route --type feature --sensitivity sensitive
$MR route --type tests --role reviewer --exclude-provider opencode-zen
```

## Dispatch
```bash
$MR dispatch --brief .workflow/<run>/tasks/T03-x.md --out .workflow/<run>/logs/T03 \
   --type feature --sensitivity normal --role implementer
# reviewer (read-only, a different provider from the implementer):
$MR dispatch --brief .workflow/<run>/logs/T03/review-brief.md --out .workflow/<run>/logs/T03/review \
   --type review --role reviewer --read-only --exclude-provider <implementer provider>
# options: --pin agent:model   --session <id> (FIX round on the same model)   --effort low|medium|high|max
#          --agent opencode (repeatable; restrict agents)   --no-wait   --dry-run   --allow-dirty
```
**Run it in the background** if your agent supports that (Claude Code: `run_in_background`).
Real implementation runs can take a long time.

What dispatch does:
- A write task requires a **clean working tree** (`stopped` otherwise).
- It calls the relay for the first candidate. The relay never commits.
- **Usage limit** (the relay result matches `limit_signals`):
  1. The router records it in `~/.config/maestro/state/limits.json` with a cooldown.
  2. It stashes any partial edits (`git stash list` shows "maestro: partial attempt by …").
  3. It re-ranks the candidates. With `limit_scope: provider`, every model of that provider, **in every agent**, is skipped until the cooldown ends.
- **Hard failure:** it tries the next candidate, without recording a limit.
- **The agent's CLI is missing:** that agent's other models are skipped for this dispatch.
- It writes `<out>/dispatch.json` and prints it. Exit codes:

| Exit | `status` | What you do |
|------|----------|-------------|
| 0 | `completed` | Review it (`maestro-review`). `model`, `provider`, `sessionId`, `resultPath`, and `touchedFiles` are included. |
| 3 | `failed` | Every candidate failed for real reasons. Read `attempts[].detail`, then rewrite the card or escalate. |
| 4 | `exhausted` | Every candidate is limited. Apply `on_exhaustion` (below). |
| 6 | `retry_later` | `wait_and_retry` is on: wait until `retryAfter`, then re-dispatch with `--cycle <nextCycle>` (below). |
| 5 | `stopped` / `no_candidates` | Fix the precondition (dirty tree, a config that excludes every model). |

## on_exhaustion
- `ask` (**default**): the router returns `exhausted` right away, with `retryAfter`. The leader must STOP and ask the user, with options: wait until `retryAfter`, enable a `standby` or `disabled` model, add a model or agent, or have the leader do the card.
- `wait_and_retry`: waits for the earliest cooldown to end (at most `max_wait_minutes` per wait, at most `max_cycles` waits), then retries. When the wait would be longer, or the cycles are used up, it returns `exhausted`, which you treat like `ask`.
  - `mode: defer` (**default**): dispatch returns `retry_later` (exit 6) immediately with `retryAfter` and `nextCycle`. Then:
    ```bash
    $MR wait --until <retryAfter>        # run in the BACKGROUND; give it a timeout ≥ waitMinutes + 5
    $MR dispatch <same arguments> --cycle <nextCycle>
    ```
    Agent shells cap how long one command may run (Claude Code: 10 min in the foreground, up to 2 h in the background), so a dispatch must never sleep for hours itself. If your agent can schedule a wake-up instead (for example `ScheduleWakeup` or `send_later`), you may use that rather than `wait`.
  - `mode: inline`: dispatch sleeps by itself and retries. Use it only in plain shells or CI with no command time limit.

## Limits and health
```bash
$MR limits show            # what is cooling down, until when, and why
$MR limits clear [key]     # e.g. provider:opencode-zen, once you know the quota reset
$MR doctor                 # CLIs on PATH, relays installed, model ids present in each agent's model list, speckit
$MR config                 # the resolved profile, roles, agents and models
```

## Rules
- Never pass a model that isn't in an agent file. If the user wants a new model, add it to the file first.
- Never treat a relay's `completed` as success by itself. `maestro-review` decides.
- Keep each `dispatch.json` in the state folder. The report cites which model did what.
