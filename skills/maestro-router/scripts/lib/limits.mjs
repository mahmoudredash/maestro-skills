// Tracks models/providers that hit a usage limit, with a cooldown.
// State is global per machine (limits belong to the account, not the project):
//   $MAESTRO_STATE_DIR/limits.json  or  ~/.config/maestro/state/limits.json

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { globalConfigDir } from "./config.mjs";

export function limitsPath() {
  const dir = process.env.MAESTRO_STATE_DIR || join(globalConfigDir(), "state");
  return join(dir, "limits.json");
}

export function readLimits(path = limitsPath()) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function writeLimits(data, path = limitsPath()) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmp, path);
}

/** Key under which a limit is recorded for this agent/model, per the agent's limit_scope. */
export function limitKey(agent, model) {
  return agent.limit_scope === "model" ? `model:${agent.agent}:${model.id}` : `provider:${model.provider}`;
}

/** Returns the active limit entry for agent/model, or null. Checks both scopes so a
 *  provider-wide limit recorded via one agent also blocks the same provider in another. */
export function activeLimit(agent, model, limits, now = Date.now()) {
  for (const key of [`provider:${model.provider}`, `model:${agent.agent}:${model.id}`]) {
    const e = limits[key];
    if (e && Date.parse(e.until) > now) return { key, ...e };
  }
  return null;
}

export function markLimited(agent, model, reason, { now = Date.now(), path } = {}) {
  const limits = readLimits(path);
  const key = limitKey(agent, model);
  const until = new Date(now + agent.cooldown_minutes * 60_000).toISOString();
  limits[key] = { until, reason: String(reason).slice(0, 300), at: new Date(now).toISOString(), via: `${agent.agent}:${model.id}` };
  writeLimits(limits, path);
  return { key, until };
}

export function clearLimits({ path, key } = {}) {
  const limits = readLimits(path);
  if (key) delete limits[key];
  writeLimits(key ? limits : {}, path);
}

/** True when a relay result looks like a usage/rate limit rather than a real failure. */
export function looksLimited(agent, result) {
  if (!result) return false;
  const text = [result.stderrTail, result.error, result.status !== "completed" ? result.finalMessage : null]
    .flat()
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  const completedButEmpty =
    result.status === "completed" &&
    Array.isArray(result.touchedFiles) &&
    result.touchedFiles.length === 0 &&
    agent.limit_signals.some((s) => String(result.finalMessage ?? "").toLowerCase().includes(s));
  return completedButEmpty || (result.status !== "completed" && agent.limit_signals.some((s) => text.includes(s)));
}
