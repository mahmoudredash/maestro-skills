#!/usr/bin/env node
// Maestro router CLI — zero dependencies (Node 18+ built-ins only).
//
//   maestro.mjs route    --type <t> [--sensitivity normal|sensitive] [--role implementer|reviewer] [--exclude-provider p]...
//   maestro.mjs dispatch --brief <card.md> --out <dir> [--type t] [--sensitivity s] [--role r] [--read-only]
//                        [--exclude-provider p]... [--exclude-model m]... [--agent a]... [--pin agent:model]
//                        [--session id] [--effort e] [--no-wait] [--cycle n] [--allow-dirty] [--dry-run] [--cd repo]
//   maestro.mjs wait     --until <ISO time> [--max-minutes n]   (sleep until a cooldown ends; run in background)
//   maestro.mjs doctor   [--json]
//   maestro.mjs limits   [show | clear [key]]
//   maestro.mjs init     --global | --project [--force]
//   maestro.mjs config   (print the resolved config and agents)
//
// Common flags: --config-dir <dir>  --profile <name>

import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig, DEFAULTS_DIR, gitRoot, globalConfigDir } from "./lib/config.mjs";
import { readLimits, clearLimits, limitsPath } from "./lib/limits.mjs";
import { rankCandidates } from "./lib/route.mjs";
import { dispatch, findRelay, sleep, EXIT } from "./lib/dispatch.mjs";

const MULTI = new Set(["exclude-provider", "exclude-model", "agent"]);
const BOOL = new Set(["read-only", "no-wait", "allow-dirty", "dry-run", "json", "global", "project", "force", "help"]);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const k = a.slice(2);
    if (BOOL.has(k)) { out[k] = true; continue; }
    const v = argv[++i];
    if (v === undefined) die(`missing value for --${k}`);
    if (MULTI.has(k)) (out[k] ??= []).push(v);
    else out[k] = v;
  }
  return out;
}

function die(msg, code = EXIT.USAGE) {
  process.stderr.write(`maestro: ${msg}\n`);
  process.exit(code);
}

