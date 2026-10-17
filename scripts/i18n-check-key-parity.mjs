#!/usr/bin/env node
// i18n key-parity gate for language registration — Refs #6597.
//
// A language registered in frontend/src/i18n/languages.js must have exactly the
// same key set as `en` in every namespace (0 missing, 0 extra), and every
// message must carry the same ICU placeholders, plural forms and HTML tags as
// its `en` source. Complements (does not replace):
//   - i18n-check-keys.mjs        symmetric key coverage across all languages
//   - i18n-check-icu-braces.mjs  `{{x}}` antipattern
// What only this gate adds: placeholder / plural / tag parity per message, and
// a blocking-vs-advisory split per language.
//
// Severity:
//   - Languages in ADVISORY_LANGS (already live before the gate existed) only
//     warn, so existing debt does not block unrelated PRs.
//   - Every other registered language is BLOCKING (exit 1).
//   - Locale folders that are not registered yet are reported as info only
//     (work in progress), and the pseudo-locale `en-XA` is exempt.
//   - `--strict` makes advisory languages blocking too.
//
// Plural rules: CLDR categories differ per language, so a target must contain
// every plural category `en` uses (plus `other`); extra categories are fine.
// Select arms must match exactly. i18next suffix keys (`key_one`, `key_other`)
// are grouped under their base key with the same superset rule.
//
// Usage:
//   node scripts/i18n-check-key-parity.mjs [--strict] [--root <dir>]

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const SOURCE_LANG = "en";
export const PSEUDO_LANG = "en-XA";
export const ADVISORY_LANGS = ["da"];
export const PLACEHOLDER = "__MISSING__";
const PLURAL_SUFFIX_RE = /_(zero|one|two|few|many|other)$/;
const ICU_TYPES_WITH_ARMS = new Set(["plural", "select", "selectordinal"]);

// ---------------------------------------------------------------- ICU parsing

// Returns { args:Set<"name|type">, arms:Map<"name|type", Set<selector>>, tags:string[] }
export function analyzeMessage(message) {
  // `unbalanced`: an argument or arm is still open at end of message (#6597
  // Codex): intl-messageformat cannot render it, so parity must not pass.
  const result = { args: new Set(), arms: new Map(), tags: [], unbalanced: false };
  const s = String(message);
  let i = 0;

  function skipWs() {
    while (i < s.length && /\s/.test(s[i])) i++;
  }

  // Parse message text until an unmatched `}` (depth>0) or end. `scope` is the
  // enclosing plural name so `#` can be counted as a reference to it.
  function parseText(scope, nested) {
    let literal = "";
    const flushTags = () => {
      for (const m of literal.matchAll(/<\s*(\/?)\s*([a-zA-Z][\w-]*)[^<>]*?(\/?)\s*>/g)) {
        const kind = m[1] ? "close" : m[3] ? "self" : "open";
        result.tags.push(`${kind}:${m[2].toLowerCase()}`);
      }
      literal = "";
    };
    while (i < s.length) {
      const c = s[i];
      if (c === "'") {
        if (s[i + 1] === "'") { literal += "'"; i += 2; continue; }
        if (s[i + 1] === "{" || s[i + 1] === "}") {
          i++;
          while (i < s.length && s[i] !== "'") i++;
          i++;
          continue;
        }
        literal += c; i++; continue;
      }
      if (c === "{") {
        flushTags();
        i++;
        parseArgument(scope);
        continue;
      }
      if (c === "}") {
        if (nested) { flushTags(); return; }
        literal += c; i++; continue;
      }
      if (c === "#" && scope) {
        result.args.add(`${scope}|simple`);
        i++;
        continue;
      }
      literal += c;
      i++;
    }
    if (nested) result.unbalanced = true;
    flushTags();
  }

  function parseArgument(scope) {
    skipWs();
    let name = "";
    while (i < s.length && !/[,}\s]/.test(s[i])) name += s[i++];
    skipWs();
    if (s[i] === "}") { i++; result.args.add(`${name}|simple`); return; }
    if (s[i] !== ",") { if (i >= s.length) result.unbalanced = true; return; }
    i++;
    skipWs();
    let type = "";
    while (i < s.length && !/[,}\s]/.test(s[i])) type += s[i++];
    skipWs();
    const id = `${name}|${type}`;
    result.args.add(id);
    if (!ICU_TYPES_WITH_ARMS.has(type)) {
      // number/date/time: skip style up to the closing brace
      let depth = 1;
      while (i < s.length && depth > 0) {
        if (s[i] === "{") depth++;
        else if (s[i] === "}") depth--;
        i++;
      }
      if (depth > 0) result.unbalanced = true;
      return;
    }
    if (s[i] === ",") i++;
    skipWs();
    const arms = new Set();
    result.arms.set(id, arms);
    const off = s.slice(i).match(/^offset\s*:\s*\d+/);
    if (off) { i += off[0].length; skipWs(); }
    while (i < s.length && s[i] !== "}") {
      let selector = "";
      while (i < s.length && !/[{\s}]/.test(s[i])) selector += s[i++];
      skipWs();
      if (s[i] !== "{") break;
      i++;
      arms.add(selector);
      parseText(type === "select" ? scope : name, true);
      if (s[i] === "}") i++;
      skipWs();
    }
    if (s[i] === "}") i++;
    else result.unbalanced = true;
  }

  parseText(null, false);
  // Distinct tags only: an extra plural arm may legitimately repeat markup.
  result.tags = [...new Set(result.tags)].sort();
  return result;
}

