#!/usr/bin/env node
// Time-tracker — kategoriseret rapport på tværs af Claude/Codex/Manus
// Issue: #390 — https://github.com/NicolaiDolmer/CyclingZone/issues/390
//
// Usage:
//   node scripts/time-tracker/report.mjs                  # current ISO week
//   node scripts/time-tracker/report.mjs --week 2026-W20
//   node scripts/time-tracker/report.mjs --all            # all-time
//   node scripts/time-tracker/report.mjs --extra-claude <path>  # other PC via OneDrive

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLAUDE_DIR = path.join(HOME, '.claude', 'projects', 'C--dev-CyclingZone');
const CODEX_ROOT = path.join(HOME, '.codex', 'sessions');
const MANUS_DIR = path.join(HOME, 'OneDrive', 'CyclingZone-context', 'CyclingZone-Manus noter');

const CATEGORIES = ['cat:user-feature', 'cat:bug', 'cat:infra', 'cat:community', 'cat:ai-ops', 'cat:founder'];
const IN_BUSINESS = new Set(['cat:user-feature', 'cat:bug', 'cat:infra', 'cat:community']);
const ON_BUSINESS = new Set(['cat:founder']);
const META = new Set(['cat:ai-ops']);
const MANUS_MIN_PER_FILE = 30;
const MIN_SESSION_MIN = 1;
const MAX_SESSION_MIN = 480;

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    week: null,
    all: false,
    extraClaude: [],
    extraCodex: [],
    outDir: path.join(REPO_ROOT, 'docs', 'metrics'),
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--week') opts.week = args[++i];
    else if (args[i] === '--all') opts.all = true;
    else if (args[i] === '--extra-claude') opts.extraClaude.push(args[++i]);
    else if (args[i] === '--extra-codex') opts.extraCodex.push(args[++i]);
    else if (args[i] === '--out') opts.outDir = args[++i];
  }
  if (!opts.week && !opts.all) opts.week = isoWeek(new Date());
  return opts;
}

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function weekRange(weekStr) {
  const [year, wPart] = weekStr.split('-');
  const week = parseInt(wPart.slice(1));
  const jan4 = new Date(Date.UTC(parseInt(year), 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const start = new Date(jan4);
  start.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (week - 1) * 7);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 7);
  return { start, end };
}

async function readJsonl(filePath) {
  const events = [];
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { /* skip bad line */ }
  }
  return events;
}

function eventTimestamp(ev) {
  return ev.timestamp || ev.payload?.timestamp || null;
}

function eventText(ev) {
  if (typeof ev.content === 'string') return ev.content;
  if (ev.payload?.last_agent_message) return ev.payload.last_agent_message;
  if (ev.payload?.text) return ev.payload.text;
  if (ev.message?.content) {
    if (typeof ev.message.content === 'string') return ev.message.content;
    if (Array.isArray(ev.message.content)) {
      return ev.message.content.map(c => c?.text || c?.content || '').filter(Boolean).join(' ');
    }
  }
  return '';
}

