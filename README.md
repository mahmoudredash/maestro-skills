# Maestro Skills 🎼

**One leader thinks and decides; free models do the typing.**

Maestro is a set of skills that makes any agent (Claude Code by default, or OpenCode, Pi, and
others) handle every task the same way, without you re-explaining the process each time:

```
request ─► analysis ─► business decisions (expert mode) ⏸ your approval ─► plan (speckit) ─► ultra-explicit task cards
        ─► sub-leads (sub-agents) per workstream ─► free models (opencode / pi / cmd) with automatic fallback on usage limits
        ─► tests + cross-review by a different model ─► final review ─► report
```

The goal: **spend Claude tokens only on judgment and decisions**, and hand the writing and the
first-line review to free models.

---

## Skills (v1 — core)

| Skill | Role |
|---|---|
| `maestro` | **Orchestrator.** Runs automatically on every task, drives all phases, and resumes from the last checkpoint if a session is interrupted |
| `maestro-decisions` | Takes on the relevant expert role, prepares every decision with options, pros/cons and a recommendation, then **stops until you approve** |
| `maestro-breakdown` | Turns the plan into ultra-explicit task cards a free model can execute, each tagged with Type / Sensitivity / Workstream |
| `maestro-router` | Picks the agent + model for each card, dispatches it through delegate-skills, and falls back to the next model when one hits its usage limit |
| `maestro-workstream` | Sub-lead playbook for one workstream: dispatches cards, reviews, commits, and returns a short summary to the leader |
| `maestro-review` | Runs the tests itself, gets a cross-review from a model of a different provider, issues PASS / FIX / TAKEOVER, and runs the final review |

---

## Installation

```bash
# 1) The skills (global)
npx skills add mahmoudredash/maestro-skills
#    or from a local clone:
git clone https://github.com/mahmoudredash/maestro-skills && cd maestro-skills && ./install.sh   # --link to apply your edits live

# 2) Dependencies
npx skills add amElnagdy/delegate-skills                             # dispatch relays (required)
uv tool install specify-cli --from git+https://github.com/github/spec-kit.git   # speckit (optional, recommended)
#    plus the agent CLIs you will use: opencode / pi / cmd — log in to each

# 3) Editable configuration
node ~/.claude/skills/maestro-router/scripts/maestro.mjs init --global     # ~/.config/maestro/
node ~/.claude/skills/maestro-router/scripts/maestro.mjs init --project    # <repo>/.maestro/ (this project only)

# 4) Check the setup
node ~/.claude/skills/maestro-router/scripts/maestro.mjs doctor
```

**To make it automatic on every task:** copy `skills/maestro/templates/CLAUDE.md.snippet` into
`~/.claude/CLAUDE.md` or the project's `CLAUDE.md`. If the leader is not Claude, use
`AGENTS.md.snippet` instead.

---

## Configuration: `config.yaml`

Looked up in this order (first one found wins):
1. `--config-dir`
2. `$MAESTRO_HOME`
3. `<repo>/.maestro/`
4. `~/.config/maestro/`
5. the shipped defaults in `skills/maestro/defaults/`

### Profiles and roles
```yaml
profile: claude-led          # default. Or: free-only, or a profile of your own
profiles:
  claude-led:
    roles:
      leader:         { agent: claude-code, model: opus,   effort: high,   used_for: [...] }
      sub_lead:       { agent: claude-code, model: haiku,  effort: medium, used_for: [...] }
      implementer:    { pool: agents, effort: medium }       # picked from the agent files
      reviewer:       { pool: agents, min_tier: 3, effort: high }
      final_reviewer: { agent: claude-code, model: sonnet, effort: high }
```
- **Change the leader:** edit `leader.agent` and `leader.model`. For example, `free-only` makes the leader `opencode` with a free model, with no Claude at all.
- **Effort:** one of `low | medium | high | max`. It is translated automatically to each agent's own flag: `--variant` in opencode, `--effort` in cmd.
- **`used_for`:** documents what each role uses its model for.

### When every free model is limited
```yaml
on_exhaustion: ask           # default: stop and ask you
# on_exhaustion: wait_and_retry
wait_and_retry: { max_wait_minutes: 120, max_cycles: 3 }
```

