import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { disableModelsInText } from "../skills/maestro-router/scripts/lib/fix-models.mjs";
import { parseYaml } from "../skills/maestro-router/scripts/lib/yaml.mjs";

const MAESTRO = join(dirname(fileURLToPath(import.meta.url)), "../skills/maestro-router/scripts/maestro.mjs");

const SAMPLE = `agent: opencode   # my agent
models:
  - id: opencode/big-pickle
    tier: 4
    status: active

  - id: opencode/ghost-free   # vanished
    tier: 3
    # comment inside the block
    good_for: [feature]

  - id: opencode/old-free
    status: standby
`;

test("disables only the listed models, keeps comments and layout", () => {
  const { text, changed } = disableModelsInText(SAMPLE, ["opencode/ghost-free", "opencode/old-free", "opencode/not-in-file"], "gone");
  assert.deepEqual(changed, ["opencode/ghost-free", "opencode/old-free"]);
  const y = parseYaml(text);
  assert.equal(y.models[0].status, "active");
  assert.equal(y.models[1].status, "disabled");
  assert.deepEqual(y.models[1].good_for, ["feature"]);
  assert.equal(y.models[2].status, "disabled");
  assert.match(text, /# vanished/);
  assert.match(text, /# comment inside the block/);
  assert.match(text, /# my agent/);
});

test("is idempotent", () => {
  const once = disableModelsInText(SAMPLE, ["opencode/old-free"], "gone").text;
  const twice = disableModelsInText(once, ["opencode/old-free"], "gone");
  assert.deepEqual(twice.changed, []);
  assert.equal(twice.text, once);
});

test("doctor --fix edits the project's agent files, not the shipped defaults", () => {
  const repo = mkdtempSync(join(tmpdir(), "fix-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  mkdirSync(join(repo, ".maestro", "agents"), { recursive: true });
  writeFileSync(join(repo, ".maestro", "config.yaml"), "profile: claude-led\nprofiles:\n  claude-led:\n    roles: {}\n");
  writeFileSync(join(repo, ".maestro", "agents", "opencode.yaml"), `agent: opencode\ndelegate_skill: opencode-delegate\nbinary: fakecode\nlist_models_cmd: "fakecode models"\n${SAMPLE.split("\n").slice(1).join("\n")}`);
  const bin = mkdtempSync(join(tmpdir(), "fix-bin-"));
  writeFileSync(join(bin, "fakecode"), "#!/bin/sh\necho opencode/big-pickle\n");
  chmodSync(join(bin, "fakecode"), 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, MAESTRO_STATE_DIR: mkdtempSync(join(tmpdir(), "st-")) };
  try {
    execFileSync(process.execPath, [MAESTRO, "doctor", "--fix"], { cwd: repo, env, stdio: "pipe" });
  } catch {}
  const y = parseYaml(readFileSync(join(repo, ".maestro", "agents", "opencode.yaml"), "utf8"));
  assert.deepEqual(y.models.map((m) => m.status), ["active", "disabled", "disabled"]);
});
