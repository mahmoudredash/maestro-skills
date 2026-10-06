// Core mechanisms that extension packs rely on: pack agent discovery, per-model role and
// sensitivity limits, and the per-agent preflight hook.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig, loadPackAgents, normalizeAgent } from "../skills/maestro-router/scripts/lib/config.mjs";
import { rankCandidates } from "../skills/maestro-router/scripts/lib/route.mjs";
import { readLimits } from "../skills/maestro-router/scripts/lib/limits.mjs";
import { dispatch, runPreflight } from "../skills/maestro-router/scripts/lib/dispatch.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const FAKE_RELAY = join(HERE, "fixtures/relays/fake-relay.mjs");
const routing = { sensitive_min_tier: 4, normal_min_tier: 1, reviewer_min_tier: 3 };
const refs = (r) => r.candidates.map((c) => c.ref);

beforeEach(() => {
  process.env.MAESTRO_STATE_DIR = mkdtempSync(join(tmpdir(), "maestro-state-"));
});

const direct = () =>
  normalizeAgent({
    agent: "direct",
    delegate_skill: "d-delegate",
    priority: 1,
    models: [{ id: "d/strong", provider: "dp", tier: 4, good_for: ["feature", "review"] }],
  });
const gateway = (preflight) =>
  normalizeAgent({
    agent: "gw",
    delegate_skill: "g-delegate",
    priority: 2,
    preflight,
    models: [
      { id: "gw/auto", provider: "gw", tier: 4, good_for: ["feature"], roles: ["implementer"], sensitive_ok: false },
      { id: "gw/pinned", provider: "gp", tier: 4, good_for: ["feature", "review"] },
    ],
  });

test("pack agents are discovered next to the core, can be overridden, and can be disabled", () => {
  const root = mkdtempSync(join(tmpdir(), "skills-root-"));
  mkdirSync(join(root, "my-pack", "maestro-agents"), { recursive: true });
  writeFileSync(join(root, "my-pack", "maestro-agents", "x.yaml"), "agent: packed\ndelegate_skill: opencode-delegate\nmodels:\n  - id: p/m\n");
  mkdirSync(join(root, "plain-skill"), { recursive: true });
  const found = loadPackAgents(root);
  assert.deepEqual(found.names, ["my-pack"]);
  assert.equal(found.agents[0].pack, "my-pack");
  assert.equal(loadPackAgents(root, ["my-pack"]).agents.length, 0);

  const cfgDir = mkdtempSync(join(tmpdir(), "cfg-"));
  mkdirSync(join(cfgDir, "agents"));
  writeFileSync(join(cfgDir, "agents", "packed.yaml"), "agent: packed\ndelegate_skill: opencode-delegate\nmodels:\n  - id: mine/override\n");
  const { agents, sources } = loadConfig({ configDir: cfgDir, skillsRoot: root });
  assert.equal(agents.filter((a) => a.agent === "packed").length, 1);
  assert.equal(agents.find((a) => a.agent === "packed").models[0].id, "mine/override", "config dir wins over the pack");
  assert.deepEqual(sources.packs, ["my-pack"]);
});

test("the OmniRoute pack shipped in this repo is discovered", () => {
  const { agents, sources } = loadConfig({ configDir: join(ROOT, "skills/maestro/defaults") });
  assert.ok(sources.packs.includes("maestro-omniroute"));
  const gw = agents.find((a) => a.agent === "opencode-omniroute");
  assert.ok(gw.preflight.cmd.includes("omniroute.mjs preflight"));
});

test("roles and sensitive_ok restrict where a model may be used (D3)", () => {
  const agents = [direct(), gateway()];
  assert.deepEqual(refs(rankCandidates(agents, { type: "feature", role: "implementer" }, { routing })).sort(), ["direct:d/strong", "gw:gw/auto", "gw:gw/pinned"]);
  assert.deepEqual(refs(rankCandidates(agents, { type: "feature", role: "implementer", sensitivity: "sensitive" }, { routing })).sort(), ["direct:d/strong", "gw:gw/pinned"]);
  assert.deepEqual(refs(rankCandidates(agents, { type: "review", role: "reviewer" }, { routing })).sort(), ["direct:d/strong", "gw:gw/pinned"]);
});

