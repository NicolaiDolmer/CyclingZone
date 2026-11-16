#!/usr/bin/env node
// scripts/plan-gap-audit.mjs
// ============================================================
// Plan-hul-tjek (#8230, ejer 16/11): finder planlagt arbejde, der er faldet ud
// af planen uden at have faaet en anden plads. Koeres hver mandag, foer
// "This week" skaeres; ejeren faar ét kort med hoejst 10 punkter.
//
// KUN LAESNING: skriver aldrig til GitHub, Supabase eller filer i repoet
// (kun --out <fil>, som du selv navngiver). Supabase laeses med SELECT.
//
// Et issue har "en plads", naar det staar i docs/MASTERPLAN.md, i
// docs/I_GANG.md, paa roadmappet med horisont (roadmap_items.issue_ref, ikke
// arkiveret, horisont sat og ikke "unscheduled") - eller er lukket.
//
// Lister (rapportens fulde del):
//   fjernet      - issue-numre fjernet fra MASTERPLAN/NOW i perioden (git-log),
//                  som stadig er aabne og uden plads.
//   ejer-aftalt  - aabne issues med ejer/loefte/aftalt/ejervalg i titel eller
//                  seneste kommentar, eller label needs-design/needs-decision/
//                  priority:high, uden plads.
//   arkiveret    - roadmap-raekker arkiveret i perioden uden shipped_at.
//   kontakt-off  - app_config-kontakter off i over 14 dage, hvor registret
//                  siger building eller dormant.
//   dublet       - issues lukket i perioden som dublet / "samlet i #N", hvor
//                  maalissuet er lukket uden at vaere leveret, eller er aabent
//                  uden plads.
// Toppen (hoejst 10) rangeres: fejl > ejer-aftalt > spillerstemmer > resten.
//
// Brug:
//   infisical run --env=prod -- node scripts/plan-gap-audit.mjs [--days 7|all] [--out fil.md]
//   node scripts/plan-gap-audit.mjs --check-commit <sha>   (Stop-hooken, se nedenfor)
// Uden SUPABASE_URL/SUPABASE_SERVICE_KEY springes roadmap- og kontakt-delen
// over (rapporten siger det); GitHub og git-historik laeses stadig.
//
// --check-commit: bruges af scripts/check-now-md.sh. Fjernede commit'en
// issue-numre fra MASTERPLAN, som er aabne og hverken staar i MASTERPLAN eller
// I_GANG efter commit'en, printes én advarselslinje; ellers intet. Roadmappet
// laeses ikke her (hooken har ingen databaseadgang). Exit altid 0.
// ============================================================

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_FILES = ["docs/MASTERPLAN.md", "docs/NOW.md"];
const TOP_LIMIT = 10;
const FLAG_OFF_DAYS = 14;
const OWNER_LABELS = ["needs-design", "needs-decision", "priority:high"];
const BUG_LABELS = ["type:bug", "bug", "cat:bug", "player-report", "brand"];
// Ord der markerer et ejervalg eller et loefte. \b virker ikke med æøå, derfor
// en eksplicit venstre-graense.
const OWNER_WORDS = /(^|[^a-zæøå0-9])(ejer\w*|løfte\w*|lovet|aftalt\w*|ejervalg\w*)/i;
const BUG_TITLE = /^\s*\[(bug|p1|p2|brand)[\]/ ]/i;
// "Dublet af #N", "duplicate of #N", "samlet i #N", "lukkes i #N", "fortsaetter i #N".
const DUP_TARGET = /(dublet\s+af|duplicate\s+of|samlet\s+(?:i|under)|lukkes\s+i|fortsætter\s+i|fortsaetter\s+i|merged\s+into|flyttet\s+til)\s*:?\s*#(\d+)/i;
const PLACELESS_HORIZONS = new Set(["", "unscheduled"]);

// ---------- rene funktioner (testes i plan-gap-audit.test.mjs) ----------

