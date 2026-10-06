// Locates and loads Maestro configuration: workflow config + one file per agent.
//
// Resolution order (first directory that contains config.yaml wins; the agents/
// directory is resolved the same way, independently):
//   1. --config-dir <dir>                (explicit)
//   2. $MAESTRO_HOME                      (env override)
//   3. <git-root>/.maestro                (project scope)
//   4. ~/.config/maestro                  (global scope; $XDG_CONFIG_HOME respected)
//   5. <skills-root>/maestro/defaults     (shipped defaults)
//
// Extension packs: any installed skill that ships a `maestro-agents/` folder (e.g.
// maestro-omniroute) adds its agent files on top. An agent defined in the config dir with
// the same `agent` name wins; `extensions.disabled: [<skill name>]` turns a pack off.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseYaml } from "./yaml.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// scripts/lib -> scripts -> maestro-router -> skills root
export const SKILLS_ROOT = resolve(HERE, "..", "..", "..");
export const DEFAULTS_DIR = join(SKILLS_ROOT, "maestro", "defaults");

export function gitRoot(cwd = process.cwd()) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

export function globalConfigDir() {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "maestro");
}

export function candidateDirs({ configDir, cwd } = {}) {
  const dirs = [];
  if (configDir) dirs.push({ scope: "explicit", dir: resolve(configDir) });
  if (process.env.MAESTRO_HOME) dirs.push({ scope: "env", dir: resolve(process.env.MAESTRO_HOME) });
  const root = gitRoot(cwd);
  if (root) dirs.push({ scope: "project", dir: join(root, ".maestro") });
  dirs.push({ scope: "global", dir: globalConfigDir() });
  dirs.push({ scope: "defaults", dir: DEFAULTS_DIR });
  return dirs;
}

export const BUILTIN_DEFAULTS = {
  profile: "claude-led",
  on_exhaustion: "ask",
  wait_and_retry: { max_wait_minutes: 120, max_cycles: 3 },
  routing: { sensitive_min_tier: 4, normal_min_tier: 1, reviewer_min_tier: 3, prefer_cheapest_sufficient: true, allow_unfit_fallback: false },
  dispatch: { max_model_switches: 6, default_timeout: "45m" },
  state: { dir: ".workflow" },
};

export function loadConfig(opts = {}) {
  const dirs = candidateDirs(opts);
  const cfgHit = dirs.find((d) => existsSync(join(d.dir, "config.yaml")));
  const agentsHit = dirs.find((d) => existsSync(join(d.dir, "agents")) && yamlFiles(join(d.dir, "agents")).length > 0);

  const raw = cfgHit ? parseYaml(readFileSync(join(cfgHit.dir, "config.yaml"), "utf8")) : {};
  const config = deepMerge(BUILTIN_DEFAULTS, raw);

  const profileName = opts.profile || config.profile;
  const profile = config.profiles?.[profileName];
  if (config.profiles && !profile) {
    throw new Error(`profile "${profileName}" not found in config (available: ${Object.keys(config.profiles).join(", ")})`);
  }
  config.activeProfile = profileName;
  config.roles = profile?.roles ?? config.roles ?? {};

  const agents = agentsHit ? loadAgents(join(agentsHit.dir, "agents")) : [];
  const packs = loadPackAgents(opts.skillsRoot ?? SKILLS_ROOT, config.extensions?.disabled ?? []);
  const known = new Set(agents.map((a) => a.agent));
  for (const a of packs.agents) if (!known.has(a.agent)) agents.push(a);
  return {
    config,
    agents,
    sources: {
      config: cfgHit ? join(cfgHit.dir, "config.yaml") : "(built-in defaults)",
      configScope: cfgHit?.scope ?? "builtin",
      agents: agentsHit ? join(agentsHit.dir, "agents") : null,
      agentsScope: agentsHit?.scope ?? null,
      packs: packs.names,
    },
  };
}

