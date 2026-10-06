#!/usr/bin/env node
// Test double for a delegate-skills relay. Behaviour per model comes from
// $FAKE_OUTCOMES (JSON: { "<model id>": "completed" | "limited" | "failed" | "dirty-limited" }).
// Every invocation is appended to $FAKE_CALLS (JSON lines) so tests can assert the order.
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const get = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const model = get("--model");
const outDir = get("--out-dir");
const cd = get("--cd");
const outcomes = JSON.parse(process.env.FAKE_OUTCOMES ?? "{}");
const outcome = outcomes[model] ?? "completed";
if (process.env.FAKE_CALLS) appendFileSync(process.env.FAKE_CALLS, JSON.stringify({ model, argv }) + "\n");

mkdirSync(outDir, { recursive: true });
let result;
if (outcome === "completed") {
  writeFileSync(join(cd, `done-by-${model.replace(/[^a-z0-9]/gi, "_")}.txt`), "ok\n");
  result = { status: "completed", exitCode: 0, finalMessage: "implemented", touchedFiles: ["?? done.txt"], sessionId: "ses_fake" };
} else if (outcome === "limited" || outcome === "dirty-limited") {
  if (outcome === "dirty-limited") writeFileSync(join(cd, "partial.txt"), "half\n");
  result = { status: "failed", exitCode: 1, stderrTail: ["Error: 429 Too Many Requests: rate limit exceeded"], touchedFiles: [] };
} else if (outcome === "infra" || (outcome === "infra-once" && !existsSync(`${process.env.FAKE_CALLS}.infra.${model.replace(/\W/g, "_")}`))) {
  if (outcome === "infra-once") writeFileSync(`${process.env.FAKE_CALLS}.infra.${model.replace(/\W/g, "_")}`, "1");
  result = { status: "timeout", exitCode: 124, error: "opencode --version preflight timed out after 10000ms; OpenCode was not dispatched", touchedFiles: [] };
} else if (outcome === "infra-once") {
  writeFileSync(join(cd, `done-by-${model.replace(/[^a-z0-9]/gi, "_")}.txt`), "ok\n");
  result = { status: "completed", exitCode: 0, finalMessage: "implemented", touchedFiles: ["?? done.txt"], sessionId: "ses_fake" };
} else if (outcome === "unavailable") {
  result = { status: "fake_unavailable", exitCode: 127, error: "fake not found on PATH", touchedFiles: null };
} else {
  result = { status: "failed", exitCode: 1, stderrTail: ["TypeError: something broke"], touchedFiles: [] };
}
writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2));
process.exit(result.exitCode);
