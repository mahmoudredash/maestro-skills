import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { normalizeAgent, loadConfig } from "../skills/maestro-router/scripts/lib/config.mjs";
import { rankCandidates } from "../skills/maestro-router/scripts/lib/route.mjs";
import { readLimits, markLimited, looksLimited } from "../skills/maestro-router/scripts/lib/limits.mjs";
import { dispatch, buildRelayArgs } from "../skills/maestro-router/scripts/lib/dispatch.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE_RELAY = join(HERE, "fixtures/relays/fake-relay.mjs");

const alpha = () =>
  normalizeAgent({
    agent: "alpha",
    delegate_skill: "alpha-delegate",
    priority: 1,
    relay_flags: { effort: "--variant" },
    effort_map: { medium: "", high: "high" },
    models: [
      { id: "zen/strong", provider: "zen", tier: 5, good_for: ["feature"], fallback_order: 1 },
      { id: "zen/mid", provider: "zen", tier: 3, good_for: ["feature", "tests"], fallback_order: 2 },
      { id: "zen/tiny", provider: "zen", tier: 1, good_for: ["mechanical"], avoid_for: ["migration"], fallback_order: 3 },
    ],
  });
const beta = () =>
  normalizeAgent({
    agent: "beta",
    delegate_skill: "beta-delegate",
    priority: 2,
    relay_flags: { provider: "--provider" },
    limit_scope: "model",
    models: [
      { id: "other-strong", relay_provider: "cloud", provider: "cloud", tier: 4, good_for: ["general"] },
      { id: "backup", provider: "cloud2", tier: 3, good_for: ["feature"], status: "standby" },
      { id: "off", provider: "cloud3", tier: 5, status: "disabled" },
    ],
  });
const routing = { sensitive_min_tier: 4, normal_min_tier: 1, reviewer_min_tier: 3, prefer_cheapest_sufficient: true };
const refs = (r) => r.candidates.map((c) => c.ref);

let stateDir;
beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "maestro-state-"));
  process.env.MAESTRO_STATE_DIR = stateDir;
});

test("normal work: best fit first, then cheapest sufficient tier; standby last; disabled never", () => {
  const r = rankCandidates([alpha(), beta()], { type: "feature", sensitivity: "normal", role: "implementer" }, { routing });
  assert.deepEqual(refs(r), ["alpha:zen/mid", "alpha:zen/strong", "beta:other-strong", "beta:backup"]);
  assert.ok(r.skipped.some((s) => s.ref === "beta:off" && s.why === "model disabled"));
  assert.ok(r.skipped.some((s) => s.ref === "alpha:zen/tiny" && /not good_for/.test(s.why)));
  const loose = rankCandidates([alpha()], { type: "feature", role: "implementer" }, { routing: { ...routing, allow_unfit_fallback: true } });
  assert.equal(refs(loose).at(-1), "alpha:zen/tiny");
});

test("sensitive work: strongest first and tier floor applied", () => {
  const r = rankCandidates([alpha(), beta()], { type: "feature", sensitivity: "sensitive", role: "implementer" }, { routing });
  assert.deepEqual(refs(r), ["alpha:zen/strong", "beta:other-strong"]);
});

test("avoid_for excludes; reviewer floor and cross-review exclusion apply", () => {
  const mig = rankCandidates([alpha()], { type: "migration", role: "implementer" }, { routing });
  assert.ok(!refs(mig).includes("alpha:zen/tiny"));
  const rev = rankCandidates([alpha(), beta()], { type: "feature", role: "reviewer", excludeProviders: ["zen"] }, { routing });
  assert.deepEqual(refs(rev), ["beta:other-strong", "beta:backup"]);
});

test("provider-scoped limit blocks every model of that provider, in every agent", () => {
  const a = alpha();
  markLimited(a, a.models[0], "429");
  const limits = readLimits();
  assert.ok(limits["provider:zen"]);
  const r = rankCandidates([a, beta()], { type: "feature", role: "implementer" }, { routing, limits });
  assert.deepEqual(refs(r), ["beta:other-strong", "beta:backup"]);
});

test("model-scoped limit only blocks that model", () => {
  const b = beta();
  markLimited(b, b.models[0], "daily limit");
  const r = rankCandidates([b], { type: "feature", role: "implementer" }, { routing, limits: readLimits() });
  assert.deepEqual(refs(r), ["beta:backup"]);
});

test("limit detection", () => {
  const a = alpha();
  assert.equal(looksLimited(a, { status: "failed", stderrTail: ["HTTP 429 Too Many Requests"] }), true);
  assert.equal(looksLimited(a, { status: "failed", stderrTail: ["TypeError"] }), false);
  assert.equal(looksLimited(a, { status: "completed", touchedFiles: [], finalMessage: "quota exceeded for today" }), true);
  assert.equal(looksLimited(a, { status: "completed", touchedFiles: ["M a.ts"], finalMessage: "fixed the quota display" }), false);
});

