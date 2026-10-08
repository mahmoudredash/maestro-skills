#!/usr/bin/env node
// maestro-omniroute helper — zero dependencies (Node 18+).
//
//   omniroute.mjs preflight          exit 0 ok · 3 fallback-only (cost guard unverified) · 1 down
//   omniroute.mjs health             gateway liveness (GET /healthz)
//   omniroute.mjs check [--json]     health, model catalog vs the pack agent file, cost guard
//   omniroute.mjs attest-strict      record that you enabled the strict free policy yourself
//   omniroute.mjs setup [--dry-run]  configure OpenCode's "omniroute" provider (+ safe compression)
//
// Environment:
//   OMNIROUTE_BASE_URL        default http://localhost:20128
//   OMNIROUTE_API_KEY         default sk_omniroute (OmniRoute's placeholder when keys are not required)
//   OMNIROUTE_MANAGEMENT_KEY  optional; lets `check` read the server settings to verify the policy
//   OMNIROUTE_SETTINGS_PATH   default /api/settings
//   OMNIROUTE_REQUIRE_STRICT  "0" disables the cost guard (not recommended)
//   OPENCODE_CONFIG           default ~/.config/opencode/opencode.json
//   MAESTRO_STATE_DIR         default ~/.config/maestro/state

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseYaml } from "../../maestro-router/scripts/lib/yaml.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT_FILE = join(HERE, "..", "maestro-agents", "opencode-omniroute.yaml");
const BASE = (process.env.OMNIROUTE_BASE_URL || "http://localhost:20128").replace(/\/+$/, "").replace(/\/v1$/, "");
const API_KEY = process.env.OMNIROUTE_API_KEY || "sk_omniroute";
const MGMT_KEY = process.env.OMNIROUTE_MANAGEMENT_KEY || "";
const SETTINGS_PATH = process.env.OMNIROUTE_SETTINGS_PATH || "/api/settings";
const STATE_DIR = process.env.MAESTRO_STATE_DIR || join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "maestro", "state");
const STATE_FILE = join(STATE_DIR, "omniroute.json");
const GUARD_TTL_MS = 24 * 60 * 60 * 1000;
export const COMPRESSION_HEADER = "x-omniroute-compression";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (f) => rest.includes(f);

