// maestro-omniroute pack: preflight, cost guard, catalog check and OpenCode setup,
// exercised against a fake OmniRoute server.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "../skills/maestro-omniroute/scripts/omniroute.mjs");

const server = { health: 200, settings: { freeAccessPolicy: "strict" }, models: ["auto/coding:free", "auto/fast"] };
let base;
let srv;

before(async () => {
  srv = createServer((req, res) => {
    const json = (code, body) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/healthz") return server.health === 200 ? json(200, { status: "ok" }) : json(server.health, { status: "stopping" });
    if (req.url === "/v1/models") return json(200, { data: server.models.map((id) => ({ id })) });
    if (req.url === "/api/settings") {
      if (req.headers.authorization !== "Bearer mgmt") return json(401, { error: "unauthorized" });
      return json(200, { settings: server.settings });
    }
    json(404, {});
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => srv.close());

async function cli(args, env = {}) {
  try {
    const { stdout } = await exec(process.execPath, [SCRIPT, ...args], { env: { ...process.env, OMNIROUTE_BASE_URL: base, ...env } });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.code, out: `${e.stdout}${e.stderr}` };
  }
}
const freshState = () => ({ MAESTRO_STATE_DIR: mkdtempSync(join(tmpdir(), "omni-state-")) });

test("preflight: gateway unreachable → exit 1 (agent skipped)", async () => {
  const r = await cli(["preflight"], { ...freshState(), OMNIROUTE_BASE_URL: "http://127.0.0.1:9" });
  assert.equal(r.code, 1);
  assert.match(r.out, /down/);
});

test("preflight: up but cost guard unverified → exit 3 (fallback only)", async () => {
  const r = await cli(["preflight"], freshState());
  assert.equal(r.code, 3);
  assert.match(r.out, /unverified/);
});

test("preflight: attested by the user → exit 0", async () => {
  const st = freshState();
  assert.equal((await cli(["attest-strict"], st)).code, 0);
  assert.equal((await cli(["preflight"], st)).code, 0);
});

test("preflight: management key confirms strict policy → exit 0", async () => {
  server.settings = { freeAccessPolicy: "strict" };
  const r = await cli(["preflight"], { ...freshState(), OMNIROUTE_MANAGEMENT_KEY: "mgmt" });
  assert.equal(r.code, 0);
  assert.match(r.out, /verified/);
});

test("preflight: server says the policy is not strict → exit 3 even after an attestation", async () => {
  server.settings = { freeAccessPolicy: "off" };
  const st = freshState();
  await cli(["attest-strict"], st);
  const r = await cli(["preflight"], { ...st, OMNIROUTE_MANAGEMENT_KEY: "mgmt" });
  assert.equal(r.code, 3);
  assert.match(r.out, /not_strict/);
  server.settings = { freeAccessPolicy: "strict" };
});

test("preflight: OMNIROUTE_REQUIRE_STRICT=0 skips the cost guard", async () => {
  assert.equal((await cli(["preflight"], { ...freshState(), OMNIROUTE_REQUIRE_STRICT: "0" })).code, 0);
});

test("check: reports the catalog; auto combos resolve on demand", async () => {
  const r = await cli(["check", "--json"], { ...freshState(), OMNIROUTE_MANAGEMENT_KEY: "mgmt" });
  const report = JSON.parse(r.out);
  assert.equal(report.health.up, true);
  const byName = Object.fromEntries(report.models.map((m) => [m.name, m.available]));
  assert.equal(byName["auto/coding:free"], true);
  assert.equal(byName["auto/offline"], "on-demand");
  assert.equal(report.costGuard.status, "verified");
  assert.equal(r.code, 0, report.problems.join("; "));
});

test("setup: adds the omniroute provider with safe compression and keeps other providers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "opencode-"));
  const file = join(dir, "opencode.json");
  writeFileSync(file, JSON.stringify({ provider: { other: { name: "Other" } }, model: "other/x" }));
  const env = { OPENCODE_CONFIG: file, PATH: "/usr/bin:/bin" }; // no omniroute CLI on PATH

  const dry = JSON.parse((await cli(["setup", "--dry-run"], env)).out);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).provider.omniroute, undefined, "dry run writes nothing");
  assert.equal(dry.steps.at(-1).result.options.headers["x-omniroute-compression"], "safe");

  assert.equal((await cli(["setup"], env)).code, 0);
  const cfg = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(cfg.provider.other.name, "Other");
  assert.equal(cfg.model, "other/x");
  const p = cfg.provider.omniroute;
  assert.equal(p.options.baseURL, `${base}/v1`);
  assert.equal(p.options.apiKey, "{env:OMNIROUTE_API_KEY}", "no secret written to disk");
  assert.equal(p.options.headers["x-omniroute-compression"], "safe");
  assert.ok(p.models["auto/coding:free"] && p.models["auto/offline"]);
  assert.ok(!p.models["gemini/gemini-2.5-pro"], "disabled models are not added");
  assert.ok(existsSync(`${file}.bak`));
});

test("setup: a config with comments is left untouched and a snippet is printed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "opencode-"));
  const file = join(dir, "opencode.json");
  writeFileSync(file, '{ // comment\n "provider": {} }');
  const r = await cli(["setup"], { OPENCODE_CONFIG: file, PATH: "/usr/bin:/bin" });
  assert.equal(r.code, 1);
  assert.match(r.out, /snippet/);
  assert.equal(readFileSync(file, "utf8"), '{ // comment\n "provider": {} }');
});
