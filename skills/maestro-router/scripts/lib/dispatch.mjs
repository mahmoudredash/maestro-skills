// Dispatches one brief (task card) to the best available free model through the
// matching delegate-skills relay, walking the fallback chain on usage limits.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { SKILLS_ROOT, gitRoot } from "./config.mjs";
import { readLimits, markLimited, looksLimited } from "./limits.mjs";
import { rankCandidates, earliestRecovery } from "./route.mjs";

export const EXIT = { OK: 0, USAGE: 2, FAILED: 3, EXHAUSTED: 4, STOPPED: 5 };

export function relaySearchDirs(cwd = process.cwd()) {
  const root = gitRoot(cwd);
  const h = homedir();
  return [
    process.env.MAESTRO_DELEGATE_DIR,
    SKILLS_ROOT,
    root && join(root, ".claude", "skills"),
    root && join(root, ".agents", "skills"),
    join(h, ".claude", "skills"),
    join(h, ".agents", "skills"),
    join(h, ".config", "opencode", "skills"),
    join(h, ".config", "agents", "skills"),
    join(h, ".pi", "agent", "skills"),
  ].filter(Boolean);
}

export function findRelay(skill, cwd) {
  if (process.env.MAESTRO_FAKE_RELAY) return process.env.MAESTRO_FAKE_RELAY;
  for (const dir of relaySearchDirs(cwd)) {
    const p = join(dir, skill, "scripts", "relay.mjs");
    if (existsSync(p)) return p;
  }
  return null;
}