// Compare one target message to its en source. Returns list of problem strings.
export function compareMessages(source, target) {
  const problems = [];
  const a = analyzeMessage(source);
  const b = analyzeMessage(target);
  if (b.unbalanced && !a.unbalanced) problems.push("ICU syntax: unbalanced braces (unterminated argument)");

  const lost = [...a.args].filter((x) => !b.args.has(x));
  const extra = [...b.args].filter((x) => !a.args.has(x));
  for (const x of lost) problems.push(`placeholder ${fmtArg(x)} missing`);
  for (const x of extra) problems.push(`placeholder ${fmtArg(x)} not in en`);

  for (const [id, srcArms] of a.arms) {
    const tgtArms = b.arms.get(id);
    if (!tgtArms) continue; // already reported as a missing placeholder
    const isSelect = id.endsWith("|select");
    const missing = [...srcArms].filter((arm) => !tgtArms.has(arm) && (isSelect || !arm.startsWith("=")));
    if (!isSelect && !tgtArms.has("other")) missing.push("other");
    for (const arm of new Set(missing)) problems.push(`${fmtArg(id)} form "${arm}" missing`);
    if (isSelect) {
      for (const arm of tgtArms) if (!srcArms.has(arm)) problems.push(`${fmtArg(id)} form "${arm}" not in en`);
    }
  }

  if (a.tags.join(",") !== b.tags.join(",")) {
    problems.push(`HTML tags differ (en: [${a.tags.join(" ")}] vs [${b.tags.join(" ")}])`);
  }
  return problems;
}

function fmtArg(id) {
  const [name, type] = id.split("|");
  return type === "simple" ? `{${name}}` : `{${name}, ${type}}`;
}

// ---------------------------------------------------------------- flattening

// Flatten to Map<path, string>. Arrays get [i] indices. i18next plural-suffix
// keys are kept as-is here; groupPlurals() handles them.
export function flattenMessages(obj, prefix = "", out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    flattenValue(v, key, out);
  }
  return out;
}
function flattenValue(v, key, out) {
  if (Array.isArray(v)) {
    v.forEach((item, idx) => flattenValue(item, `${key}[${idx}]`, out));
  } else if (v !== null && typeof v === "object") {
    flattenMessages(v, key, out);
  } else {
    out.set(key, v);
  }
}

// Collapse `foo_one`/`foo_other` into base key `foo` with categories.
function groupPlurals(flat) {
  const candidates = new Map(); // base -> Map<category, value>
  for (const [key, value] of flat) {
    const m = key.match(PLURAL_SUFFIX_RE);
    if (!m) continue;
    const base = key.slice(0, -m[0].length);
    if (!candidates.has(base)) candidates.set(base, new Map());
    candidates.get(base).set(m[1], value);
  }
  // A lone "_many"/"_few" etc. (e.g. "bulk_price_too_many") is a normal key.
  // Only "_one"/"_other" mark a real i18next plural group.
  const plurals = new Map();
  for (const [base, forms] of candidates) {
    if (forms.has('one') || forms.has('other')) plurals.set(base, forms);
  }
  const plain = new Map();
  for (const [key, value] of flat) {
    const m = key.match(PLURAL_SUFFIX_RE);
    if (m && plurals.has(key.slice(0, -m[0].length))) continue;
    plain.set(key, value);
  }
  return { plain, plurals };
}

// ------------------------------------------------------------------ the check

// Compare one namespace's target data against en. Returns problem strings.
export function checkNamespace(enData, tgtData) {
  const problems = [];
  const en = groupPlurals(flattenMessages(enData));
  const tg = groupPlurals(flattenMessages(tgtData));

  for (const [key, src] of en.plain) {
    if (!tg.plain.has(key)) { problems.push(`missing key "${key}"`); continue; }
    const tv = tg.plain.get(key);
    if (typeof src !== "string") continue;
    if (typeof tv !== "string" || tv === PLACEHOLDER || (tv.trim() === "" && src.trim() !== "")) {
      problems.push(`key "${key}" is empty or ${PLACEHOLDER}`);
      continue;
    }
    for (const p of compareMessages(src, tv)) problems.push(`"${key}": ${p}`);
  }
  for (const key of tg.plain.keys()) {
    if (!en.plain.has(key)) problems.push(`extra key "${key}" (not in en)`);
  }

  for (const [base, srcForms] of en.plurals) {
    const tgtForms = tg.plurals.get(base);
    if (!tgtForms) { problems.push(`missing plural key "${base}" (${[...srcForms.keys()].join("/")})`); continue; }
    for (const cat of srcForms.keys()) {
      if (!tgtForms.has(cat)) problems.push(`"${base}": plural form "_${cat}" missing`);
    }
    if (!tgtForms.has("other")) problems.push(`"${base}": plural form "_other" missing`);
    for (const [cat, tv] of tgtForms) {
      const src = srcForms.get(cat) ?? srcForms.get("other");
      if (typeof tv !== "string" || tv === PLACEHOLDER || (tv.trim() === "" && String(src ?? "").trim() !== "")) {
        problems.push(`"${base}_${cat}" is empty or ${PLACEHOLDER}`);
        continue;
      }
      if (typeof src === "string") {
        for (const p of compareMessages(src, tv)) problems.push(`"${base}_${cat}": ${p}`);
      }
    }
  }
  for (const base of tg.plurals.keys()) {
    if (!en.plurals.has(base)) problems.push(`extra plural key "${base}" (not in en)`);
  }
  return problems;
}

