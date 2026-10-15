#!/usr/bin/env node
// scripts/review-gate.mjs - risikostyret review-gate (#6654, ejer 15/10).
//
// Regel (AGENTS.md hard rule 35 + docs/GITHUB_WORKFLOW.md "Review-gate"):
//   - ALLE PR'er: Codex-review gennemfoert og ingen uloeste Codex-fund
//     (en Codex-traad er loest naar den er markeret "Resolve conversation").
//   - HOEJRISIKO (motor, database/migrationer/RLS, penge/oekonomi, auth/
//     sikkerhed, workflows, eller label risk:high/security): derudover en
//     Claude-review-markoer uden blokerende fund:
//         <!-- claude-review: clean|notes|blocking [sha=<commit>] -->
//     Seneste markoer fra en betroet konto (OWNER/MEMBER/COLLABORATOR) gaelder.
//   - CodeRabbit er bonus, aldrig et krav. Dependabot er undtaget (Codex
//     reviewer ikke Dependabot-PR'er; rule 35 (c) daekker dem med CI).
//
// Alt herunder er rene funktioner; gh-kaldene ligger i main() nederst.
//
//   node scripts/review-gate.mjs evaluate --pr 6654 [--repo owner/name]
//   node scripts/review-gate.mjs post-claude-review --pr 6654 --verdict clean [--note "..."]
//   node scripts/review-gate.mjs refresh [--pr 6654]          # genkoer gaten (CI)
//   node scripts/review-gate.mjs escaped-report [--since 2026-10-01] [--until 2026-11-01]
//
// Tests: node --test scripts/review-gate.test.mjs

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DEFAULT_REPO = "NicolaiDolmer/CyclingZone";
export const WORKFLOW_FILE = "review-gate.yml";
export const CODEX_LOGIN = "chatgpt-codex-connector";
export const CODERABBIT_LOGIN = "coderabbitai";
export const CODEX_SUMMARY_MARKER = "<!-- codex-pull-request-review-summary -->";
export const CLAUDE_MARKER_RE = /<!--\s*claude-review:\s*(clean|notes|blocking)(?:\s+sha=([0-9a-f]{7,40}))?\s*-->/i;
export const TRUSTED_ASSOCIATIONS = Object.freeze(["OWNER", "MEMBER", "COLLABORATOR"]);
export const HIGH_RISK_LABELS = Object.freeze(["risk:high", "security"]);
export const EXEMPT_AUTHORS = Object.freeze(["dependabot"]);
export const ESCAPED_DEFECT_LABEL = "escaped-defect";

// ── Risiko-klassifikation ──────────────────────────────────────────────────

