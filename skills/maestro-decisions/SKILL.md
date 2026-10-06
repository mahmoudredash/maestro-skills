---
name: maestro-decisions
description: Expert-mode decision gate. Use when analyzing a task reveals choices the code cannot answer — business rules, pricing, workflows, compliance, UX, data retention, integrations, architecture trade-offs. Takes on the relevant domain expert role, prepares every decision with options, trade-offs and a recommendation, presents them, then STOPS until the user approves. Called by maestro at Phase 2; usable on its own.
license: MIT
metadata:
  version: 1.0.0
---

# Decisions gate (expert mode)

This is leader work. Do not delegate it to a free model: wrong business assumptions are the
most expensive mistakes in the whole pipeline.

## 1. Identify the real decisions
A decision belongs here only if **all** of these are true:
- The code, the docs, and the existing behavior do not already answer it.
- Different answers lead to different behavior, cost, risk, or user experience.
- A product owner or business owner would reasonably want a say.

Pure engineering details with one obvious answer are not decisions. Decide those yourself and note them in the plan.

Typical sources: pricing, fees and rounding, currency and tax; statuses and state
transitions; roles and permissions; SLAs, cut-off times and time zones; partial or split
operations, returns and cancellations; notifications; data retention and privacy; audit
trails; third-party integrations; reporting definitions (what counts as "done", "delivered",
"active"?); multi-branch or multi-tenant behavior; backward compatibility for existing data.

## 2. Become the expert
For each decision, name the role you take on, for example *Operations Manager*, *Finance
Controller*, *Compliance Officer*, *UX Lead*, *Security Architect*, *Data Engineer*,
*Solutions Architect*, or a domain specialist (logistics, healthcare, e-commerce, ...).
Reason as that person would: use industry practice, the regulations that usually apply,
failure modes seen in the field, and what competitors typically do. Be concrete and practical.

## 3. Prepare each decision
Use `references/decision-template.md`. Each decision needs:
- **Why it matters.**
- **2–4 real options.** Include "minimal / defer" when that is valid.
- For each option: pros, cons, effort (S/M/L), risk, and its effect on the plan.
- **A recommendation (⭐)** with the expert reasoning, and what would change your mind.
- **A default if unanswered**, clearly labeled.

Order the decisions by impact, blocking ones first. Keep the list short. More than about 7
means you should decide the minor ones yourself and list them under **Assumptions** for a quick veto.

## 4. Present, then STOP
Present everything in **one message**, in the user's language:
1. A one-line understanding of the task.
2. Decisions D1…Dn, each with options A/B/C and ⭐ on the recommendation.
3. Assumptions the user can veto.
4. A plan outline (5–10 lines) that assumes the recommended options.
5. A reply hint (in the user's language), for example: `Reply "approve" to accept all recommendations, or e.g. D1=B, D3=C`.

If your agent has a structured question tool (for example `AskUserQuestion` in Claude
Code), you may use it **in addition to** the written analysis, never instead of it.

Save everything to `decisions.md`, set `status.md` to "2-Decisions (WAITING ON USER)", and
**end your turn**. Do not keep working in the meantime.

## 5. After the answer
- Record each answer: `APPROVED`, `CHANGED → B`, `DEFERRED`, or `CUSTOM: …`. "ok" / "approve" / "approve all" (or the equivalent in the user's language) means every recommendation is approved.
- Raise only the new conflicts, briefly.
- Append the durable business rules to the project's `docs/business-rules.md` (create it if needed), so the same question is never asked twice in future tasks. Before asking anything in Phase 2, check that file.
- Continue with maestro Phase 3 in the same turn.

Later artifacts (the plan and the task cards) quote the decision **text**, not just its ID, because free models never see `decisions.md`.
