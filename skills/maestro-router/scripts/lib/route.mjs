// Picks and orders (agent, model) candidates for a task card.
//
// Ordering rules:
//   1. Hard filters: agent enabled, model status != disabled, not under an active
//      limit, task type not in avoid_for, tier >= the minimum for this role and
//      sensitivity, not in the exclude lists (used for cross-review).
//   2. "active" models before "standby" ones (standby = only used as fallback).
//   3. Fit: task type in good_for (2) > "general" in good_for (1). Models with
//      neither are skipped unless routing.allow_unfit_fallback is true (then last).
//   4. Tier: sensitive work takes the STRONGEST first; normal work takes the
//      CHEAPEST SUFFICIENT first (saves strong models' quota for work that needs it).
//   5. Agent priority (lower first), then the model's fallback_order.
// Providers in task.avoidProviders (soft exclusion, e.g. the implementer's provider for a
// cross-review) go after every other candidate, but stay in the chain.
// The returned list is the fallback chain: dispatch walks it in order.

import { activeLimit } from "./limits.mjs";

export function minTierFor({ role, sensitivity }, routing) {
  let min = routing.normal_min_tier ?? 1;
  if (sensitivity === "sensitive") min = Math.max(min, routing.sensitive_min_tier ?? 4);
  if (role === "reviewer") min = Math.max(min, routing.reviewer_min_tier ?? 3);
  return min;
}

export function rankCandidates(agents, task, { routing = {}, limits = {}, now = Date.now() } = {}) {
  const type = task.type ?? "general";
  const minTier = task.minTier ?? minTierFor(task, routing);
  const excludeProviders = new Set(task.excludeProviders ?? []);
  const excludeModels = new Set(task.excludeModels ?? []);
  const onlyAgents = task.agents?.length ? new Set(task.agents) : null;
  const demote = new Set(task.demoteAgents ?? []); // preflight said "fallback only"
  const onlyModels = task.models?.length ? new Set(task.models) : null; // role allowlist: "agent:model"
  const avoid = new Set(task.avoidProviders ?? []); // soft: tried only after every other provider
  const sensitive = task.sensitivity === "sensitive";
  const preferCheap = routing.prefer_cheapest_sufficient !== false;

  const all = [];
  const skipped = [];
  for (const agent of agents) {
    for (const model of agent.models) {
      const ref = `${agent.agent}:${model.id}`;
      const skip = (why) => skipped.push({ ref, why });
      if (!agent.enabled) { skip("agent disabled"); continue; }
      if (onlyAgents && !onlyAgents.has(agent.agent)) { skip("agent not selected"); continue; }
      if (onlyModels && !onlyModels.has(ref)) { skip("not in this role's models allowlist"); continue; }
      if (model.status === "disabled") { skip("model disabled"); continue; }
      if (model.avoid_for.includes(type)) { skip(`avoid_for ${type}`); continue; }
      if (model.roles && !model.roles.includes(task.role ?? "implementer")) { skip(`role ${task.role} not allowed`); continue; }
      if (sensitive && model.sensitive_ok === false) { skip("not allowed for sensitive cards"); continue; }
      if (model.tier < minTier) { skip(`tier ${model.tier} < ${minTier}`); continue; }
      if (excludeProviders.has(model.provider)) { skip(`provider ${model.provider} excluded`); continue; }
      if (excludeModels.has(model.id) || excludeModels.has(ref)) { skip("model excluded"); continue; }
      const lim = activeLimit(agent, model, limits, now);
      if (lim) { skip(`limited until ${lim.until} (${lim.key})`); continue; }
      const fit = model.good_for.includes(type) ? 2 : model.good_for.includes("general") ? 1 : 0;
      if (fit === 0 && !routing.allow_unfit_fallback) { skip(`not good_for ${type}`); continue; }
      const demoted = demote.has(agent.agent);
      all.push({ agent, model, ref, fit, standby: model.status === "standby" || demoted ? 1 : 0, avoided: avoid.has(model.provider) ? 1 : 0 });
    }
  }

  all.sort(
    (a, b) =>
      a.avoided - b.avoided ||
      a.standby - b.standby ||
      b.fit - a.fit ||
      (sensitive || !preferCheap ? b.model.tier - a.model.tier : a.model.tier - b.model.tier) ||
      a.agent.priority - b.agent.priority ||
      a.model.fallback_order - b.model.fallback_order,
  );
  return { candidates: all, skipped, minTier };
}

/** Earliest time any currently-limited candidate becomes usable again (ISO), or null. */
export function earliestRecovery(agents, task, { routing = {}, limits = {}, now = Date.now() } = {}) {
  const { candidates } = rankCandidates(agents, task, { routing, limits: {}, now });
  let best = null;
  for (const c of candidates) {
    const lim = activeLimit(c.agent, c.model, limits, now);
    if (lim && (!best || Date.parse(lim.until) < Date.parse(best))) best = lim.until;
  }
  return best;
}