function print(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

const [cmd, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
if (!cmd || cmd === "help" || args.help) {
  process.stdout.write(readHeader());
  process.exit(0);
}

function readHeader() {
  return `Maestro router — see skills/maestro-router/SKILL.md
Commands: route | dispatch | wait | doctor | limits | init | config
`;
}

function load() {
  try {
    return loadConfig({ configDir: args["config-dir"], profile: args.profile, cwd: args.cd });
  } catch (e) {
    die(e.message);
  }
}

switch (cmd) {
  case "config": {
    const { config, agents, sources } = load();
    print({ sources, profile: config.activeProfile, on_exhaustion: config.on_exhaustion, roles: config.roles, routing: config.routing, agents: agents.map((a) => ({ agent: a.agent, enabled: a.enabled, file: a.file, models: a.models.map((m) => `${m.id} [${m.provider}] tier=${m.tier} ${m.status}`) })) });
    break;
  }

  case "route": {
    const { config, agents } = load();
    const role = args.role ?? "implementer";
    const roleCfg = config.roles?.[role] ?? {};
    const task = {
      type: args.type ?? "general",
      sensitivity: args.sensitivity ?? "normal",
      role,
      excludeProviders: args["exclude-provider"],
      excludeModels: args["exclude-model"],
      agents: args.agent ?? roleCfg.agents,
      minTier: roleCfg.min_tier,
    };
    const { candidates, skipped, minTier } = rankCandidates(agents, task, { routing: config.routing, limits: readLimits() });
    print({
      task,
      minTier,
      chain: candidates.map((c, i) => ({ rank: i + 1, ref: c.ref, provider: c.model.provider, tier: c.model.tier, fit: c.fit, standby: !!c.standby })),
      skipped,
    });
    break;
  }

  case "dispatch": {
    if (!args.brief) die("--brief <task-card.md> is required");
    if (!existsSync(args.brief)) die(`brief not found: ${args.brief}`);
    if (!args.out) die("--out <dir> is required (e.g. .workflow/<run>/logs/T01)");
    const { config, agents } = load();
    const { code, summary } = dispatch({
      brief: resolve(args.brief),
      out: resolve(args.out),
      cd: resolve(args.cd ?? gitRoot() ?? process.cwd()),
      type: args.type,
      sensitivity: args.sensitivity,
      role: args.role,
      readOnly: !!args["read-only"],
      excludeProviders: args["exclude-provider"],
      excludeModels: args["exclude-model"],
      agents: args.agent,
      pin: args.pin,
      session: args.session,
      effort: args.effort,
      wait: !args["no-wait"],
      cycle: args.cycle !== undefined ? Number(args.cycle) : 0,
      allowDirty: !!args["allow-dirty"],
      dryRun: !!args["dry-run"],
      config,
      agentsList: agents,
    });
    print(summary);
    process.exit(code);
  }

  case "wait": {
    if (!args.until) die("--until <ISO time> is required (the retryAfter value from dispatch)");
    const until = Date.parse(args.until);
    if (Number.isNaN(until)) die(`not a valid time: ${args.until}`);
    const { config } = load();
    const maxMin = Number(args["max-minutes"] ?? config.wait_and_retry?.max_wait_minutes ?? 120);
    const ms = Math.max(0, until - Date.now());
    if (ms > maxMin * 60_000) die(`refusing to wait ${Math.ceil(ms / 60000)} min (> ${maxMin} min limit)`, EXIT.EXHAUSTED);
    const started = Date.now();
    sleep(ms);
    print({ status: "ready", until: new Date(until).toISOString(), waitedMinutes: Math.round((Date.now() - started) / 6000) / 10 });
    break;
  }

  case "limits": {
    const sub = args._[0] ?? "show";
    if (sub === "show") print({ path: limitsPath(), limits: readLimits() });
    else if (sub === "clear") { clearLimits({ key: args._[1] }); print({ cleared: args._[1] ?? "all" }); }
    else die(`unknown limits subcommand: ${sub}`);
    break;
  }

  case "init": {
    if (!args.global && !args.project) die("choose --global (~/.config/maestro) or --project (<git-root>/.maestro)");
    let target;
    if (args.global) target = globalConfigDir();
    else {
      const root = gitRoot();
      if (!root) die("--project needs to run inside a git repository");
      target = join(root, ".maestro");
    }
    mkdirSync(join(target, "agents"), { recursive: true });
    const copied = [], kept = [];
    const files = ["config.yaml", ...readdirSync(join(DEFAULTS_DIR, "agents")).map((f) => join("agents", f))];
    for (const f of files) {
      const dst = join(target, f);
      if (existsSync(dst) && !args.force) { kept.push(dst); continue; }
      cpSync(join(DEFAULTS_DIR, f), dst);
      copied.push(dst);
    }
    print({ target, copied, kept_existing: kept, next: "edit the agent files, then run: maestro.mjs doctor" });
    break;
  }

  case "doctor": {
    const { config, agents, sources } = load();
    const report = { node: process.version, sources, profile: config.activeProfile, on_exhaustion: config.on_exhaustion, agents: [], speckit: {}, problems: [] };
    if (Number(process.versions.node.split(".")[0]) < 18) report.problems.push("Node 18+ is required");
    for (const a of agents) {
      const bin = spawnSync("sh", ["-c", `command -v ${a.binary}`], { encoding: "utf8" });
      const relay = findRelay(a.delegate_skill);
      const entry = { agent: a.agent, enabled: a.enabled, binary: bin.status === 0 ? bin.stdout.trim() : null, relay, models: [] };
      let listing = null;
      if (entry.binary && a.list_models_cmd) {
        const r = spawnSync("sh", ["-c", a.list_models_cmd], { encoding: "utf8", timeout: 30_000 });
        listing = r.status === 0 ? (r.stdout ?? "") : null;
        if (listing === null) entry.list_models_error = (r.stderr ?? "").slice(-300) || "list command failed";
      }
      for (const m of a.models) {
        entry.models.push({ id: m.id, status: m.status, tier: m.tier, available: listing === null ? "unknown" : listing.includes(m.id) });
      }
      if (a.enabled && !entry.binary) report.problems.push(`${a.agent}: binary "${a.binary}" not on PATH (disable it in ${a.file} or install it)`);
      if (a.enabled && !relay) report.problems.push(`${a.agent}: ${a.delegate_skill} not found — install delegate-skills: npx skills add amElnagdy/delegate-skills`);
      for (const m of entry.models) if (m.available === false && m.status !== "disabled") report.problems.push(`${a.agent}: model ${m.id} not in "${a.list_models_cmd}" output — fix the id or set status: disabled`);
      report.agents.push(entry);
    }
    const root = gitRoot();
    const specify = spawnSync("sh", ["-c", "command -v specify"], { encoding: "utf8" });
    report.speckit = { cli: specify.status === 0 ? specify.stdout.trim() : null, project_initialized: !!(root && existsSync(join(root, ".specify"))) };
    if (!report.speckit.cli && !report.speckit.project_initialized) report.problems.push("speckit not found (optional): uv tool install specify-cli --from git+https://github.com/github/spec-kit.git ; then: specify init --here");
    if (args.json) print(report);
    else {
      const lines = [`node ${report.node} · profile ${report.profile} · on_exhaustion ${report.on_exhaustion}`, `config: ${sources.config} (${sources.configScope})`, `agents: ${sources.agents ?? "none"} (${sources.agentsScope ?? "-"})`, ""];
      for (const a of report.agents) {
        lines.push(`${a.enabled ? "●" : "○"} ${a.agent}  binary=${a.binary ? "ok" : "MISSING"}  relay=${a.relay ? "ok" : "MISSING"}`);
        for (const m of a.models) lines.push(`    ${m.available === true ? "✓" : m.available === false ? "✗" : "?"} ${m.id}  tier ${m.tier}  ${m.status}`);
      }
      lines.push("", `speckit: cli=${report.speckit.cli ? "ok" : "missing"} project=${report.speckit.project_initialized ? "initialized" : "not initialized"}`);
      lines.push("", report.problems.length ? "Problems:\n- " + report.problems.join("\n- ") : "No problems found.");
      process.stdout.write(lines.join("\n") + "\n");
    }
    process.exit(report.problems.some((p) => !p.includes("(optional)")) ? 1 : 0);
  }

  default:
    die(`unknown command: ${cmd}`);
}