export function registeredLanguages(languagesSource) {
  return [...languagesSource.matchAll(/\bcode:\s*["']([\w-]+)["']/g)].map((m) => m[1]);
}

function listDirs(dir) {
  return readdirSync(dir).filter((n) => {
    try { return statSync(join(dir, n)).isDirectory(); } catch { return false; }
  });
}
function listNamespaces(dir) {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)) : [];
}
function loadJSON(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// Returns { blocking:string[], advisory:string[], info:string[], registered:string[] }
export function runParity({ root, strict = false, advisoryLangs = ADVISORY_LANGS }) {
  const localesDir = join(root, "frontend", "public", "locales");
  const languagesFile = join(root, "frontend", "src", "i18n", "languages.js");
  const out = { blocking: [], advisory: [], info: [], registered: [] };

  const registered = registeredLanguages(readFileSync(languagesFile, "utf8"));
  out.registered = registered;
  const enDir = join(localesDir, SOURCE_LANG);
  const enNamespaces = listNamespaces(enDir);
  if (enNamespaces.length === 0) {
    out.blocking.push(`no "${SOURCE_LANG}" namespaces found under ${relative(root, localesDir)}`);
    return out;
  }
  if (!registered.includes(SOURCE_LANG)) out.blocking.push(`"${SOURCE_LANG}" is not registered in languages.js`);

  const present = listDirs(localesDir).filter((l) => l !== SOURCE_LANG && l !== PSEUDO_LANG);
  const candidates = new Set([...registered.filter((l) => l !== SOURCE_LANG && l !== PSEUDO_LANG), ...present]);

  for (const lng of [...candidates].sort()) {
    const isRegistered = registered.includes(lng);
    const bucket = !isRegistered ? out.info : !strict && advisoryLangs.includes(lng) ? out.advisory : out.blocking;
    const label = (msg) => (isRegistered ? `[${lng}] ${msg}` : `[${lng}] (not registered, WIP) ${msg}`);

    if (!present.includes(lng)) {
      bucket.push(label("registered in languages.js but no locale folder exists"));
      continue;
    }
    const lngDir = join(localesDir, lng);
    const lngNamespaces = new Set(listNamespaces(lngDir));
    for (const ns of enNamespaces) {
      if (!lngNamespaces.has(ns)) { bucket.push(label(`namespace "${ns}" missing`)); continue; }
      let tgtData;
      try { tgtData = loadJSON(join(lngDir, `${ns}.json`)); }
      catch (err) { bucket.push(label(`${ns}: invalid JSON (${err.message})`)); continue; }
      for (const p of checkNamespace(loadJSON(join(enDir, `${ns}.json`)), tgtData)) bucket.push(label(`${ns}: ${p}`));
    }
    for (const ns of lngNamespaces) {
      if (!enNamespaces.includes(ns)) bucket.push(label(`extra namespace "${ns}" (not in en)`));
    }
  }
  return out;
}

// ------------------------------------------------------------------------ CLI

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const rootIdx = args.indexOf("--root");
  const root = rootIdx >= 0 ? args[rootIdx + 1] : join(fileURLToPath(new URL(".", import.meta.url)), "..");
  const { blocking, advisory, info, registered } = runParity({ root, strict });

  const show = (list, prefix, limit) => {
    for (const line of list.slice(0, limit)) console.log(`${prefix} ${line}`);
    if (list.length > limit) console.log(`${prefix} ... and ${list.length - limit} more`);
  };
  show(info, "info:", 20);
  show(advisory, "warn:", 40);
  show(blocking, "FAIL:", 200);

  if (advisory.length > 0) {
    console.log(`\nwarn: ${advisory.length} advisory finding(s) in already-live language(s) (${ADVISORY_LANGS.join(", ")}); not blocking. Use --strict to enforce.`);
  }
  if (blocking.length > 0) {
    console.error(`\n✗ i18n key-parity FAILED — ${blocking.length} blocking issue(s). A language cannot be registered before it matches en 1:1.`);
    process.exit(1);
  }
  console.log(`✓ i18n key-parity OK — registered: ${registered.join(", ")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