---

## Agent files: `agents/*.yaml`

One file per agent, each with an **open list of models from any provider**:

```yaml
agent: opencode
delegate_skill: opencode-delegate
limit_scope: provider        # a limit applies to the whole provider, in every agent
cooldown_minutes: 60
models:
  - id: opencode/big-pickle
    provider: opencode-zen
    tier: 4                  # 1 weakest … 5 strongest
    good_for: [feature, refactor, complex-logic, general]
    status: active           # active | standby (fallback only) | disabled
    fallback_order: 1
  - id: ollama-cloud/gpt-oss:120b
    provider: ollama-cloud
    tier: 4
    status: standby          # "good, but held in reserve": used only when the models above hit their limits
```

- **Add a model:** add an entry, then run `doctor` to confirm the model actually exists.
- **Add an agent:** create a new file pointing to a delegate-skills relay, such as `codex-delegate` or `kimi-delegate`.

The default files list the best-known free models at the time of writing:

| Agent | Models |
|---|---|
| opencode | OpenCode Zen free models (confirmed on a real install, 2026-10): `big-pickle`, `mimo-v2.6-flash-free`, `nemotron-3-ultra-free`, `space-bunny-free` |
| pi | **Examples only, shipped disabled.** pi's ids depend on your providers and extensions (`pi install npm:pi-free`). Put the ids from `pi --list-models` in and enable them |
| cmd | `ling-3.1-flash:free`, `laguna-s-2.1-free`, `space-bunny-alpha`, `ling-3.0-flash-sante:free` |

⚠️ Free model names change often. **Run `doctor`** after installing. `doctor --fix` disables any model your CLIs don't list. It only edits your own config files, so run `init` first.

**Pinning a project to exact models** (for example "only Big Pickle implements, only Mimo reviews"): use the per-role `models` allowlist. See `skills/maestro-router/SKILL.md` → "Pinning a role to exact models".

**What to commit:** commit `.maestro/` (the project's routing rules). Commit `.workflow/` too if `state.commit_state` is true. Usage limits live in `~/.config/maestro/state/` and are never committed.

### How a model is chosen
1. **Filtering:** a model is dropped if it is `disabled`, in a cooldown, below the minimum `tier`, or not suited to the task type.
2. **Ordering:**
   - `active` first, then `standby`.
   - A model suited to the exact type before a general one (`general`).
   - **Sensitive tasks** get the strongest model first.
   - **Normal tasks** get the cheapest model that is good enough, so the strong models' quota stays available for the tasks that need it.
3. **Fallback:** this order is the fallback chain. When a model hits its limit it gets a cooldown — with `limit_scope: provider`, the whole provider is paused in every agent — and the next candidate takes over.

```bash
MR="node ~/.claude/skills/maestro-router/scripts/maestro.mjs"
$MR route --type feature --sensitivity sensitive     # show the order without running anything
$MR limits show                                      # what is cooling down, and until when
$MR limits clear provider:opencode-zen               # if you know the quota has reset
$MR config                                           # the final configuration after merging
```

---

## Sub-agents (the hierarchy)
```
leader ─► one sub-lead per workstream (cheap sub-agent, separate context) ─► free models ─► (their own sub-agents inside their CLI)
```
The leader reads only a short summary from each sub-lead. **In v1, workstreams run one after
another** to avoid git conflicts.

If the leader does not support sub-agents, or `sub_lead.agent: none`, workstreams run inline
inside the leader itself.

---

## State and resuming
Every task gets a `.workflow/NNN-slug/` folder holding the analysis, decisions, plan, cards,
`status.md` and logs. If a session is interrupted, the leader reads `status.md` and continues
from where it stopped.

Approved business decisions are also recorded in the project's `docs/business-rules.md`, so the
same question is never asked twice.

---

## Extensions
The core **depends on no extension**. Extensions live in the `extensions/` folder; planned ones:
- **OmniRoute:** a provider layer underneath the agents.
- **Decision engine:** for example Command Code's *jev* model.

Details in `extensions/README.md`.

## Development
```bash
npm test        # router and YAML tests (no dependencies)
npm run doctor
```