test("relay args: effort mapping, empty mapping omitted, provider flag", () => {
  const a = alpha();
  assert.deepEqual(buildRelayArgs({ agent: a, model: a.models[0], brief: "b", cd: "/r", outDir: "/o", effort: "high", readOnly: true, timeout: "30m" }), [
    "--brief", "b", "--cd", "/r", "--out-dir", "/o", "--model", "zen/strong", "--variant", "high", "--read-only", "--timeout", "30m",
  ]);
  const medium = buildRelayArgs({ agent: a, model: a.models[0], brief: "b", cd: "/r", outDir: "/o", effort: "medium" });
  assert.ok(!medium.includes("--variant"));
  const b = beta();
  const pargs = buildRelayArgs({ agent: b, model: b.models[0], brief: "b", cd: "/r", outDir: "/o" });
  assert.deepEqual(pargs.slice(6, 10), ["--model", "other-strong", "--provider", "cloud"]);
});

// ── dispatch, end to end with a fake relay ──

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "maestro-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: dir });
  return dir;
}

function run(outcomes, extra = {}, agents = [alpha(), beta()], configOver = {}) {
  const cd = repo();
  const calls = join(cd, "..", `calls-${Date.now()}-${Math.random()}.jsonl`);
  process.env.MAESTRO_FAKE_RELAY = FAKE_RELAY;
  process.env.FAKE_OUTCOMES = JSON.stringify(outcomes);
  process.env.FAKE_CALLS = calls;
  const brief = join(cd, "..", "card.md");
  writeFileSync(brief, "# card\n");
  const config = { routing, on_exhaustion: "ask", wait_and_retry: { max_wait_minutes: 1, max_cycles: 1 }, dispatch: { max_model_switches: 6 }, roles: { implementer: { effort: "medium" } }, ...configOver };
  const res = dispatch({ brief, cd, out: join(cd, "..", `out-${Math.random()}`), type: "feature", sensitivity: "normal", role: "implementer", config, agentsList: agents, log: () => {}, ...extra });
  const lines = existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { ...res, order: lines.map((l) => l.model), argvs: lines.map((l) => l.argv), cd };
}

test("dispatch: first candidate completes", () => {
  const r = run({});
  assert.equal(r.code, 0);
  assert.equal(r.summary.status, "completed");
  assert.equal(r.summary.model, "zen/mid");
  assert.deepEqual(r.order, ["zen/mid"]);
});

test("dispatch: limit on a provider skips its other models and moves to another provider", () => {
  const r = run({ "zen/mid": "limited" });
  assert.equal(r.summary.status, "completed");
  assert.deepEqual(r.order, ["zen/mid", "other-strong"]); // zen/strong skipped: same provider is cooling down
  assert.ok(readLimits()["provider:zen"]);
});

test("dispatch: hard failure tries the next model without marking a limit", () => {
  const r = run({ "zen/mid": "failed" });
  assert.deepEqual(r.order, ["zen/mid", "zen/strong"]);
  assert.equal(r.summary.status, "completed");
  assert.equal(readLimits()["provider:zen"], undefined);
});

test("dispatch: partial edits from a limited attempt are stashed before the next model runs", () => {
  const r = run({ "zen/mid": "dirty-limited" });
  assert.equal(r.summary.status, "completed");
  assert.ok(r.summary.attempts[0].stashed);
  const stash = execFileSync("git", ["stash", "list"], { cwd: r.cd }).toString();
  assert.match(stash, /maestro: partial attempt by alpha:zen\/mid/);
  assert.ok(!existsSync(join(r.cd, "partial.txt")));
});

test("dispatch: everything limited → exhausted with policy ask (default)", () => {
  const r = run({ "zen/mid": "limited", "other-strong": "limited", backup: "limited" });
  assert.equal(r.code, 4);
  assert.equal(r.summary.status, "exhausted");
  assert.equal(r.summary.policy, "ask");
  assert.ok(r.summary.retryAfter);
});

test("dispatch: refuses to start a write task on a dirty tree", () => {
  const cd = repo();
  writeFileSync(join(cd, "dirty.txt"), "x");
  process.env.MAESTRO_FAKE_RELAY = FAKE_RELAY;
  const brief = join(cd, "..", "card2.md");
  writeFileSync(brief, "# card\n");
  const res = dispatch({ brief, cd, out: join(cd, "..", "out-dirty"), type: "feature", config: { routing, roles: {} }, agentsList: [alpha()], log: () => {} });
  assert.equal(res.code, 5);
  assert.equal(res.summary.status, "stopped");
});

test("dispatch: dry run returns the chain without calling any relay", () => {
  const r = run({}, { dryRun: true });
  assert.equal(r.summary.status, "dry_run");
  assert.equal(r.order.length, 0);
  assert.equal(r.summary.chain[0].ref, "alpha:zen/mid");
});

