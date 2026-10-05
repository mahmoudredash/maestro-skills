// Minimal, dependency-free YAML subset parser for Maestro config files.
//
// Supported: nested maps by indentation, block lists ("- item" and "- key: v"
// list-of-maps), inline lists ([a, b]), inline maps ({a: 1}), single/double
// quoted strings, numbers, booleans, null, and "#" comments.
// Not supported (by design): anchors, tags, multi-line scalars (| and >),
// multiple documents. Keep config files inside this subset.

export function parseYaml(text) {
  const lines = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const stripped = stripComment(raw);
    if (stripped.trim() === "") return;
    const indent = stripped.match(/^ */)[0].length;
    if (/^\t/.test(stripped.slice(indent))) throw new YamlError("tabs are not allowed for indentation", i + 1);
    lines.push({ indent, text: stripped.trim(), line: i + 1 });
  });
  if (lines.length === 0) return {};
  const [value, next] = parseBlock(lines, 0, lines[0].indent);
  if (next < lines.length) throw new YamlError("unexpected indentation", lines[next].line);
  return value;
}

export class YamlError extends Error {
  constructor(msg, line) {
    super(`YAML line ${line}: ${msg}`);
    this.line = line;
  }
}

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i).replace(/\s+$/, "");
  }
  return line.replace(/\s+$/, "");
}

function parseBlock(lines, start, indent) {
  return lines[start].text.startsWith("- ") || lines[start].text === "-"
    ? parseList(lines, start, indent)
    : parseMap(lines, start, indent);
}

function parseMap(lines, start, indent) {
  const obj = {};
  let i = start;
  while (i < lines.length && lines[i].indent === indent) {
    const { text, line } = lines[i];
    if (text.startsWith("- ")) throw new YamlError("list item where a key was expected", line);
    const kv = splitKey(text, line);
    i++;
    if (kv.rest === "") {
      if (i < lines.length && lines[i].indent > indent) {
        const [val, next] = parseBlock(lines, i, lines[i].indent);
        obj[kv.key] = val;
        i = next;
      } else if (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith("- ")) {
        // "key:" followed by a list at the same indent (common YAML style)
        const [val, next] = parseList(lines, i, indent);
        obj[kv.key] = val;
        i = next;
      } else {
        obj[kv.key] = null;
      }
    } else {
      obj[kv.key] = parseScalar(kv.rest, line);
    }
  }
  if (i < lines.length && lines[i].indent > indent) throw new YamlError("unexpected indentation", lines[i].line);
  return [obj, i];
}

function parseList(lines, start, indent) {
  const arr = [];
  let i = start;
  while (i < lines.length && lines[i].indent === indent && (lines[i].text.startsWith("- ") || lines[i].text === "-")) {
    const { text, line } = lines[i];
    const body = text === "-" ? "" : text.slice(2).trim();
    i++;
    if (body === "") {
      if (i < lines.length && lines[i].indent > indent) {
        const [val, next] = parseBlock(lines, i, lines[i].indent);
        arr.push(val);
        i = next;
      } else arr.push(null);
      continue;
    }
    if (isMapEntry(body)) {
      // "- key: value" starts a map whose other keys are indented to the key column.
      const itemIndent = indent + 2;
      const synthetic = [{ indent: itemIndent, text: body, line }];
      let j = i;
      while (j < lines.length && lines[j].indent >= itemIndent) {
        synthetic.push(lines[j]);
        j++;
      }
      const [val, next] = parseMap(synthetic, 0, itemIndent);
      if (next !== synthetic.length) throw new YamlError("bad indentation inside list item", synthetic[next].line);
      arr.push(val);
      i = j;
    } else {
      arr.push(parseScalar(body, line));
    }
  }
  return [arr, i];
}

function isMapEntry(text) {
  if (/^["'[{]/.test(text)) return false;
  return /^[^:]+:(\s|$)/.test(text);
}

function splitKey(text, line) {
  let key, rest;
  if (text[0] === '"' || text[0] === "'") {
    const end = text.indexOf(text[0], 1);
    if (end < 0) throw new YamlError("unterminated quoted key", line);
    key = text.slice(1, end);
    rest = text.slice(end + 1).trim();
    if (!rest.startsWith(":")) throw new YamlError("expected ':' after key", line);
    rest = rest.slice(1).trim();
  } else {
    const m = text.match(/^([^:]+):(?:\s+(.*))?$/);
    if (!m) throw new YamlError(`expected "key: value", got "${text}"`, line);
    key = m[1].trim();
    rest = (m[2] ?? "").trim();
  }
  return { key, rest };
}

function parseScalar(raw, line) {
  const s = raw.trim();
  if (s.startsWith("[")) return parseInlineList(s, line);
  if (s.startsWith("{")) return parseInlineMap(s, line);
  if (s.startsWith('"')) {
    if (!s.endsWith('"') || s.length < 2) throw new YamlError("unterminated string", line);
    return JSON.parse(s);
  }
  if (s.startsWith("'")) {
    if (!s.endsWith("'") || s.length < 2) throw new YamlError("unterminated string", line);
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s === "~" || s === "null") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+$/.test(s)) return Number.parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return Number.parseFloat(s);
  return s;
}

function splitTopLevel(inner) {
  const parts = [];
  let depth = 0, quote = null, cur = "";
  for (const c of inner) {
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
    if (c === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur.trim() !== "") parts.push(cur);
  return parts.map((p) => p.trim()).filter((p) => p !== "");
}

function parseInlineList(s, line) {
  if (!s.endsWith("]")) throw new YamlError("unterminated inline list", line);
  return splitTopLevel(s.slice(1, -1)).map((p) => parseScalar(p, line));
}

function parseInlineMap(s, line) {
  if (!s.endsWith("}")) throw new YamlError("unterminated inline map", line);
  const obj = {};
  for (const part of splitTopLevel(s.slice(1, -1))) {
    const { key, rest } = splitKey(part, line);
    obj[key] = rest === "" ? null : parseScalar(rest, line);
  }
  return obj;
}