/** Alle issue-/PR-numre (#123) i en tekst. */
export function extractIssueNumbers(text) {
  const out = new Set();
  for (const m of String(text ?? "").matchAll(/#(\d{2,6})\b/g)) out.add(Number(m[1]));
  return out;
}

/** Numre der stod i `before`, men ikke staar i `after`. */
export function removedIssueNumbers(before, after) {
  const now = extractIssueNumbers(after);
  return [...extractIssueNumbers(before)].filter((n) => !now.has(n)).sort((a, b) => a - b);
}

/**
 * Laeser `git log -p --format=@@COMMIT %h %cI` og finder numre paa fjernede
 * linjer. Nyeste commit foerst (git-loggens orden), saa foerste fund pr. nummer
 * er den seneste fjernelse.
 * @returns {Map<number,{sha:string,date:string,file:string,line:string}>}
 */
export function parseRemovals(patch) {
  const out = new Map();
  let sha = "", date = "", file = "";
  for (const raw of String(patch ?? "").split(/\r?\n/)) {
    if (raw.startsWith("@@COMMIT ")) {
      [, sha, date] = raw.split(" ");
      continue;
    }
    if (raw.startsWith("--- ")) {
      file = raw.replace(/^--- (a\/)?/, "");
      continue;
    }
    if (!raw.startsWith("-") || raw.startsWith("---")) continue;
    const line = raw.slice(1).trim();
    for (const n of extractIssueNumbers(line)) {
      if (!out.has(n)) out.set(n, { sha, date: (date || "").slice(0, 10), file, line: line.slice(0, 160) });
    }
  }
  return out;
}

/** Issue-numre der har en plads: MASTERPLAN, I_GANG og roadmap med horisont. */
export function placedIssues({ masterplan = "", iGang = "", roadmapItems = [] }) {
  const placed = new Set([...extractIssueNumbers(masterplan), ...extractIssueNumbers(iGang)]);
  for (const r of roadmapItems) {
    if (r.issue_ref == null || r.status === "archived") continue;
    if (PLACELESS_HORIZONS.has(String(r.horizon ?? "").trim())) continue;
    placed.add(Number(r.issue_ref));
  }
  return placed;
}

const labelsOf = (issue) => (issue.labels ?? []).map((l) => (typeof l === "string" ? l : l.name));

export function isBug(issue) {
  const labels = labelsOf(issue);
  return labels.some((l) => BUG_LABELS.includes(l)) || BUG_TITLE.test(issue.title ?? "");
}

export function isOwnerAgreed(issue) {
  if (labelsOf(issue).some((l) => OWNER_LABELS.includes(l))) return true;
  return OWNER_WORDS.test(issue.title ?? "") || OWNER_WORDS.test(issue.lastComment ?? "");
}

/**
 * Fjernet fra MASTERPLAN/NOW, stadig aabent og uden plads.
 * @param {Map<number,object>} removals  fra parseRemovals
 * @param {Map<number,object>} openIssues  aabne issues (ikke PR'er) pr. nummer
 * @param {Set<number>} placed
 */
export function findRemovedWithoutPlace({ removals, openIssues, placed }) {
  const out = [];
  for (const [n, r] of removals) {
    if (placed.has(n) || !openIssues.has(n)) continue;
    out.push({ number: n, kind: "fjernet", detail: `fjernet ${r.date} fra ${r.file} (${r.sha})`, line: r.line });
  }
  return out;
}

export function findOwnerAgreedWithoutPlace({ openIssues, placed }) {
  const out = [];
  for (const [n, issue] of openIssues) {
    if (placed.has(n) || !isOwnerAgreed(issue)) continue;
    out.push({ number: n, kind: "ejer-aftalt", detail: "ejervalg/løfte uden plads" });
  }
  return out;
}

/** Roadmap-raekker arkiveret siden `sinceIso` uden shipped_at. */
export function findArchivedWithoutShipped({ roadmapItems, sinceIso }) {
  return roadmapItems
    .filter((r) => r.status === "archived" && !r.shipped_at && (!sinceIso || String(r.updated_at ?? "") >= sinceIso))
    .map((r) => ({
      number: r.issue_ref != null ? Number(r.issue_ref) : null,
      key: `roadmap:${r.id}`,
      kind: "arkiveret",
      detail: `roadmap-række arkiveret ${String(r.updated_at ?? "").slice(0, 10)} uden levering: ${r.title_da || r.title_en || r.id}`,
    }));
}

const isOn = (v) => {
  const s = String(typeof v === "string" ? v : JSON.stringify(v ?? "")).replace(/"/g, "").trim().toLowerCase();
  return ["on", "true", "beta"].includes(s);
};

/** Kontakter off i over `days` dage, hvor registret siger building/dormant. */
export function findStaleOffFlags({ registry, config, now, days = FLAG_OFF_DAYS }) {
  const byKey = new Map(config.map((r) => [r.key, r]));
  const limit = new Date(now).getTime() - days * 86_400_000;
  const out = [];
  for (const e of registry) {
    if (!e.flag || !["building", "dormant"].includes(e.state)) continue;
    const row = byKey.get(e.flag);
    if (!row || isOn(row.value)) continue;
    const changed = new Date(row.updated_at ?? 0).getTime();
    if (!(changed < limit)) continue;
    out.push({
      number: e.epic ? Number(e.epic) : null,
      key: `flag:${e.flag}`,
      kind: "kontakt-off",
      detail: `kontakt ${e.flag} off siden ${String(row.updated_at ?? "?").slice(0, 10)}, registret siger ${e.state}`,
    });
  }
  return out;
}

/** Maalissuet i en dublet-/"samlet i"-lukning, eller null. */
export function findDuplicateTarget(text) {
  const m = DUP_TARGET.exec(String(text ?? ""));
  return m ? Number(m[2]) : null;
}

/**
 * Dublet-lukninger, hvor maalet ikke baerer arbejdet videre.
 * @param {Array<{number:number,title:string,text:string}>} closures  lukkede issues i perioden
 * @param {Map<number,{state:string,stateReason?:string}>} targetStates  maalissues (OPEN/CLOSED)
 */
export function findBrokenDuplicateClosures({ closures, targetStates, placed }) {
  const out = [];
  for (const c of closures) {
    const target = findDuplicateTarget(c.text);
    if (!target || target === c.number) continue;
    const t = targetStates.get(target);
    if (!t) continue;
    let why = null;
    if (t.state === "CLOSED" && t.stateReason !== "COMPLETED") why = `målet #${target} er lukket uden levering`;
    else if (t.state === "OPEN" && !placed.has(target)) why = `målet #${target} er åbent uden plads`;
    if (why) out.push({ number: c.number, kind: "dublet", detail: `lukket som dublet/samlet; ${why}`, title: c.title });
  }
  return out;
}

/**
 * Samler fund pr. issue (eller noegle) og rangerer: fejl > ejer-aftalt >
 * spillerstemmer > resten; claude:done sidst. Inden for et trin: flest
 * grunde, flest stemmer, nyeste issue.
 */
export function rankFindings(findings, { issues = new Map(), votes = new Map() } = {}) {
  const merged = new Map();
  for (const f of findings) {
    const key = f.number != null ? `#${f.number}` : f.key;
    const cur = merged.get(key) ?? { key, number: f.number ?? null, kinds: [], details: [], title: f.title ?? null };
    if (!cur.kinds.includes(f.kind)) cur.kinds.push(f.kind);
    cur.details.push(f.detail);
    if (f.line) cur.line = f.line;
    merged.set(key, cur);
  }
  for (const m of merged.values()) {
    const issue = m.number != null ? issues.get(m.number) : null;
    if (issue && !m.title) m.title = issue.title;
    m.votes = (m.number != null && votes.get(m.number)) || 0;
    const done = issue && labelsOf(issue).includes("claude:done");
    m.tier = done ? 4 : issue && isBug(issue) ? 0 : m.kinds.includes("ejer-aftalt") || (issue && isOwnerAgreed(issue)) ? 1 : m.votes > 0 ? 2 : 3;
  }
  return [...merged.values()].sort(
    (a, b) => a.tier - b.tier || b.kinds.length - a.kinds.length || b.votes - a.votes || (b.number ?? 0) - (a.number ?? 0),
  );
}

const TIER_NAMES = ["Fejl", "Ejer-aftalt", "Spillerstemmer", "Øvrige", "Færdig men åben (claude:done)"];

function itemLine(m) {
  const head = m.number != null ? `#${m.number}` : m.key;
  const votes = m.votes ? ` · ${m.votes} stemmer` : "";
  return `- **${head}** ${m.title ?? ""} [${m.kinds.join(", ")}${votes}]: ${m.details.join("; ")}`;
}

export function formatReport({ ranked, meta }) {
  const top = ranked.filter((m) => m.tier < 4).slice(0, TOP_LIMIT);
  const lines = [
    `# Plan-hul-tjek ${meta.date}`,
    "",
    `> Periode: ${meta.period}. ${meta.notes.join(" ")}`,
    "> For hvert punkt vælger ejeren: horisont på roadmappet, en linje i masterplanen, eller drop med grund (luk eller \`icebox\` med dato).",
    "",
    `## Top ${top.length} (fejl, ejer-aftalt, stemmer)`,
    "",
    ...(top.length ? top.map(itemLine) : ["Ingen huller fundet."]),
    "",
    `## Fuld liste (${ranked.length})`,
  ];
  for (let t = 0; t < TIER_NAMES.length; t++) {
    const group = ranked.filter((m) => m.tier === t);
    if (!group.length) continue;
    lines.push("", `### ${TIER_NAMES[t]} (${group.length})`, "", ...group.map(itemLine));
  }
  return lines.join("\n") + "\n";
}

export function formatCommitWarning(sha, numbers) {
  if (!numbers.length) return "";
  const list = numbers.map((n) => `#${n}`).join(", ");
  return `Commit ${sha} fjernede ${list} fra MASTERPLAN; de er åbne og står hverken i MASTERPLAN eller docs/I_GANG.md (#8230: et punkt må kun fjernes, hvis det står på roadmappet med horisont, i I_GANG eller er lukket med bevis). Giv hvert en plads eller sæt det tilbage; står det allerede på roadmappet med horisont, så skriv det kort.`;
}

// ---------- I/O ----------

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], ...opts });
}