test("shipped defaults load through loadConfig with the claude-led profile (core only, no packs)", () => {
  const noPacks = mkdtempSync(join(tmpdir(), "maestro-skills-root-"));
  const { config, agents } = loadConfig({ configDir: join(HERE, "..", "skills/maestro/defaults"), skillsRoot: noPacks });
  assert.equal(config.activeProfile, "claude-led");
  assert.equal(config.on_exhaustion, "ask");
  assert.equal(config.roles.leader.agent, "claude-code");
  assert.deepEqual(agents.map((a) => a.agent).sort(), ["commandcode", "opencode", "pi"]);
  const free = loadConfig({ configDir: join(HERE, "..", "skills/maestro/defaults"), profile: "free-only", skillsRoot: noPacks });
  assert.equal(free.config.roles.leader.agent, "opencode");
});

test("dispatch: a missing CLI skips all of that agent's models", () => {
  const r = run({ "zen/mid": "unavailable" });
  assert.equal(r.summary.status, "completed");
  assert.deepEqual(r.order, ["zen/mid", "other-strong"]);
  assert.equal(r.summary.attempts[0].outcome, "agent_unavailable");
});

test("dispatch: a resume session id is only sent to the pinned model", () => {
  const r = run({ "zen/mid": "limited" }, { pin: "alpha:zen/mid", session: "ses_123", allowDirty: true });
  assert.equal(r.summary.status, "completed");
  assert.deepEqual(r.order, ["zen/mid", "other-strong"]);
  assert.ok(r.argvs[0].includes("ses_123"));
  assert.ok(!r.argvs[1].includes("ses_123"));
});

test("dispatch: files in the .workflow state folder never count as a dirty tree and are never stashed", () => {
  const cd = repo();
  mkdirSync(join(cd, ".workflow", "001-x"), { recursive: true });
  writeFileSync(join(cd, ".workflow", "001-x", "status.md"), "state\n");
  process.env.MAESTRO_FAKE_RELAY = FAKE_RELAY;
  process.env.FAKE_OUTCOMES = JSON.stringify({ "zen/mid": "dirty-limited" });
  const brief = join(cd, ".workflow", "001-x", "card.md");
  writeFileSync(brief, "# card\n");
  const res = dispatch({ brief, cd, out: join(cd, ".workflow", "001-x", "logs"), type: "feature", config: { routing, roles: {}, state: { dir: ".workflow" } }, agentsList: [alpha(), beta()], log: () => {} });
  assert.equal(res.summary.status, "completed");
  assert.ok(existsSync(join(cd, ".workflow", "001-x", "status.md")), "state file must survive the stash");
  assert.ok(!existsSync(join(cd, "partial.txt")), "partial work must be stashed");
});

// ── on_exhaustion: wait_and_retry ──

const quick = (cooldown) => {
  const a = alpha();
  const b = beta();
  a.cooldown_minutes = cooldown;
  b.cooldown_minutes = cooldown;
  return [a, b];
};
// Every model limited, including zen/strong: with very short test cooldowns a slow runner can
// see the zen provider cooldown expire mid-run, so no model may be left "completed".
const allLimited = { "zen/mid": "limited", "zen/strong": "limited", "other-strong": "limited", backup: "limited" };

test("wait_and_retry (defer, default): returns retry_later at once with the next cycle", () => {
  const started = Date.now();
  const r = run(allLimited, {}, quick(2), { on_exhaustion: "wait_and_retry", wait_and_retry: { max_wait_minutes: 5, max_cycles: 2 } });
  assert.equal(r.code, 6);
  assert.equal(r.summary.status, "retry_later");
  assert.equal(r.summary.nextCycle, 1);
  assert.ok(r.summary.retryAfter);
  assert.ok(Date.now() - started < 5000, "defer mode must not sleep");
});

test("wait_and_retry: cycles used up → exhausted", () => {
  const r = run(allLimited, { cycle: 2 }, quick(2), { on_exhaustion: "wait_and_retry", wait_and_retry: { max_wait_minutes: 5, max_cycles: 2 } });
  assert.equal(r.code, 4);
  assert.equal(r.summary.status, "exhausted");
});

test("wait_and_retry: a wait longer than max_wait_minutes → exhausted", () => {
  const r = run(allLimited, {}, quick(60), { on_exhaustion: "wait_and_retry", wait_and_retry: { max_wait_minutes: 5, max_cycles: 2 } });
  assert.equal(r.summary.status, "exhausted");
});

test("wait_and_retry (inline): sleeps, retries the chain, then gives up after max_cycles", () => {
  const r = run(allLimited, {}, quick(0.01), { on_exhaustion: "wait_and_retry", wait_and_retry: { max_wait_minutes: 1, max_cycles: 1, mode: "inline" } });
  assert.equal(r.summary.status, "exhausted");
  assert.ok(r.order.filter((m) => m === "zen/mid").length === 2, `expected a second pass after the wait, got ${r.order}`);
});