export function buildRelayArgs({ agent, model, brief, cd, outDir, effort, readOnly, session, timeout }) {
  const f = agent.relay_flags;
  const args = ["--brief", brief, "--cd", cd, "--out-dir", outDir];
  if (f.model) args.push(f.model, model.id);
  if (f.provider && model.relay_provider) args.push(f.provider, model.relay_provider);
  if (f.effort && effort) {
    // effort_map translates low|medium|high|max to the agent's own vocabulary; "" means "omit".
    const v = Object.hasOwn(agent.effort_map, effort) ? agent.effort_map[effort] : effort;
    if (v) args.push(f.effort, String(v));
  }
  if (readOnly && f.read_only) args.push(f.read_only);
  if (f.timeout && timeout) args.push(f.timeout, timeout);
  if (session) args.push("--session", session);
  return args;
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

// The workflow state folder (cards, logs, status) lives in the repo but is not "work":
// exclude it from cleanliness checks and from stashing partial attempts.
function workPathspec(stateDir) {
  return ["--", ".", `:(exclude)${stateDir}`];
}

function porcelain(cwd, stateDir = ".workflow") {
  try {
    return git(cwd, ["status", "--porcelain", ...workPathspec(stateDir)]).trim();
  } catch {
    return null;
  }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * opts: { brief, cd, out, type, sensitivity, role, readOnly, excludeProviders, excludeModels,
 *         agents (filter), pin ("agent:model"), session, effort, wait (bool), dryRun, config, agentsList, log }
 */
export function dispatch(opts) {
  const { config, agentsList } = opts;
  const log = opts.log ?? ((m) => process.stderr.write(m + "\n"));
  const role = opts.role ?? "implementer";
  const roleCfg = config.roles?.[role] ?? {};
  const effort = opts.effort ?? roleCfg.effort ?? null;
  const cd = opts.cd ?? process.cwd();
  const stateDir = config.state?.dir ?? ".workflow";
  const out = opts.out;
  mkdirSync(out, { recursive: true });

  const task = {
    type: opts.type ?? "general",
    sensitivity: opts.sensitivity ?? "normal",
    role,
    excludeProviders: opts.excludeProviders ?? [],
    excludeModels: opts.excludeModels ?? [],
    agents: opts.agents?.length ? opts.agents : roleCfg.agents,
    minTier: roleCfg.min_tier,
  };
  const routing = config.routing ?? {};
  const maxSwitches = config.dispatch?.max_model_switches ?? 6;
  const policy = config.on_exhaustion ?? "ask";
  const war = config.wait_and_retry ?? {};
  const attempts = [];
  const unavailableAgents = new Set(); // CLI missing / relay missing: skip the agent's other models
  let cycles = 0;

  if (!opts.readOnly && !opts.dryRun && !opts.allowDirty) {
    const st = porcelain(cd, stateDir);
    if (st) {
      return finish(out, { status: "stopped", reason: "working tree is not clean; commit or stash before dispatching a write task", porcelain: st }, EXIT.STOPPED);
    }
  }

  for (;;) {
    const limits = readLimits();
    let { candidates, skipped, minTier } = rankCandidates(agentsList, task, { routing, limits });
    if (opts.pin) {
      const pinned = candidates.find((c) => c.ref === opts.pin || c.model.id === opts.pin);
      if (pinned) candidates = [pinned, ...candidates.filter((c) => c !== pinned)];
      else log(`maestro: pinned model ${opts.pin} is unavailable (disabled, limited or filtered); using the ranked chain`);
    }

    if (opts.dryRun) {
      return finish(out, {
        status: "dry_run",
        task,
        minTier,
        effort,
        chain: candidates.map((c, i) => ({
          rank: i + 1,
          ref: c.ref,
          provider: c.model.provider,
          tier: c.model.tier,
          fit: c.fit,
          standby: !!c.standby,
          relay: findRelay(c.agent.delegate_skill, cd),
          args: buildRelayArgs({ agent: c.agent, model: c.model, brief: opts.brief, cd, outDir: join(out, `attempt-${i + 1}`), effort, readOnly: opts.readOnly, session: opts.session, timeout: c.agent.timeout ?? config.dispatch?.default_timeout }),
        })),
        skipped,
      }, EXIT.OK);
    }

    if (!rankCandidates(agentsList, task, { routing, limits: {} }).candidates.length) {
      return finish(out, { status: "no_candidates", reason: "no enabled model satisfies this role/type/tier; check the agent files", skipped }, EXIT.STOPPED);
    }

    for (const c of candidates) {
      if (attempts.length >= maxSwitches) break;
      if (attempts.some((a) => a.ref === c.ref)) continue;
      if (unavailableAgents.has(c.agent.agent)) continue;
      const relay = findRelay(c.agent.delegate_skill, cd);
      if (!relay) {
        unavailableAgents.add(c.agent.agent);
        attempts.push({ ref: c.ref, outcome: "no_relay", detail: `${c.agent.delegate_skill} not installed (npx skills add amElnagdy/delegate-skills)` });
        continue;
      }
      const outDir = join(out, `attempt-${attempts.length + 1}`);
      mkdirSync(outDir, { recursive: true });
      // A session id belongs to one agent/model: only resume it on the pinned candidate.
      const isPinned = !!opts.pin && (c.ref === opts.pin || c.model.id === opts.pin);
      const session = opts.session && (isPinned || !opts.pin) ? opts.session : undefined;
      const args = buildRelayArgs({ agent: c.agent, model: c.model, brief: opts.brief, cd, outDir, effort, readOnly: opts.readOnly, session, timeout: c.agent.timeout ?? config.dispatch?.default_timeout });
      log(`maestro: dispatching to ${c.ref} (tier ${c.model.tier}, provider ${c.model.provider})`);
      const run = spawnSync(process.execPath, [relay, ...args], { cwd: cd, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
      writeFileSync(join(outDir, "relay.stdout.txt"), run.stdout ?? "");
      writeFileSync(join(outDir, "relay.stderr.txt"), run.stderr ?? "");
      const resultPath = join(outDir, "result.json");
      const result = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, "utf8")) : null;
      const entry = { ref: c.ref, agent: c.agent.agent, model: c.model.id, provider: c.model.provider, tier: c.model.tier, resultPath, status: result?.status ?? "no_result", exitCode: run.status };

      if (result && result.status === "completed" && !looksLimited(c.agent, result)) {
        attempts.push({ ...entry, outcome: "completed" });
        return finish(out, {
          status: "completed",
          agent: c.agent.agent,
          model: c.model.id,
          provider: c.model.provider,
          tier: c.model.tier,
          sessionId: result.sessionId ?? null,
          resultPath,
          touchedFiles: result.touchedFiles ?? null,
          finalMessage: result.finalMessage ?? "",
          attempts,
        }, EXIT.OK);
      }

      if (result && /_unavailable$/.test(result.status)) {
        unavailableAgents.add(c.agent.agent);
        attempts.push({ ...entry, outcome: "agent_unavailable", detail: String(result.error ?? result.stderrTail ?? "").slice(-400) });
        log(`maestro: ${c.agent.agent} CLI is not available; skipping its models`);
        continue;
      }

      const limited = looksLimited(c.agent, result ?? { status: "failed", stderrTail: run.stderr?.toString() });
      if (limited) {
        const m = markLimited(c.agent, c.model, (result?.stderrTail ?? result?.finalMessage ?? "limit") + "");
        attempts.push({ ...entry, outcome: "limited", limitedUntil: m.until, limitKey: m.key });
        log(`maestro: ${c.ref} hit a usage limit; cooling down until ${m.until}`);
      } else {
        attempts.push({ ...entry, outcome: "failed", detail: (result?.stderrTail ?? result?.error ?? run.stderr?.toString() ?? "").toString().slice(-1500) });
        log(`maestro: ${c.ref} failed (${entry.status}); trying the next model`);
      }

      // A write attempt that left partial edits must not leak into the next model's run.
      if (!opts.readOnly) {
        const st = porcelain(cd, stateDir);
        if (st) {
          try {
            git(cd, ["stash", "push", "--include-untracked", "-m", `maestro: partial attempt by ${c.ref}`, ...workPathspec(stateDir)]);
            attempts[attempts.length - 1].stashed = true;
            log(`maestro: stashed partial edits from ${c.ref} (git stash list)`);
          } catch (e) {
            return finish(out, { status: "stopped", reason: `could not stash partial edits from ${c.ref}: ${e.message}`, attempts }, EXIT.STOPPED);
          }
        }
      }
      // Limits may have changed (provider-wide); re-rank on the next outer pass.
      if (limited) break;
    }

    // Re-rank after a limit: other models of the same provider are now filtered out.
    const limitsNow = readLimits();
    const remaining = rankCandidates(agentsList, task, { routing, limits: limitsNow }).candidates
      .filter((c) => !attempts.some((a) => a.ref === c.ref) && !unavailableAgents.has(c.agent.agent));
    if (remaining.length && attempts.length < maxSwitches) continue;

    const retryAfter = earliestRecovery(agentsList, task, { routing, limits: limitsNow });
    const allFailedHard = attempts.length > 0 && attempts.every((a) => ["failed", "no_relay", "agent_unavailable"].includes(a.outcome));

    if (allFailedHard) {
      return finish(out, { status: "failed", reason: "every candidate failed for non-limit reasons", attempts }, EXIT.FAILED);
    }
    if (policy === "wait_and_retry" && opts.wait !== false && retryAfter && cycles < (war.max_cycles ?? 3)) {
      const waitMs = Date.parse(retryAfter) - Date.now() + 5_000;
      if (waitMs <= (war.max_wait_minutes ?? 120) * 60_000) {
        cycles++;
        log(`maestro: all candidates limited; waiting ${Math.ceil(waitMs / 60000)} min (cycle ${cycles}) per on_exhaustion=wait_and_retry`);
        sleep(Math.max(0, waitMs));
        attempts.length = 0;
        continue;
      }
    }
    return finish(out, {
      status: "exhausted",
      policy,
      action: policy === "ask" ? "STOP and ask the user how to proceed" : "wait limit exceeded; STOP and ask the user",
      retryAfter,
      attempts,
      skipped: rankCandidates(agentsList, task, { routing, limits: limitsNow }).skipped,
    }, EXIT.EXHAUSTED);
  }
}

function finish(out, summary, code) {
  const body = { schema: "maestro.dispatch.v1", ...summary, finishedAt: new Date().toISOString() };
  writeFileSync(join(out, "dispatch.json"), JSON.stringify(body, null, 2) + "\n");
  return { code, summary: body };
}