function repoSlug() {
  const url = sh("git", ["remote", "get-url", "origin"]).trim();
  const m = /github\.com[:/]([^/]+)\/([^/.]+)/.exec(url);
  if (!m) throw new Error("kunne ikke læse GitHub-repo fra origin");
  return { owner: m[1], name: m[2] };
}

function readOr(path, fallback = "") {
  try {
    return readFileSync(resolve(ROOT, path), "utf8");
  } catch {
    return fallback;
  }
}

/** Status for enkelte numre i ét GraphQL-kald. Map nummer -> {type,state,stateReason}. */
function fetchStates(numbers) {
  const out = new Map();
  const uniq = [...new Set(numbers)];
  if (!uniq.length) return out;
  const { owner, name } = repoSlug();
  for (let i = 0; i < uniq.length; i += 100) {
    const chunk = uniq.slice(i, i + 100);
    const fields = chunk
      .map((n) => `n${n}: issueOrPullRequest(number: ${n}) { __typename ... on Issue { state stateReason } ... on PullRequest { state } }`)
      .join("\n");
    let raw;
    try {
      raw = sh("gh", ["api", "graphql", "-f", `query={ repository(owner: "${owner}", name: "${name}") { ${fields} } }`]);
    } catch (err) {
      // Et ukendt nummer giver en GraphQL-fejl, men de andre felter kommer stadig med.
      raw = err?.stdout;
      if (!raw) throw err;
    }
    const repo = JSON.parse(raw)?.data?.repository ?? {};
    for (const n of chunk) {
      const v = repo[`n${n}`];
      if (v) out.set(n, { type: v.__typename, state: v.state, stateReason: v.stateReason ?? null });
    }
  }
  return out;
}

