// `doctor --fix`: sets `status: disabled` on models an agent's CLI does not list.
// Line-based on purpose: it keeps the user's comments and layout, and touches only the
// `status:` line of each affected model block (or inserts one after its `- id:` line).

import { readFileSync, writeFileSync } from "node:fs";

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Returns the new file text and the ids actually changed. */
export function disableModelsInText(text, ids, reason) {
  const lines = text.split("\n");
  const changed = [];
  for (const id of ids) {
    const idRe = new RegExp(`^(\\s*)- id:\\s*["']?${escape(id)}["']?\\s*(#.*)?$`);
    const start = lines.findIndex((l) => idRe.test(l));
    if (start < 0) continue;
    const dashIndent = lines[start].match(/^\s*/)[0].length;
    const keyIndent = " ".repeat(dashIndent + 2);
    let end = start + 1;
    while (end < lines.length) {
      const l = lines[end];
      if (l.trim() === "" || l.trim().startsWith("#")) {
        // Blank/comment lines belong to the block only if a deeper-indented key follows.
        const next = lines.slice(end + 1).find((x) => x.trim() !== "" && !x.trim().startsWith("#"));
        if (!next || next.match(/^\s*/)[0].length <= dashIndent) break;
        end++;
        continue;
      }
      if (l.match(/^\s*/)[0].length <= dashIndent) break;
      end++;
    }
    const note = `# disabled by doctor --fix: ${reason}`;
    const statusAt = lines.slice(start + 1, end).findIndex((l) => /^\s*status:/.test(l));
    if (statusAt >= 0) {
      const i = start + 1 + statusAt;
      if (/^\s*status:\s*disabled\b/.test(lines[i])) continue;
      lines[i] = `${lines[i].match(/^\s*/)[0]}status: disabled  ${note}`;
    } else {
      lines.splice(start + 1, 0, `${keyIndent}status: disabled  ${note}`);
    }
    changed.push(id);
  }
  return { text: lines.join("\n"), changed };
}

export function disableModelsInFile(file, ids, reason) {
  const { text, changed } = disableModelsInText(readFileSync(file, "utf8"), ids, reason);
  if (changed.length) writeFileSync(file, text);
  return changed;
}