function extractIssueRefs(text) {
  if (!text || typeof text !== 'string') return [];
  const refs = new Map();
  for (const m of text.matchAll(/#(\d{2,4})\b/g)) {
    const n = parseInt(m[1]);
    refs.set(n, (refs.get(n) || 0) + 1);
  }
  return [...refs.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
}

function clampDuration(min) {
  return Math.max(MIN_SESSION_MIN, Math.min(MAX_SESSION_MIN, min));
}

async function parseSessionFile(filePath, source, opts = {}) {
  const events = await readJsonl(filePath);
  if (events.length === 0) return null;

  if (source === 'codex') {
    const meta = events.find(e => e.type === 'session_meta');
    const cwd = meta?.payload?.cwd || '';
    if (!cwd.toLowerCase().includes('cyclingzone')) return null;
  }

  const stamps = events.map(eventTimestamp).filter(Boolean).map(s => new Date(s)).sort((a, b) => a - b);
  if (stamps.length === 0) return null;
  const start = stamps[0];
  const end = stamps[stamps.length - 1];
  const rawMin = Math.round((end - start) / 60000) || 1;
  const durMin = clampDuration(rawMin);

  const allText = events.map(eventText).join(' ');
  const refs = extractIssueRefs(allText);

  return {
    source,
    file: path.basename(filePath),
    start, end, durMin,
    rawMin,
    truncated: rawMin > MAX_SESSION_MIN,
    issueRefs: refs,
    pc: opts.pc || 'local',
  };
}

async function collectClaudeDir(dir, pc = 'local') {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
  const out = [];
  for (const f of files) {
    try {
      const s = await parseSessionFile(path.join(dir, f), 'claude', { pc });
      if (s) out.push(s);
    } catch (e) {
      console.error(`[claude] skip ${f}: ${e.message}`);
    }
  }
  return out;
}

async function collectCodexRoot(root, pc = 'local') {
  if (!fs.existsSync(root)) return [];
  const sessions = [];
  for (const y of fs.readdirSync(root).filter(d => /^\d{4}$/.test(d))) {
    const yDir = path.join(root, y);
    for (const m of fs.readdirSync(yDir)) {
      const mDir = path.join(yDir, m);
      if (!fs.statSync(mDir).isDirectory()) continue;
      for (const d of fs.readdirSync(mDir)) {
        const dDir = path.join(mDir, d);
        if (!fs.statSync(dDir).isDirectory()) continue;
        for (const f of fs.readdirSync(dDir)) {
          if (!f.endsWith('.jsonl')) continue;
          try {
            const s = await parseSessionFile(path.join(dDir, f), 'codex', { pc });
            if (s) sessions.push(s);
          } catch (e) {
            console.error(`[codex] skip ${f}: ${e.message}`);
          }
        }
      }
    }
  }
  return sessions;
}

function collectManus() {
  if (!fs.existsSync(MANUS_DIR)) return [];
  const files = fs.readdirSync(MANUS_DIR).filter(f => f.endsWith('.md'));
  return files.map(f => {
    const fp = path.join(MANUS_DIR, f);
    const stat = fs.statSync(fp);
    return {
      source: 'manus',
      file: f,
      start: stat.mtime,
      end: stat.mtime,
      durMin: MANUS_MIN_PER_FILE,
      rawMin: MANUS_MIN_PER_FILE,
      truncated: false,
      issueRefs: [],
      defaultCategory: 'cat:founder',
      pc: 'shared',
    };
  });
}

function loadIssueLabelMap() {
  console.error('Fetching all issues with cat:* labels...');
  try {
    const json = execSync(
      `gh issue list --state all --limit 1000 --json number,labels`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
    );
    const issues = JSON.parse(json);
    const map = new Map();
    for (const issue of issues) {
      const cat = issue.labels.find(l => CATEGORIES.includes(l.name));
      if (cat) map.set(issue.number, cat.name);
    }
    console.error(`  Indexed ${map.size} categorized issues.`);
    return map;
  } catch (e) {
    console.error(`  WARN: gh issue list failed (${e.message}). All sessions will be uncategorized.`);
    return new Map();
  }
}

function classify(session, issueMap) {
  for (const ref of session.issueRefs) {
    if (issueMap.has(ref)) return issueMap.get(ref);
  }
  if (session.defaultCategory) return session.defaultCategory;
  return null;
}

function filterByWeek(sessions, weekStr) {
  const { start, end } = weekRange(weekStr);
  return sessions.filter(s => s.start >= start && s.start < end);
}

function fmtMin(m) {
  const h = Math.floor(m / 60), mm = m % 60;
  if (h && mm) return `${h}t ${mm}m`;
  if (h) return `${h}t`;
  return `${mm}m`;
}

function asciiBar(pct, width = 24) {
  const filled = Math.round(pct / 100 * width);
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

function generateReport(label, sessions) {
  const total = sessions.reduce((a, s) => a + s.durMin, 0);
  const buckets = {};
  let uncat = 0;
  for (const s of sessions) {
    if (s._category) buckets[s._category] = (buckets[s._category] || 0) + s.durMin;
    else uncat += s.durMin;
  }
  const sum = sel => Object.entries(buckets).filter(([k]) => sel.has(k)).reduce((a, [, v]) => a + v, 0);
  const inBiz = sum(IN_BUSINESS);
  const onBiz = sum(ON_BUSINESS);
  const meta = sum(META);
  const categorized = total - uncat;
  const pct = v => categorized ? Math.round(v / categorized * 100) : 0;

  const sourceTotals = sessions.reduce((acc, s) => {
    acc[s.source] = (acc[s.source] || 0) + s.durMin;
    return acc;
  }, {});

  const lines = [];
  lines.push(`# Time-report ${label}`);
  lines.push('');
  lines.push(`Genereret: ${new Date().toISOString().slice(0, 10)} · Issue: [#390](https://github.com/NicolaiDolmer/CyclingZone/issues/390)`);
  lines.push('');
  lines.push(`**Total tracked:** ${fmtMin(total)} (${sessions.length} sessioner/filer)`);
  lines.push('');
  lines.push('## In vs On the business');
  lines.push('');
  lines.push('| Bucket | Tid | Andel af kategoriseret |');
  lines.push('|---|---|---|');
  lines.push(`| **In the business** (user-feature + bug + infra + community) | ${fmtMin(inBiz)} | ${pct(inBiz)}% |`);
  lines.push(`| **On the business** (founder) | ${fmtMin(onBiz)} | ${pct(onBiz)}% |`);
  lines.push(`| Meta (ai-ops) | ${fmtMin(meta)} | ${pct(meta)}% |`);
  if (uncat) lines.push(`| Ukategoriseret | ${fmtMin(uncat)} | — |`);
  lines.push('');
  lines.push('## Pr. kategori');
  lines.push('');
  lines.push('```');
  for (const cat of CATEGORIES) {
    const v = buckets[cat] || 0;
    const p = pct(v);
    lines.push(`${cat.padEnd(20)} ${asciiBar(p)} ${String(p).padStart(3)}%  ${fmtMin(v)}`);
  }
  lines.push('```');
  lines.push('');
  lines.push('## Pr. kilde');
  lines.push('');
  lines.push('| Kilde | Tid | Sessioner |');
  lines.push('|---|---|---|');
  for (const src of ['claude', 'codex', 'manus']) {
    const t = sourceTotals[src] || 0;
    const n = sessions.filter(s => s.source === src).length;
    lines.push(`| ${src} | ${fmtMin(t)} | ${n} |`);
  }
  lines.push('');

  const top = [...sessions].sort((a, b) => b.durMin - a.durMin).slice(0, 5);
  lines.push('## Top 5 sessioner');
  lines.push('');
  lines.push('| Tid | Source | Kategori | Issue-refs | Start |');
  lines.push('|---|---|---|---|---|');
  for (const s of top) {
    const refs = s.issueRefs.length ? '#' + s.issueRefs.slice(0, 3).join(', #') : '—';
    lines.push(`| ${fmtMin(s.durMin)} | ${s.source} | ${s._category || '—'} | ${refs} | ${s.start.toISOString().slice(0, 16).replace('T', ' ')} |`);
  }
  lines.push('');

  lines.push('## Anbefaling');
  lines.push('');
  const recs = [];
  if (total > 0 && uncat / total > 0.4) {
    recs.push(`🟡 ${Math.round(uncat / total * 100)}% af tid er ukategoriseret. Tilføj \`Refs #N\` i prompts/commits eller \`cat:*\`-label på issues.`);
  }
  if (buckets['cat:bug'] && categorized && buckets['cat:bug'] / categorized > 0.4) {
    recs.push(`🔴 >40% bug-fix. Overvej kvalitets-hardening sprint.`);
  }
  if (categorized && !onBiz) {
    recs.push(`🟡 0% "on the business" denne periode. Plan tid til strategi/marketing/økonomi.`);
  }
  if (categorized && meta / categorized > 0.5) {
    recs.push(`🟡 >50% AI-ops (meta-arbejde). Tjek om dev-loop-optimering er ved at fortrænge brugerværdi-arbejde.`);
  }
  if (!recs.length) recs.push('🟢 Balanceret fordeling — ingen alarmsignaler.');
  for (const r of recs) lines.push(`- ${r}`);
  lines.push('');

  lines.push('## Begrænsninger');
  lines.push('');
  lines.push('- Session-tid = wall-clock med ~15 min præcision (pauser tæller med, sessioner >8t clampes)');
  lines.push('- Issue-attribution kræver `Refs #N` i prompt-tekst ELLER `cat:*`-label på refereret issue');
  lines.push('- Manus-tid er fast 30 min/fil (research-output, ikke clock-tid)');
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const opts = parseArgs();
  console.error('Collecting sessions...');

  const claudeLocal = await collectClaudeDir(CLAUDE_DIR, 'local');
  const claudeExtra = (await Promise.all(opts.extraClaude.map(p => collectClaudeDir(p, path.basename(p))))).flat();
  const codexLocal = await collectCodexRoot(CODEX_ROOT, 'local');
  const codexExtra = (await Promise.all(opts.extraCodex.map(p => collectCodexRoot(p, path.basename(p))))).flat();
  const manus = collectManus();

  let all = [...claudeLocal, ...claudeExtra, ...codexLocal, ...codexExtra, ...manus];
  console.error(`  Claude: ${claudeLocal.length + claudeExtra.length}, Codex: ${codexLocal.length + codexExtra.length}, Manus: ${manus.length}`);

  if (opts.week && !opts.all) {
    const before = all.length;
    all = filterByWeek(all, opts.week);
    console.error(`  Week ${opts.week} filter: ${before} → ${all.length}`);
  }

  const issueMap = loadIssueLabelMap();
  for (const s of all) s._category = classify(s, issueMap);

  const label = opts.week || 'all-time';
  const report = generateReport(label, all);

  if (!fs.existsSync(opts.outDir)) fs.mkdirSync(opts.outDir, { recursive: true });
  const outPath = path.join(opts.outDir, `time-${label}.md`);
  fs.writeFileSync(outPath, report);
  console.error(`Wrote ${outPath}`);
  console.log(report);
}

main().catch(e => { console.error(e); process.exit(1); });