function fetchOpenIssues() {
  const { owner, name } = repoSlug();
  const query = `query($endCursor: String) { repository(owner: "${owner}", name: "${name}") { issues(states: OPEN, first: 100, after: $endCursor) { pageInfo { hasNextPage endCursor } nodes { number title labels(first: 30) { nodes { name } } comments(last: 1) { nodes { body } } } } } }`;
  const raw = sh("gh", ["api", "graphql", "--paginate", "-f", `query=${query}`, "--jq", ".data.repository.issues.nodes[]"]);
  const map = new Map();
  for (const line of raw.split(/\r?\n/).filter(Boolean)) {
    const n = JSON.parse(line);
    map.set(n.number, {
      number: n.number,
      title: n.title,
      labels: n.labels.nodes.map((l) => l.name),
      lastComment: n.comments.nodes[0]?.body ?? "",
    });
  }
  return map;
}

function fetchClosedSince(sinceDate) {
  const { owner, name } = repoSlug();
  const q = `repo:${owner}/${name} is:issue is:closed closed:>=${sinceDate}`;
  const query = `query($endCursor: String) { search(type: ISSUE, query: "${q}", first: 100, after: $endCursor) { pageInfo { hasNextPage endCursor } nodes { ... on Issue { number title body stateReason comments(last: 3) { nodes { body } } } } } }`;
  const raw = sh("gh", ["api", "graphql", "--paginate", "-f", `query=${query}`, "--jq", ".data.search.nodes[]"]);
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((n) => n.number)
    .map((n) => ({ number: n.number, title: n.title, text: [...n.comments.nodes.map((c) => c.body).reverse(), n.body].join("\n") }));
}

