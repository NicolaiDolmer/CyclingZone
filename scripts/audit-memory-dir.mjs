#!/usr/bin/env node
// Audit ~/.claude/projects/C--dev-CyclingZone/memory/ for stale, duplicate,
// or rotten memory files. Outputs a markdown report to stdout.
//
// Usage:
//   node scripts/audit-memory-dir.mjs                 # human-readable report
//   node scripts/audit-memory-dir.mjs --json          # JSON report
//   node scripts/audit-memory-dir.mjs --baseline-out docs/metrics/memory-baseline.json
//
// Refs: GitHub issue #380.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const MEMORY_DIR = path.join(
  os.homedir(),
  ".claude",
  "projects",
  "C--dev-CyclingZone",
  "memory",
);

const STALE_DAYS = 30;
const SIMILARITY_THRESHOLD = 0.82;
// Files intentionally without memory-entry frontmatter (indexes/docs).
const SKIP_FRONTMATTER_CHECK = new Set([
  "MEMORY.md",
  "MEMORY_REFERENCE.md",
  "README.md",
]);

const args = new Set(process.argv.slice(2));
const jsonOutput = args.has("--json");
let baselineOut = null;
const baselineIdx = process.argv.indexOf("--baseline-out");
if (baselineIdx !== -1 && process.argv[baselineIdx + 1]) {
  baselineOut = process.argv[baselineIdx + 1];
}

function approxTokens(text) {
  return Math.ceil(text.length / 4);
}

function parseFrontmatter(content) {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!m) return null;
  const result = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.+)$/);
    if (kv) result[kv[1]] = kv[2].trim();
  }
  return result;
}

function levenshteinRatio(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) / Math.max(m, n) > 1 - SIMILARITY_THRESHOLD) return 0;
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  const dist = prev[n];
  return 1 - dist / Math.max(m, n);
}

function loadFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((name) => {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      const content = fs.readFileSync(full, "utf8");
      const fm = parseFrontmatter(content);
      return { name, full, stat, content, fm };
    });
}

function findStale(files, now) {
  return files
    .filter((f) => (now - f.stat.mtimeMs) / 86400000 >= STALE_DAYS)
    .map((f) => ({
      name: f.name,
      ageDays: Math.floor((now - f.stat.mtimeMs) / 86400000),
      tokens: approxTokens(f.content),
    }))
    .sort((a, b) => b.ageDays - a.ageDays);
}

function findDuplicates(files) {
  const dups = [];
  for (let i = 0; i < files.length; i++) {
    const a = files[i];
    const aDesc = a.fm?.description;
    if (!aDesc) continue;
    for (let j = i + 1; j < files.length; j++) {
      const b = files[j];
      const bDesc = b.fm?.description;
      if (!bDesc) continue;
      const ratio = levenshteinRatio(aDesc, bDesc);
      if (ratio >= SIMILARITY_THRESHOLD) {
        dups.push({ a: a.name, b: b.name, ratio: Math.round(ratio * 100) / 100 });
      }
    }
  }
  return dups.sort((a, b) => b.ratio - a.ratio);
}

function findRot(files) {
  const rot = [];
  for (const f of files) {
    if (SKIP_FRONTMATTER_CHECK.has(f.name)) continue;
    if (!f.fm) {
      rot.push({ name: f.name, reason: "missing frontmatter" });
      continue;
    }
    const issues = [];
    if (!f.fm.name) issues.push("missing name");
    if (!f.fm.description) issues.push("missing description");
    if (!f.fm.type) issues.push("missing type");
    else if (!["user", "feedback", "project", "reference"].includes(f.fm.type)) {
      issues.push(`unknown type '${f.fm.type}'`);
    }
    const body = f.content.replace(/^---[\s\S]*?\n---\s*\n/, "").trim();
    if (body.length < 50) issues.push("body <50 chars (possibly empty)");
    if (issues.length) rot.push({ name: f.name, reason: issues.join("; ") });
  }
  return rot;
}

const files = loadFiles(MEMORY_DIR);
const now = Date.now();
const totalTokens = files.reduce((s, f) => s + approxTokens(f.content), 0);

const stale = findStale(files, now);
const duplicates = findDuplicates(files);
const rot = findRot(files);

const report = {
  generated: new Date().toISOString(),
  memoryDir: MEMORY_DIR,
  totals: {
    files: files.length,
    approxTokens: totalTokens,
  },
  stale,
  duplicates,
  rot,
};

if (baselineOut) {
  const baselineDir = path.dirname(baselineOut);
  if (!fs.existsSync(baselineDir)) fs.mkdirSync(baselineDir, { recursive: true });
  let prev = null;
  if (fs.existsSync(baselineOut)) {
    try {
      prev = JSON.parse(fs.readFileSync(baselineOut, "utf8"));
    } catch {
      prev = null;
    }
  }
  const baseline = {
    timestamp: new Date().toISOString(),
    files: files.length,
    approxTokens: totalTokens,
    previous: prev
      ? {
          timestamp: prev.timestamp,
          files: prev.files,
          approxTokens: prev.approxTokens,
        }
      : null,
  };
  fs.writeFileSync(baselineOut, JSON.stringify(baseline, null, 2));
}

if (jsonOutput) {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exit(0);
}

const lines = [];
lines.push(`# Memory directory audit — ${report.generated}`);
lines.push("");
lines.push(`- Directory: \`${MEMORY_DIR}\``);
lines.push(`- Files: ${files.length}`);
lines.push(`- Approx tokens: ${totalTokens}`);
lines.push("");

lines.push(`## Stale (>=${STALE_DAYS} days unchanged): ${stale.length}`);
if (stale.length === 0) {
  lines.push("- None.");
} else {
  for (const s of stale.slice(0, 25)) {
    lines.push(`- ${s.name} — ${s.ageDays}d, ~${s.tokens} tok`);
  }
  if (stale.length > 25) lines.push(`- ...and ${stale.length - 25} more`);
}
lines.push("");

lines.push(`## Suspected duplicates (description Levenshtein >=${SIMILARITY_THRESHOLD}): ${duplicates.length}`);
if (duplicates.length === 0) {
  lines.push("- None.");
} else {
  for (const d of duplicates.slice(0, 25)) {
    lines.push(`- ${d.a} <-> ${d.b} (similarity ${d.ratio})`);
  }
  if (duplicates.length > 25) lines.push(`- ...and ${duplicates.length - 25} more`);
}
lines.push("");

lines.push(`## Frontmatter rot: ${rot.length}`);
if (rot.length === 0) {
  lines.push("- None.");
} else {
  for (const r of rot.slice(0, 25)) {
    lines.push(`- ${r.name} — ${r.reason}`);
  }
  if (rot.length > 25) lines.push(`- ...and ${rot.length - 25} more`);
}
lines.push("");

lines.push("## Suggested actions");
lines.push("- Review stale entries: are they still load-bearing? Delete or refresh.");
lines.push("- Merge duplicate descriptions into one canonical memory.");
lines.push("- Fix frontmatter rot (missing fields, wrong type).");
lines.push("");

process.stdout.write(lines.join("\n"));