async function get(path, { auth, timeoutMs = 2500 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = auth ? { Authorization: `Bearer ${auth}` } : {};
    const res = await fetch(BASE + path, { headers, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { ok: res.ok, status: res.status, text, json };
  } catch (e) {
    return { ok: false, status: 0, text: "", json: null, error: e.name === "AbortError" ? `timeout after ${timeoutMs} ms` : e.message };
  } finally {
    clearTimeout(t);
  }
}

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeState(patch) {
  mkdirSync(STATE_DIR, { recursive: true });
  const next = { ...readState(), ...patch };
  writeFileSync(STATE_FILE, JSON.stringify(next, null, 2) + "\n");
  return next;
}

function findKey(obj, key, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 8) return undefined;
  if (Object.hasOwn(obj, key)) return obj[key];
  for (const v of Object.values(obj)) {
    const hit = findKey(v, key, depth + 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

async function health() {
  const r = await get("/healthz");
  const up = r.ok && !/stopping/i.test(r.text);
  return { up, status: r.status, detail: up ? "ok" : r.error || `HTTP ${r.status} ${r.text.slice(0, 120)}`.trim() };
}

/** Cost guard per decision D4: the strict free policy must be verified or attested. */
async function verifyCostGuard({ refresh = false } = {}) {
  const state = readState();
  const fresh = state.cost_guard && Date.now() - Date.parse(state.cost_guard.checkedAt ?? 0) < GUARD_TTL_MS;
  if (fresh && !refresh) return state.cost_guard;

  let guard = { status: "unverified", detail: "no management key; run `omniroute.mjs attest-strict` after enabling the strict free policy", checkedAt: new Date().toISOString() };
  if (MGMT_KEY) {
    const r = await get(SETTINGS_PATH, { auth: MGMT_KEY });
    const policy = r.ok ? findKey(r.json, "freeAccessPolicy") : undefined;
    if (policy === "strict") guard = { status: "verified", detail: `freeAccessPolicy=strict (${SETTINGS_PATH})`, checkedAt: guard.checkedAt };
    else if (r.ok) guard = { status: "not_strict", detail: `freeAccessPolicy=${policy ?? "unset"} — enable STRICT_ZERO_COST in OmniRoute settings`, checkedAt: guard.checkedAt };
    else guard.detail = `could not read ${SETTINGS_PATH}: ${r.error || `HTTP ${r.status}`}`;
  }
  // A manual attestation stands in for an unverifiable server, never for a server that says "not strict".
  if (guard.status === "unverified" && state.attested?.at) {
    guard = { status: "attested", detail: `attested by the user on ${state.attested.at}`, checkedAt: guard.checkedAt };
  }
  writeState({ cost_guard: guard });
  return guard;
}

function packModels() {
  const a = parseYaml(readFileSync(AGENT_FILE, "utf8"));
  return (a.models ?? []).map((m) => ({ id: String(m.id), name: String(m.id).replace(/^omniroute\//, ""), status: m.status ?? "active" }));
}

async function main() {
  switch (cmd) {
    case "preflight": {
      const h = await health();
      if (!h.up) {
        console.log(`omniroute down at ${BASE}: ${h.detail}`);
        process.exit(1);
      }
      if (process.env.OMNIROUTE_REQUIRE_STRICT === "0") {
        console.log("omniroute up (cost guard disabled by OMNIROUTE_REQUIRE_STRICT=0)");
        process.exit(0);
      }
      const g = await verifyCostGuard();
      if (g.status === "verified" || g.status === "attested") {
        console.log(`omniroute up · cost guard ${g.status}`);
        process.exit(0);
      }
      console.log(`omniroute up but cost guard ${g.status}: ${g.detail} — using it as fallback only`);
      process.exit(3);
    }

    case "health": {
      const h = await health();
      console.log(JSON.stringify({ base: BASE, ...h }));
      process.exit(h.up ? 0 : 1);
    }

    case "attest-strict": {
      const s = writeState({ attested: { at: new Date().toISOString(), note: "user confirmed freeAccessPolicy=strict in the OmniRoute dashboard" }, cost_guard: null });
      console.log(JSON.stringify({ attested: s.attested, stateFile: STATE_FILE }, null, 2));
      break;
    }

    case "check": {
      const report = { base: BASE, health: await health(), models: [], costGuard: null, problems: [] };
      if (!report.health.up) report.problems.push(`gateway not reachable at ${BASE}: ${report.health.detail} — start it with \`omniroute\` (npm i -g omniroute)`);
      else {
        const r = await get("/v1/models", { auth: API_KEY });
        const ids = new Set((r.json?.data ?? []).map((m) => String(m.id)));
        if (!r.ok) report.problems.push(`GET /v1/models failed: ${r.error || `HTTP ${r.status}`} (check OMNIROUTE_API_KEY)`);
        for (const m of packModels()) {
          const dynamic = m.name === "auto" || m.name.startsWith("auto/");
          const available = ids.has(m.name) ? true : dynamic ? "on-demand" : r.ok ? false : "unknown";
          report.models.push({ ...m, available });
          if (available === false && m.status !== "disabled") report.problems.push(`model ${m.name} is not in OmniRoute's catalog — fix the id or set status: disabled`);
        }
        report.costGuard = await verifyCostGuard({ refresh: true });
        if (!["verified", "attested"].includes(report.costGuard.status)) report.problems.push(`cost guard ${report.costGuard.status}: ${report.costGuard.detail}`);
      }
      if (flag("--json")) console.log(JSON.stringify(report, null, 2));
      else {
        console.log(`OmniRoute ${BASE}: ${report.health.up ? "up" : "DOWN"}`);
        for (const m of report.models) console.log(`  ${m.available === true ? "✓" : m.available === false ? "✗" : "~"} ${m.name}  (${m.status}${m.available === "on-demand" ? ", resolved on demand" : ""})`);
        if (report.costGuard) console.log(`cost guard: ${report.costGuard.status} — ${report.costGuard.detail}`);
        console.log(report.problems.length ? "Problems:\n- " + report.problems.join("\n- ") : "No problems found.");
      }
      process.exit(report.problems.length ? 1 : 0);
    }

    case "setup": {
      const dry = flag("--dry-run");
      const steps = [];
      const omni = spawnSync("sh", ["-c", "command -v omniroute"], { encoding: "utf8" });
      if (omni.status === 0) {
        const args = ["setup-opencode", "--remote", BASE, "--api-key", API_KEY, ...(dry ? ["--dry-run"] : [])];
        const r = spawnSync("omniroute", args, { encoding: "utf8" });
        steps.push({ step: `omniroute ${args.filter((a) => a !== API_KEY).join(" ")}`, exit: r.status, out: (r.stdout || r.stderr || "").trim().slice(-500) });
      } else steps.push({ step: "omniroute setup-opencode", skipped: "omniroute CLI not on PATH — creating the provider entry directly" });

      const file = process.env.OPENCODE_CONFIG || join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode", "opencode.json");
      let cfg = {};
      if (existsSync(file)) {
        try {
          cfg = JSON.parse(readFileSync(file, "utf8"));
        } catch {
          steps.push({ step: `patch ${file}`, skipped: "file has comments or is not plain JSON; add the snippet below by hand", snippet: providerSnippet() });
          console.log(JSON.stringify({ steps }, null, 2));
          process.exit(1);
        }
      }
      const next = applyProvider(cfg);
      if (dry) steps.push({ step: `patch ${file}`, dryRun: true, result: next.provider.omniroute });
      else {
        mkdirSync(dirname(file), { recursive: true });
        if (existsSync(file)) copyFileSync(file, `${file}.bak`);
        writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
        steps.push({ step: `patch ${file}`, written: true, backup: existsSync(`${file}.bak`) ? `${file}.bak` : null });
      }
      console.log(JSON.stringify({ steps, next: "run: omniroute.mjs check" }, null, 2));
      break;
    }

    default:
      console.log("usage: omniroute.mjs preflight | health | check [--json] | attest-strict | setup [--dry-run]");
      process.exit(cmd ? 2 : 0);
  }
}

function providerSnippet() {
  return applyProvider({}).provider.omniroute;
}

/** Ensures provider.omniroute exists with safe compression (D6) and the pack's models. */
export function applyProvider(cfg) {
  const next = structuredClone(cfg ?? {});
  next.$schema ??= "https://opencode.ai/config.json";
  next.provider ??= {};
  const p = (next.provider.omniroute ??= { npm: "@ai-sdk/openai-compatible", name: "OmniRoute", options: {} });
  p.options ??= {};
  p.options.baseURL ??= `${BASE}/v1`;
  p.options.apiKey ??= "{env:OMNIROUTE_API_KEY}";
  p.options.headers = { ...(p.options.headers ?? {}), [COMPRESSION_HEADER]: "safe" };
  p.models ??= {};
  for (const m of packModels()) if (m.status !== "disabled") p.models[m.name] ??= { name: m.name };
  return next;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`omniroute.mjs: ${e.message}`);
    process.exit(1);
  });
}