async function fetchSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const [items, scores, config] = await Promise.all([
    db.from("roadmap_items").select("id, issue_ref, status, horizon, shipped_at, updated_at, title_en, title_da"),
    db.from("roadmap_item_scores").select("issue_ref, votes"),
    db.from("app_config").select("key, value, updated_at"),
  ]);
  for (const [name, res] of [["roadmap_items", items], ["roadmap_item_scores", scores], ["app_config", config]]) {
    if (res.error) throw new Error(`${name}: ${res.error.message}`);
  }
  const votes = new Map();
  for (const s of scores.data) {
    if (s.issue_ref != null) votes.set(Number(s.issue_ref), (votes.get(Number(s.issue_ref)) ?? 0) + (Number(s.votes) || 0));
  }
  return { roadmapItems: items.data, votes, config: config.data };
}

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function checkCommit(sha) {
  const show = (rev, path) => {
    try {
      return sh("git", ["show", `${rev}:${path}`]);
    } catch {
      return "";
    }
  };
  const before = show(`${sha}^`, "docs/MASTERPLAN.md");
  const after = show(sha, "docs/MASTERPLAN.md");
  const stillPlaced = extractIssueNumbers(show(sha, "docs/I_GANG.md"));
  const candidates = removedIssueNumbers(before, after).filter((n) => !stillPlaced.has(n));
  if (!candidates.length) return "";
  let states = new Map();
  try {
    states = fetchStates(candidates);
  } catch {
    // gh utilgaengelig: advar om alle kandidater hellere end at tie.
  }
  const lost = candidates.filter((n) => {
    const s = states.get(n);
    return !s || (s.type === "Issue" && s.state === "OPEN");
  });
  return formatCommitWarning(sha, lost);
}

async function main(argv) {
  const commit = argValue(argv, "--check-commit");
  if (commit) {
    try {
      const msg = checkCommit(commit);
      if (msg) console.log(msg);
    } catch {
      // Hook-tilstand: aldrig fejl ud af Stop-hooken.
    }
    return;
  }

  const daysArg = argValue(argv, "--days") ?? "7";
  const all = daysArg === "all";
  const days = all ? null : Number(daysArg);
  if (!all && !(days > 0)) throw new Error("--days skal være et positivt tal eller 'all'");
  const now = new Date();
  const since = all ? null : new Date(now.getTime() - days * 86_400_000);
  const sinceDate = since ? since.toISOString().slice(0, 10) : null;
  const notes = [];

  const logArgs = ["log", "-p", "--no-color", "--format=@@COMMIT %h %cI"];
  if (since) logArgs.push(`--since=${since.toISOString()}`);
  const removals = parseRemovals(sh("git", ["--no-pager", ...logArgs, "--", ...PLAN_FILES]));

  const openIssues = fetchOpenIssues();
  const sb = await fetchSupabase();
  if (!sb) notes.push("Roadmap og kontakter er IKKE læst (ingen SUPABASE_URL/SUPABASE_SERVICE_KEY; kør via infisical run).");
  const roadmapItems = sb?.roadmapItems ?? [];
  const placed = placedIssues({ masterplan: readOr("docs/MASTERPLAN.md"), iGang: readOr("docs/I_GANG.md"), roadmapItems });

  const findings = [
    ...findRemovedWithoutPlace({ removals, openIssues, placed }),
    ...findOwnerAgreedWithoutPlace({ openIssues, placed }),
  ];
  if (sb) {
    findings.push(...findArchivedWithoutShipped({ roadmapItems, sinceIso: since?.toISOString() }));
    const { parseRegistry } = await import("./generate-feature-status.mjs");
    const registry = parseRegistry(readOr("docs/FEATURE_REGISTRY.yml"));
    findings.push(...findStaleOffFlags({ registry, config: sb.config, now }));
  }
  // Dublet-lukninger: hele historikken er tusindvis af issues; --days all ser 90 dage tilbage.
  const closedSince = sinceDate ?? new Date(now.getTime() - 90 * 86_400_000).toISOString().slice(0, 10);
  if (all) notes.push(`Dublet-lukninger læses fra ${closedSince}.`);
  const closures = fetchClosedSince(closedSince);
  const targets = closures.map((c) => findDuplicateTarget(c.text)).filter(Boolean);
  const targetStates = new Map();
  for (const n of targets) if (openIssues.has(n)) targetStates.set(n, { state: "OPEN" });
  for (const [n, s] of fetchStates(targets.filter((n) => !openIssues.has(n)))) if (s.type === "Issue") targetStates.set(n, s);
  findings.push(...findBrokenDuplicateClosures({ closures, targetStates, placed }));

  const ranked = rankFindings(findings, { issues: openIssues, votes: sb?.votes ?? new Map() });
  const report = formatReport({
    ranked,
    meta: { date: now.toISOString().slice(0, 10), period: all ? "hele historikken" : `seneste ${days} dage (fra ${sinceDate})`, notes },
  });
  const out = argValue(argv, "--out");
  if (out) {
    writeFileSync(resolve(process.cwd(), out), report);
    console.log(`Skrev ${out} (${ranked.length} punkter).`);
  } else {
    process.stdout.write(report);
  }
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`plan-gap-audit fejlede: ${err.message}`);
    process.exit(1);
  });
}