/** Agent files shipped by installed extension packs: <skills-root>/<skill>/maestro-agents/*.yaml */
export function loadPackAgents(skillsRoot, disabled = []) {
  const out = { agents: [], names: [] };
  let entries = [];
  try {
    entries = readdirSync(skillsRoot, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((x, y) => x.name.localeCompare(y.name))) {
    if (!(e.isDirectory() || e.isSymbolicLink()) || disabled.includes(e.name)) continue;
    const dir = join(skillsRoot, e.name, "maestro-agents");
    if (!existsSync(dir)) continue;
    const found = loadAgents(dir).map((a) => ({ ...a, pack: e.name }));
    if (found.length) {
      out.agents.push(...found);
      out.names.push(e.name);
    }
  }
  return out;
}

function yamlFiles(dir) {
  try {
    return readdirSync(dir).filter((f) => /\.ya?ml$/.test(f) && !f.startsWith("_"));
  } catch {
    return [];
  }
}

export function loadAgents(dir) {
  return yamlFiles(dir)
    .sort()
    .map((f) => {
      const a = parseYaml(readFileSync(join(dir, f), "utf8"));
      return normalizeAgent(a, join(dir, f));
    });
}

export function normalizeAgent(a, file = "(inline)") {
  if (!a || typeof a !== "object") throw new Error(`${file}: empty agent file`);
  if (!a.agent) throw new Error(`${file}: missing "agent"`);
  if (!a.delegate_skill) throw new Error(`${file}: missing "delegate_skill"`);
  const models = (a.models ?? []).map((m, i) => {
    if (!m?.id) throw new Error(`${file}: models[${i}] missing "id"`);
    return {
      id: String(m.id),
      provider: m.provider ? String(m.provider) : String(m.id).split("/")[0],
      relay_provider: m.relay_provider ?? null,
      tier: Number(m.tier ?? 2),
      good_for: m.good_for ?? ["general"],
      avoid_for: m.avoid_for ?? [],
      status: m.status ?? "active",
      fallback_order: Number(m.fallback_order ?? i + 1),
      roles: m.roles ?? null,                   // e.g. [implementer]: never used for other roles
      sensitive_ok: m.sensitive_ok !== false,   // false: never used for sensitive cards
      notes: m.notes ?? "",
    };
  });
  return {
    agent: String(a.agent),
    file,
    enabled: a.enabled !== false,
    priority: Number(a.priority ?? 5),
    delegate_skill: String(a.delegate_skill),
    binary: a.binary ?? a.agent,
    list_models_cmd: a.list_models_cmd ?? null,
    default_model: a.default_model ?? models[0]?.id ?? null,
    relay_flags: { model: "--model", provider: null, effort: null, read_only: "--read-only", timeout: "--timeout", ...(a.relay_flags ?? {}) },
    effort_map: a.effort_map ?? {},
    timeout: a.timeout ?? null,
    limit_signals: (a.limit_signals ?? ["429", "rate limit", "rate_limit", "quota", "usage limit", "too many requests"]).map((s) =>
      String(s).toLowerCase(),
    ),
    limit_scope: a.limit_scope ?? "provider",
    cooldown_minutes: Number(a.cooldown_minutes ?? 60),
    preflight: normalizePreflight(a.preflight),
    models,
  };
}

// Optional health check run once per dispatch before an agent's models are tried.
// Exit 0 = available, 3 = available only as fallback (models treated as standby),
// anything else = unavailable (agent skipped and cooled down for `cooldown_minutes`).
// Placeholders: {node} = this Node binary, {skills_root} = installed skills folder.
function normalizePreflight(p) {
  if (!p) return null;
  const o = typeof p === "string" ? { cmd: p } : p;
  if (!o.cmd) return null;
  return { cmd: String(o.cmd), cooldown_minutes: Number(o.cooldown_minutes ?? 10), timeout_seconds: Number(o.timeout_seconds ?? 10) };
}

export function deepMerge(base, over) {
  if (Array.isArray(over) || typeof over !== "object" || over === null) return over === undefined ? base : over;
  const out = { ...(base ?? {}) };
  for (const [k, v] of Object.entries(over)) {
    out[k] = typeof v === "object" && v !== null && !Array.isArray(v) ? deepMerge(base?.[k], v) : v;
  }
  return out;
}
