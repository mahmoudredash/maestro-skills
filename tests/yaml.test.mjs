import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseYaml } from "../skills/maestro-router/scripts/lib/yaml.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("scalars, comments, quotes", () => {
  const y = parseYaml(`
a: 1          # comment
b: 2.5
c: true
d: null
e: "x # not a comment"
f: 'it''s'
g: plain text value
h: --model
i: 45m
`);
  assert.deepEqual(y, { a: 1, b: 2.5, c: true, d: null, e: "x # not a comment", f: "it's", g: "plain text value", h: "--model", i: "45m" });
});

test("nested maps and inline collections", () => {
  const y = parseYaml(`
outer:
  inner:
    k: v
  list: [a, "b c", 3]
  map: {low: minimal, medium: ""}
  empty: {}
`);
  assert.deepEqual(y, { outer: { inner: { k: "v" }, list: ["a", "b c", 3], map: { low: "minimal", medium: "" }, empty: {} } });
});

test("block lists of scalars and of maps, including ids with colons", () => {
  const y = parseYaml(`
topics:
  - money / pricing
  - auth
models:
  - id: ollama-cloud/gpt-oss:120b
    tier: 4
    good_for: [feature, review]
  - id: ling-3.1-flash:free
    nested:
      deep: yes
same_indent_list:
- one
- two
`);
  assert.deepEqual(y.topics, ["money / pricing", "auth"]);
  assert.equal(y.models[0].id, "ollama-cloud/gpt-oss:120b");
  assert.equal(y.models[0].tier, 4);
  assert.deepEqual(y.models[0].good_for, ["feature", "review"]);
  assert.equal(y.models[1].id, "ling-3.1-flash:free");
  assert.deepEqual(y.models[1].nested, { deep: "yes" });
  assert.deepEqual(y.same_indent_list, ["one", "two"]);
});

test("bad indentation is reported with a line number", () => {
  assert.throws(() => parseYaml("a:\n  b: 1\n    c: 2\n"), /line 3/);
});

test("every shipped default file parses", () => {
  const dir = join(ROOT, "skills/maestro/defaults");
  const files = ["config.yaml", ...readdirSync(join(dir, "agents")).map((f) => join("agents", f))];
  for (const f of files) assert.doesNotThrow(() => parseYaml(readFileSync(join(dir, f), "utf8")), f);
});

test("inline comments after booleans and list items are ignored", () => {
  const y = parseYaml(`
agent: commandcode
enabled: false   # disabled: project rule is OpenCode-only
models:
  - id: ling-3.1-flash:free   # free, no daily cap
    status: disabled          # not used here
`);
  assert.equal(y.enabled, false);
  assert.equal(y.models[0].id, "ling-3.1-flash:free");
  assert.equal(y.models[0].status, "disabled");
});