const TEST_FILE_RE = /(^|\/)[^/]+\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)__tests__\/|(^|\/)tests?\//;
const HIGH_RISK_RULES = Object.freeze([
  { reason: "motor", re: /^backend\/lib\/engine\// },
  { reason: "database", re: /^(database|supabase)\// },
  { reason: "workflow", re: /^\.github\/(workflows|actions)\// },
  { reason: "sikkerhed", re: /^(\.gitleaks\.toml|SECURITY\.md)$/ },
  // Penge/oekonomi: backend-kode hvis filnavn handler om penge.
  { reason: "penge", re: /^backend\/(.*\/)?[^/]*(econom|financ|salar|prize|sponsor|loan|payout|price|pricing|payment|wallet|budget|debt|auction|bid)[^/]*$/i },
  // Auth/sikkerhed: backend + frontend-lib (login, tokens, admin-adgang, RLS/grants).
  { reason: "auth", re: /^(backend|frontend\/src\/lib)\/(.*\/)?[^/]*(auth(?!or)|token|security|rls|grant|permission|urlSafety|admin)[^/]*$/i },
]);

const norm = (p) => String(p || "").replace(/\\/g, "/").replace(/^\.\//, "");
const login = (l) => String(l || "").replace(/\[bot\]$/i, "").toLowerCase();

/** @returns {string|null} hoejrisiko-grunden for en fil, ellers null. Tests er aldrig hoejrisiko. */
export function classifyFile(path) {
  const p = norm(path);
  // Workflows er altid hoejrisiko; tests ellers aldrig (de aendrer ingen prod-adfaerd).
  if (TEST_FILE_RE.test(p) && !p.startsWith(".github/")) return null;
  for (const rule of HIGH_RISK_RULES) if (rule.re.test(p)) return rule.reason;
  return null;
}

/** @returns {{level: "high"|"low", reasons: string[]}} */
export function classifyRisk(files = [], labels = []) {
  const reasons = [];
  for (const label of labels) {
    if (HIGH_RISK_LABELS.includes(String(label).toLowerCase())) reasons.push(`label ${label}`);
  }
  for (const file of files) {
    const why = classifyFile(file);
    if (why) reasons.push(`${why}: ${norm(file)}`);
  }
  return { level: reasons.length > 0 ? "high" : "low", reasons };
}

// ── Codex ──────────────────────────────────────────────────────────────────

/**
 * Laeser Codex' "Review Summary"-kommentar (tabel: Review | Status | Commit | trigger).
 * @returns {{state: "completed"|"pending"|"failed"|"unknown", commit: string|null}}
 */
export function parseCodexSummary(body) {
  const text = String(body || "");
  if (!text.includes(CODEX_SUMMARY_MARKER)) return { state: "unknown", commit: null };
  const rows = text.split(/\r?\n/)
    .filter((l) => l.trim().startsWith("|"))
    .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()))
    .filter((cells) => cells.length >= 3 && !/^-+$/.test(cells[0]) && !/^review$/i.test(cells[0]));
  if (rows.length === 0) return { state: "unknown", commit: null };
  const states = rows.map((cells) => {
    const s = cells[1];
    if (/in progress|running|queued|pending|started|reviewing/i.test(s)) return "pending";
    if (/completed|done|finished/i.test(s)) return "completed";
    return "failed";
  });
  const commit = (rows[rows.length - 1][2] || "").match(/[0-9a-f]{7,40}/i)?.[0] || null;
  const state = states.includes("pending") ? "pending" : states.includes("completed") ? "completed" : "failed";
  return { state, commit };
}

/**
 * @param {{comments?: object[], reviews?: object[], reactions?: object[], threads?: object[]}} input
 *   comments/reviews: {author, body}; reactions: {author, content}; threads: {author, isResolved}
 * @returns {{ok: boolean, state: string, unresolved: number, detail: string}}
 */
export function evaluateCodex({ comments = [], reviews = [], reactions = [], threads = [] } = {}) {
  const isCodex = (x) => login(x.author) === CODEX_LOGIN;
  const unresolved = threads.filter((t) => isCodex(t) && !t.isResolved).length;
  const summary = comments.filter(isCodex).map((c) => parseCodexSummary(c.body)).find((s) => s.state !== "unknown");
  let state = summary ? summary.state : "missing";
  if (state !== "pending" && state !== "completed") {
    const reviewed = reviews.some(isCodex) || reactions.some((r) => isCodex(r) && r.content === "+1");
    if (reviewed) state = "completed";
  }
  if (unresolved > 0) {
    return { ok: false, state, unresolved, detail: `${unresolved} uloest(e) Codex-fund: ret dem og marker traaden "Resolve conversation"` };
  }
  if (state === "completed") {
    return { ok: true, state, unresolved, detail: `Codex-review gennemfoert${summary?.commit ? ` (commit ${summary.commit})` : ""}, ingen uloeste fund` };
  }
  if (state === "pending") return { ok: false, state, unresolved, detail: "Codex-review koerer stadig" };
  if (state === "failed") return { ok: false, state, unresolved, detail: "Codex-review fejlede: kommenter `@codex review` paa PR'en" };
  return { ok: false, state, unresolved, detail: "intet Codex-review endnu: marker PR'en ready, eller kommenter `@codex review`" };
}

// ── Claude ─────────────────────────────────────────────────────────────────

/**
 * Seneste Claude-review-markoer fra en betroet konto.
 * @param {Array<{author?: string, association?: string, body?: string, at?: string}>} items
 * @returns {{verdict: "clean"|"notes"|"blocking", sha: string|null, at: string|null}|null}
 */
export function findClaudeVerdict(items = []) {
  let best = null;
  for (const item of items) {
    if (!TRUSTED_ASSOCIATIONS.includes(String(item.association || "").toUpperCase())) continue;
    const m = String(item.body || "").match(CLAUDE_MARKER_RE);
    if (!m) continue;
    const at = item.at || null;
    if (!best || String(at || "") >= String(best.at || "")) {
      best = { verdict: m[1].toLowerCase(), sha: m[2] ? m[2].toLowerCase() : null, at };
    }
  }
  return best;
}

export function evaluateClaude(items, risk) {
  if (risk.level !== "high") return { required: false, ok: true, verdict: null, detail: "ikke paakraevet (lav risiko)" };
  const found = findClaudeVerdict(items);
  if (!found) {
    return { required: true, ok: false, verdict: null, detail: "hoejrisiko: mangler Claude-review-markoer (`node scripts/review-gate.mjs post-claude-review --pr N --verdict clean`)" };
  }
  if (found.verdict === "blocking") return { required: true, ok: false, verdict: found.verdict, detail: "Claude-review har blokerende fund" };
  return { required: true, ok: true, verdict: found.verdict, detail: `Claude-review: ${found.verdict}${found.sha ? ` (commit ${found.sha.slice(0, 7)})` : ""}` };
}

/** Selve gaten. Input er normaliseret PR-data (se fetchPrData). */
export function evaluateGate({ author, draft = false, files = [], labels = [], comments = [], reviews = [], reactions = [], threads = [] }) {
  const risk = classifyRisk(files, labels);
  if (EXEMPT_AUTHORS.includes(login(author))) {
    return { ok: true, risk, exempt: true, codex: null, claude: null, summary: `undtaget: ${author} (rule 35 c - CI + dependency-review er gaten)` };
  }
  if (draft) {
    return { ok: false, risk, exempt: false, codex: null, claude: null, summary: "draft: gaten evalueres naar PR'en er ready" };
  }
  const codex = evaluateCodex({ comments, reviews, reactions, threads });
  const claude = evaluateClaude([...comments, ...reviews], risk);
  const ok = codex.ok && claude.ok;
  const summary = `${ok ? "OK" : "BLOKERET"} (${risk.level === "high" ? "hoejrisiko" : "lav risiko"}): Codex - ${codex.detail}; Claude - ${claude.detail}`;
  return { ok, risk, exempt: false, codex, claude, summary };
}

export function formatReport(result, pr) {
  const lines = [
    `## review-gate: ${result.ok ? "groen" : "roed"} (PR #${pr})`,
    "",
    `- Risiko: **${result.risk.level === "high" ? "hoej" : "lav"}**`,
    ...result.risk.reasons.slice(0, 15).map((r) => `  - ${r}`),
    ...(result.risk.reasons.length > 15 ? [`  - ... og ${result.risk.reasons.length - 15} flere`] : []),
  ];
  if (result.exempt || !result.codex) {
    lines.push(`- ${result.summary}`);
  } else {
    lines.push(`- Codex (alle PR'er): ${result.codex.ok ? "ok" : "mangler"} - ${result.codex.detail}`);
    lines.push(`- Claude (kun hoejrisiko): ${result.claude.ok ? "ok" : "mangler"} - ${result.claude.detail}`);
    lines.push("- CodeRabbit: valgfri bonus, aldrig et krav.");
  }
  return lines.join("\n");
}

export function buildClaudeMarkerComment(verdict, sha, note = "") {
  const v = String(verdict || "").toLowerCase();
  if (!["clean", "notes", "blocking"].includes(v)) throw new Error(`ukendt verdict "${verdict}" (clean|notes|blocking)`);
  const shaPart = sha && /^[0-9a-f]{7,40}$/i.test(sha) ? ` sha=${sha.toLowerCase()}` : "";
  const human = { clean: "ingen fund", notes: "bemaerkninger, intet blokerende", blocking: "BLOKERENDE fund" }[v];
  return [`<!-- claude-review: ${v}${shaPart} -->`, `**Claude-review:** ${human}${sha ? ` (commit \`${sha.slice(0, 7)}\`)` : ""}.`, note ? `\n${note}` : ""]
    .join("\n").trim();
}

// ── Escaped defects (maanedlig opfoelgning) ─────────────────────────────────

/** PR-numre fra "Indfoert af: #123" / "Introduced by #123" i issue-tekst. */
export function parseIntroducedBy(text) {
  const out = new Set();
  const re = /(?:indf(?:oe|ø)rt\s+af|introduced\s+by)\s*:?([^\n]*)/gi;
  for (const m of String(text || "").matchAll(re)) {
    for (const n of m[1].matchAll(/#(\d+)/g)) out.add(Number(n[1]));
  }
  return [...out].sort((a, b) => a - b);
}

/** Hvilke reviewere saa PR'en, og hvor mange fund (traade) postede de. */
export function reviewersOnPr(pr) {
  const seen = { codex: 0, claude: 0, coderabbit: 0 };
  const touched = new Set();
  for (const t of pr.threads || []) {
    const l = login(t.author);
    if (l === CODEX_LOGIN) { seen.codex += 1; touched.add("codex"); }
    if (l === CODERABBIT_LOGIN) { seen.coderabbit += 1; touched.add("coderabbit"); }
  }
  for (const c of [...(pr.comments || []), ...(pr.reviews || [])]) {
    const l = login(c.author);
    if (l === CODEX_LOGIN) touched.add("codex");
    if (l === CODERABBIT_LOGIN) touched.add("coderabbit");
    const m = String(c.body || "").match(CLAUDE_MARKER_RE);
    if (m && TRUSTED_ASSOCIATIONS.includes(String(c.association || "").toUpperCase())) {
      touched.add("claude");
      if (m[1].toLowerCase() !== "clean") seen.claude += 1;
    }
  }
  return { touched: [...touched].sort(), findings: seen };
}

/**
 * @param {{prs: object[], escaped: Array<{issue: number, prs: number[]}>, introducing: object[]}} input
 * @returns {Record<string, {reviewedPrs: number, findings: number, missed: number, missedIssues: number[]}>}
 */
export function tallyReviewerStats({ prs = [], escaped = [], introducing = [] }) {
  const stats = {};
  for (const name of ["codex", "claude", "coderabbit"]) stats[name] = { reviewedPrs: 0, findings: 0, missed: 0, missedIssues: [] };
  for (const pr of prs) {
    const r = reviewersOnPr(pr);
    for (const name of r.touched) stats[name].reviewedPrs += 1;
    for (const [name, n] of Object.entries(r.findings)) stats[name].findings += n;
  }
  const byNumber = new Map([...introducing, ...prs].map((p) => [p.number, p]));
  for (const defect of escaped) {
    for (const prNumber of defect.prs) {
      const pr = byNumber.get(prNumber);
      if (!pr) continue;
      for (const name of reviewersOnPr(pr).touched) {
        stats[name].missed += 1;
        if (!stats[name].missedIssues.includes(defect.issue)) stats[name].missedIssues.push(defect.issue);
      }
    }
  }
  return stats;
}

export function formatEscapedReport({ since, until, stats, escaped, mergedCount }) {
  const lines = [
    `## Review-gate: escaped defects ${since} -> ${until}`,
    "",
    `Mergede PR'er i perioden: ${mergedCount}. Issues med label \`${ESCAPED_DEFECT_LABEL}\`: ${escaped.length}` +
      ` (heraf uden "Indfoert af #PR": ${escaped.filter((e) => e.prs.length === 0).length}).`,
    "",
    "| Reviewer | PR'er reviewet | Fund postet | Slap igennem (fejl paa PR den reviewede) |",
    "| --- | ---: | ---: | --- |",
  ];
  for (const [name, s] of Object.entries(stats)) {
    const issues = s.missedIssues.length ? ` (${s.missedIssues.map((n) => `#${n}`).join(", ")})` : "";
    lines.push(`| ${name} | ${s.reviewedPrs} | ${s.findings} | ${s.missed}${issues} |`);
  }
  return lines.join("\n");
}

// ── gh-lim (kun I/O) ───────────────────────────────────────────────────────

function gh(args, { input } = {}) {
  return execFileSync("gh", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}
function ghLines(path) {
  const out = gh(["api", "--paginate", path, "--jq", ".[] | tojson"]).trim();
  return out ? out.split(/\r?\n/).map((l) => JSON.parse(l)) : [];
}
function ghJson(args) {
  return JSON.parse(gh(args));
}

function fetchThreads(repo, pr) {
  const [owner, name] = repo.split("/");
  const threads = [];
  let cursor = null;
  for (let page = 0; page < 20; page += 1) {
    const q = `query($o:String!,$n:String!,$pr:Int!,$c:String){repository(owner:$o,name:$n){pullRequest(number:$pr){reviewThreads(first:100,after:$c){pageInfo{hasNextPage endCursor} nodes{isResolved comments(first:1){nodes{author{login}}}}}}}}`;
    const args = ["api", "graphql", "-f", `query=${q}`, "-f", `o=${owner}`, "-f", `n=${name}`, "-F", `pr=${pr}`];
    if (cursor) args.push("-f", `c=${cursor}`);
    const conn = ghJson(args).data.repository.pullRequest.reviewThreads;
    for (const t of conn.nodes) threads.push({ isResolved: t.isResolved, author: t.comments.nodes[0]?.author?.login || "" });
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return threads;
}

export function fetchPrData(repo, pr) {
  const meta = ghJson(["api", `repos/${repo}/pulls/${pr}`]);
  const files = ghLines(`repos/${repo}/pulls/${pr}/files?per_page=100`).map((f) => f.filename);
  const comments = ghLines(`repos/${repo}/issues/${pr}/comments?per_page=100`)
    .map((c) => ({ author: c.user?.login, association: c.author_association, body: c.body, at: c.updated_at || c.created_at }));
  const reviews = ghLines(`repos/${repo}/pulls/${pr}/reviews?per_page=100`)
    .map((r) => ({ author: r.user?.login, association: r.author_association, body: r.body, at: r.submitted_at }));
  const reactions = ghLines(`repos/${repo}/issues/${pr}/reactions?per_page=100`)
    .map((r) => ({ author: r.user?.login, content: r.content }));
  return {
    number: pr,
    author: meta.user?.login,
    draft: Boolean(meta.draft),
    headSha: meta.head?.sha,
    labels: (meta.labels || []).map((l) => l.name),
    files, comments, reviews, reactions,
    threads: fetchThreads(repo, pr),
  };
}

/** Genkoer seneste pull_request-koersel af gaten for PR'ens HEAD (check'et opdateres paa stedet). */
function rerunGate(repo, pr) {
  const meta = ghJson(["api", `repos/${repo}/pulls/${pr}`]);
  if (meta.state !== "open" || meta.draft) return `#${pr}: springes over (${meta.state}${meta.draft ? ", draft" : ""})`;
  const runs = ghJson(["api", `repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?event=pull_request&head_sha=${meta.head.sha}&per_page=20`]).workflow_runs || [];
  const run = runs.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  if (!run) return `#${pr}: ingen pull_request-koersel for ${meta.head.sha.slice(0, 7)} endnu`;
  if (run.status !== "completed") return `#${pr}: koersel ${run.id} koerer allerede`;
  if (run.conclusion === "success") return `#${pr}: allerede groen (${run.id})`;
  try {
    gh(["api", "-X", "POST", `repos/${repo}/actions/runs/${run.id}/rerun`]);
    return `#${pr}: genkoert ${run.id}`;
  } catch (err) {
    return `#${pr}: genkoersel fejlede (${String(err.stderr || err.message).trim().split("\n")[0]})`;
  }
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = true;
      else { out[key] = next; i += 1; }
    } else out._.push(a);
  }
  return out;
}

function writeSummary(text) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

function isoDate(d) { return d.toISOString().slice(0, 10); }

// Een GraphQL-soegning pr. 25 PR'er (REST pr. PR ville sprenge GITHUB_TOKEN's timekvote).
const PR_REVIEW_FIELDS = "number comments(last:100){nodes{author{login} authorAssociation body}} " +
  "reviews(last:100){nodes{author{login} authorAssociation body}} " +
  "reviewThreads(first:100){nodes{isResolved comments(first:1){nodes{author{login}}}}}";

function toReviewShape(node) {
  const items = (conn) => (conn?.nodes || []).map((c) => ({ author: c.author?.login || "", association: c.authorAssociation, body: c.body }));
  return {
    number: node.number,
    comments: items(node.comments),
    reviews: items(node.reviews),
    threads: (node.reviewThreads?.nodes || []).map((t) => ({ isResolved: t.isResolved, author: t.comments.nodes[0]?.author?.login || "" })),
  };
}

function searchPrsForReport(searchQuery) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < 40; page += 1) {
    const q = `query($q:String!,$c:String){search(query:$q,type:ISSUE,first:25,after:$c){pageInfo{hasNextPage endCursor} nodes{... on PullRequest{${PR_REVIEW_FIELDS}}}}}`;
    const args = ["api", "graphql", "-f", `query=${q}`, "-f", `q=${searchQuery}`];
    if (cursor) args.push("-f", `c=${cursor}`);
    const conn = ghJson(args).data.search;
    for (const node of conn.nodes) if (node && node.number) out.push(toReviewShape(node));
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return out;
}

function escapedReport(repo, since, until) {
  const escapedIssues = ghJson(["issue", "list", "--repo", repo, "--label", ESCAPED_DEFECT_LABEL, "--state", "all", "--limit", "200",
    "--search", `created:${since}..${until}`, "--json", "number,body,comments"]);
  const escaped = escapedIssues.map((i) => ({
    issue: i.number,
    prs: parseIntroducedBy([i.body, ...(i.comments || []).map((c) => c.body)].join("\n")),
  }));
  const prs = searchPrsForReport(`repo:${repo} is:pr is:merged merged:${since}..${until}`);
  const have = new Set(prs.map((p) => p.number));
  const missing = [...new Set(escaped.flatMap((e) => e.prs))].filter((n) => !have.has(n));
  const introducing = [];
  const [owner, name] = repo.split("/");
  for (let i = 0; i < missing.length; i += 10) {
    const chunk = missing.slice(i, i + 10);
    const fields = chunk.map((n) => `p${n}:pullRequest(number:${Number(n)}){${PR_REVIEW_FIELDS}}`).join(" ");
    const q = `query($o:String!,$n:String!){repository(owner:$o,name:$n){${fields}}}`;
    let repoData = {};
    try {
      repoData = ghJson(["api", "graphql", "-f", `query=${q}`, "-f", `o=${owner}`, "-f", `n=${name}`]).data.repository || {};
    } catch (err) {
      console.error(`escaped-report: kunne ikke hente ${chunk.map((n) => `#${n}`).join(" ")} (${String(err.message).split("\n")[0]})`);
    }
    for (const node of Object.values(repoData)) if (node && node.number) introducing.push(toReviewShape(node));
  }
  const stats = tallyReviewerStats({ prs, escaped, introducing });
  return formatEscapedReport({ since, until, stats, escaped, mergedCount: prs.length });
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  const repo = typeof args.repo === "string" ? args.repo : process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  const pr = Number(args.pr);

  if (cmd === "evaluate") {
    if (!Number.isInteger(pr) || pr <= 0) { console.error("--pr <N> kraeves"); return 2; }
    const data = fetchPrData(repo, pr);
    const result = evaluateGate(data);
    const report = formatReport(result, pr);
    console.log(report);
    writeSummary(report);
    if (args.json) console.log(JSON.stringify(result));
    return result.ok ? 0 : 1;
  }

  if (cmd === "post-claude-review") {
    if (!Number.isInteger(pr) || pr <= 0) { console.error("--pr <N> kraeves"); return 2; }
    const head = ghJson(["api", `repos/${repo}/pulls/${pr}`]).head.sha;
    const body = buildClaudeMarkerComment(args.verdict, head, typeof args.note === "string" ? args.note : "");
    gh(["pr", "comment", String(pr), "--repo", repo, "--body-file", "-"], { input: body });
    console.log(`Claude-review-markoer (${args.verdict}) skrevet paa #${pr}. Gaten genkoeres af workflowet.`);
    return 0;
  }

  if (cmd === "refresh") {
    const prs = Number.isInteger(pr) && pr > 0
      ? [pr]
      : ghJson(["pr", "list", "--repo", repo, "--state", "open", "--limit", "100", "--json", "number,isDraft"])
        .filter((p) => !p.isDraft).map((p) => p.number);
    for (const n of prs) console.log(rerunGate(repo, n));
    return 0;
  }

  if (cmd === "escaped-report") {
    const now = new Date();
    const until = typeof args.until === "string" ? args.until : isoDate(now);
    const since = typeof args.since === "string" ? args.since : isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
    const report = escapedReport(repo, since, until);
    console.log(report);
    writeSummary(report);
    return 0;
  }

  console.error("Brug: review-gate.mjs evaluate|post-claude-review|refresh|escaped-report [--pr N] (se filens header)");
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.error(`review-gate: ${err.stderr || err.message}`);
    process.exitCode = 1;
  }
}