test("runPreflight maps exit codes to ok / standby / down", () => {
  assert.equal(runPreflight(gateway({ cmd: "exit 0" })).state, "ok");
  assert.equal(runPreflight(gateway({ cmd: "echo fallback; exit 3" })).state, "standby");
  const down = runPreflight(gateway({ cmd: "echo gateway unreachable; exit 1" }));
  assert.equal(down.state, "down");
  assert.match(down.detail, /unreachable/);
  assert.equal(runPreflight(gateway({ cmd: "sleep 5", timeout_seconds: 1 })).state, "down");
});

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "maestro-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: dir });
  return dir;
}

function run(agents, outcomes = {}, extra = {}) {
  const cd = repo();
  const calls = join(cd, "..", `calls-${Math.random()}.jsonl`);
  process.env.MAESTRO_FAKE_RELAY = FAKE_RELAY;
  process.env.FAKE_OUTCOMES = JSON.stringify(outcomes);
  process.env.FAKE_CALLS = calls;
  const brief = join(cd, "..", `card-${Math.random()}.md`);
  writeFileSync(brief, "# card\n");
  const res = dispatch({ brief, cd, out: join(cd, "..", `out-${Math.random()}`), type: "feature", role: "implementer", config: { routing, roles: {} }, agentsList: agents, log: () => {}, ...extra });
  const order = existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).model) : [];
  return { ...res, order };
}

test("preflight down: the agent is skipped without starting a relay, and cooled down (D5)", () => {
  const r = run([gateway({ cmd: "exit 1", cooldown_minutes: 10 }), direct()], { "d/strong": "limited" });
  assert.deepEqual(r.order, ["d/strong"], "no relay was started for the gateway");
  assert.ok(readLimits()["agent:gw"], "agent-level cooldown recorded");
  const ranked = rankCandidates([gateway({ cmd: "exit 1" })], { type: "feature", role: "implementer" }, { routing, limits: readLimits() });
  assert.equal(ranked.candidates.length, 0);
});

test("preflight standby: the agent's models are tried only after the others (D4)", () => {
  // Without the preflight this agent would rank first (priority 0, same tier and fit).
  const preferGw = normalizeAgent({ agent: "gw", delegate_skill: "g-delegate", priority: 0, preflight: { cmd: "exit 3" }, models: [{ id: "gw/auto", provider: "gw", tier: 4, good_for: ["feature"] }] });
  const r = run([preferGw, direct()], { "d/strong": "limited" });
  assert.deepEqual(r.order, ["d/strong", "gw/auto"]);
  assert.equal(r.summary.status, "completed");
  assert.equal(r.summary.preflight.gw.state, "standby");
});

test("preflight ok: normal ranking, result reports the preflight", () => {
  const r = run([gateway({ cmd: "exit 0" }), direct()]);
  assert.equal(r.summary.status, "completed");
  assert.equal(r.summary.preflight.gw.state, "ok");
});

test("dry run shows preflight results without recording cooldowns", () => {
  const r = run([gateway({ cmd: "exit 1" }), direct()], {}, { dryRun: true });
  assert.equal(r.summary.preflight.gw.state, "down");
  assert.ok(!r.summary.chain.some((c) => c.ref.startsWith("gw:")));
  assert.equal(readLimits()["agent:gw"], undefined);
});

test("preflight placeholders are quoted, so paths with spaces work", () => {
  const pf = runPreflight(gateway({ cmd: "test -d {skills_root} && {node} -e \"process.exit(0)\"" }));
  assert.equal(pf.state, "ok", pf.detail);
});
