#!/usr/bin/env node
// PR-paastands-tjek (#5507) - holder PR-bodyens paastande op mod KODEN, ikke
// mod anden tekst. Koeres deterministisk FOER LLM-reviewet.
//
// FEJLKLASSEN (alle tre kom igennem review):
//   - PR #5501 paastod en `?bestRole=`-parameter paa preview. Den findes kun i
//     preview-mocken (frontend/src/preview/installPreviewMock.js, indlaeses kun
//     med VITE_PREVIEW_MOCK). Rettelsen ("findes ikke i koden") var OGSAA forkert.
//   - PR #5503 beskrev en kontakt (`primaryTypeMode` + en *_FLAG_KEY) som intet
//     kaldested sendte eller laeste.
//   - PR #5446 indfoerte en model-kontakt som tre produktions-laesere gik udenom
//     (de indlaeste model-filen direkte).
//
// HVAD DEN TRAEKKER UD AF BODYEN
//   param     `?navn=` / `&navn=` (ogsaa i links til preview/prod)
//   kontakt   app_config-noegler (STAGE_FLAGS, noegler en migration opretter,
//             `export const *_KEY = "..."`), *_FLAG_KEY-konstanter og camelCase
//             opts-felter paa en linje der taler om kontakt/flag/opts
//   sti       filstier og filnavne (`backend/lib/x.js`, `x.test.js`, globs)
//   endpoint  `GET /api/...` og `/api/...`
//   env       VITE_*/SUPABASE_*/... og `process.env.X` / `import.meta.env.X`
//   konstant  oevrige SCREAMING_CASE-navne i backticks
//
// SVAR PR. PAASTAND (slaaet op i diffens tilfoejede linjer, i main og i
// PR-headens trae):
//   findes | findes-ikke | kun-mock-preview | kun-test | gitignoreret | slettet-i-diffen
// Kontakter faar desuden en liste over ALLE kaldesteder i produktionskode, og
// en liste over produktionsfiler der laeser kontaktens data-fil udenom den.
//
// ADVARSLER (exit 1): noget der kun findes i mock-preview, en kontakt uden
// kaldested, en kontakt som produktionskode gaar udenom. Oevrige "findes-ikke"
// er BEMAERKNINGER (en body maa gerne sige "X findes ikke"). Vagten er
// advarsel-foerst: .github/workflows/done-guard.yml koerer den med
// continue-on-error.
//
// BRUG
//   node scripts/check-pr-claims.mjs --pr <N>                    (gh + git fetch)
//   node scripts/check-pr-claims.mjs --pr <N> --body-file <f>    (en aeldre body)
//   node scripts/check-pr-claims.mjs --body-file <f> --base origin/main --head HEAD
//   ... [--diff-file <f>] [--json] [--markdown <out.md>]
//
// Refs #5507.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildIndex, classifyPath, findReaders, loadRepoFiles, loadTreeFiles, parseStageFlagKeys, CATALOG_PATH } from "./check-flag-liveness.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLAIM_DIRS = Object.freeze(["backend", "frontend", "database", "shared", "api", "scripts", ".github"]);
const PATH_EXT = "js|mjs|cjs|jsx|ts|tsx|sql|json|md|yml|yaml|ps1|sh|css|html|toml";
const PATH_RE = new RegExp(`(?:^|[\\s\`'"(|])((?:\\.{0,2}/)?(?:[\\w@*.-]+/)+[\\w@*.-]+\\.(?:${PATH_EXT}))(?::\\d+)?(?=$|[\\s\`'"),.;:|])`, "g");
const BARE_FILE_RE = new RegExp(`^[\\w@*.-]+\\.(?:${PATH_EXT})$`);
const APP_HOST = /(?:vercel\.app|cyclingzone\.org|localhost|127\.0\.0\.1)/i;
const ENV_PREFIX = /^(?:VITE|SUPABASE|RAILWAY|VERCEL|NODE|SENTRY|RESEND|ALUNTA|DISCORD|GITHUB|ANTHROPIC|OPENAI|INFISICAL|DATABASE|PG|CZ)_/;
const SWITCH_CONTEXT = /kontakt|switch|flag|toggle|opts|option|app_config|n(?:oe|ø)gle/i;
export const VERDICTS = Object.freeze(["findes", "findes-ikke", "kun-mock-preview", "kun-test", "gitignoreret", "slettet-i-diffen"]);

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Fjern det der ikke er PR-forfatterens paastande: CodeRabbits auto-summary,
 * HTML-kommentarer og billed-links.
 */
export function cleanBody(body) {
  return String(body || "")
    .replace(/<!-- This is an auto-generated comment[\s\S]*?<!-- end of auto-generated comment[^>]*-->/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "");
}

/**
 * Traek paastandene ud. Rent tekstarbejde - klassifikationen af snake_case som
 * kontakt kraever repoets noegle-liste (knownKeys).
 * @param {string} body
 * @param {Set<string>} knownKeys
 * @returns {Array<{type: string, value: string, line: string}>}
 */
export function extractClaims(body, knownKeys = new Set()) {
  const text = cleanBody(body);
  const claims = [];
  const seen = new Set();
  const add = (type, value, line) => {
    const k = `${type}:${value}`;
    if (!value || seen.has(k)) return;
    seen.add(k);
    claims.push({ type, value, line: String(line || "").trim().slice(0, 200) });
  };

  for (const rawLine of text.split(/\r?\n/)) {
    // Links: parametre i links til appen taeller; resten af URL'en er ikke en paastand om koden.
    let line = rawLine;
    for (const m of rawLine.matchAll(/https?:\/\/[^\s)>\]`]+/g)) {
      if (APP_HOST.test(m[0])) for (const p of m[0].matchAll(/[?&]([A-Za-z][\w-]*)=/g)) add("param", p[1], rawLine);
      line = line.replace(m[0], " ");
    }
    for (const p of line.matchAll(/[?&]([A-Za-z][\w-]*)=/g)) add("param", p[1], rawLine);

    for (const m of line.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+`?(\/api\/[\w/:.{}-]+)/g)) add("endpoint", m[2].replace(/[.,]+$/, ""), rawLine);
    for (const m of line.matchAll(/`(\/api\/[\w/:.{}-]+)`/g)) add("endpoint", m[1], rawLine);

    for (const m of line.matchAll(PATH_RE)) {
      if (!m[1].includes("://") && !m[1].startsWith("/api/")) add("sti", m[1].replace(/^\.\//, ""), rawLine);
    }

    for (const m of line.matchAll(/\b(?:process\.env|import\.meta\.env)\.([A-Z][A-Z0-9_]*)/g)) add("env", m[1], rawLine);
    for (const m of line.matchAll(/\b(VITE_[A-Z0-9_]+)\b/g)) add("env", m[1], rawLine);

    const spans = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    for (const span of spans) {
      for (const tok of span.split(/[\s=(),:;'"<>[\]{}]+/).filter(Boolean)) {
        const t = tok.replace(/^[.?&]+|[.?]+$/g, "");
        if (BARE_FILE_RE.test(t)) {
          add("sti", t, rawLine);
          continue;
        }
        for (const part of t.split(".")) {
          if (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(part)) {
            if (/_FLAG_KEY$/.test(part)) add("kontakt", part, rawLine);
            else if (ENV_PREFIX.test(part)) add("env", part, rawLine);
            else add("konstant", part, rawLine);
          } else if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(part)) {
            if (knownKeys.has(part) || SWITCH_CONTEXT.test(rawLine)) add("kontakt", part, rawLine);
          } else if (/^[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*$/.test(part) && SWITCH_CONTEXT.test(rawLine) && !/\(\)$/.test(tok)) {
            add("kontakt", part, rawLine);
          }
        }
      }
    }
    // Kendte noegler uden backticks (fx i en SQL-kodeblok i bodyen).
    for (const m of line.matchAll(/(?<![\w$])([a-z][a-z0-9]*(?:_[a-z0-9]+)+)(?![\w$])/g)) {
      if (knownKeys.has(m[1])) add("kontakt", m[1], rawLine);
    }
  }
  return claims;
}

/**
 * Parse en unified diff: fil -> status + tilfoejede linjer.
 * @returns {Map<string, {status: string, added: string[]}>}
 */
export function parseDiff(diffText) {
  const files = new Map();
  let cur = null;
  for (const line of String(diffText || "").split(/\r?\n/)) {
    const head = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (head) {
      cur = { status: "modified", added: [] };
      files.set(head[2], cur);
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("new file mode")) cur.status = "added";
    else if (line.startsWith("deleted file mode")) cur.status = "deleted";
    else if (line.startsWith("rename from")) cur.status = "renamed";
    else if (line.startsWith("+") && !line.startsWith("+++")) cur.added.push(line.slice(1));
  }
  return files;
}

/** Noegler repoet kender som app_config-kontakter. */
export function knownKeysFrom(index, catalogPath = CATALOG_PATH) {
  const keys = new Set();
  const catalog = index.byPath.get(catalogPath);
  for (const k of parseStageFlagKeys(catalog ? catalog.text : "")) keys.add(k);
  for (const f of index.files) {
    if (f.kind === "sql" && /insert\s+into\s+(?:public\.)?app_config\b/i.test(f.text)) {
      for (const m of f.text.matchAll(/\(\s*'([a-z][a-z0-9]*(?:_[a-z0-9]+)+)'/g)) keys.add(m[1]);
    }
    if (f.kind === "prod") {
      for (const m of f.text.matchAll(/export\s+const\s+[A-Z][A-Z0-9_]*_KEY\s*=\s*["']([a-z][a-z0-9]*(?:_[a-z0-9]+)+)["']/g)) keys.add(m[1]);
    }
  }
  return keys;
}

function kindsOf(paths) {
  const kinds = new Set(paths.map((p) => classifyPath(p)));
  return kinds;
}

function verdictFromHits(paths, { prodKinds = ["prod"] } = {}) {
  const kinds = kindsOf(paths);
  if (prodKinds.some((k) => kinds.has(k))) return "findes";
  if (kinds.has("mock")) return "kun-mock-preview";
  if (kinds.has("test")) return "kun-test";
  return paths.length > 0 ? "findes" : "findes-ikke";
}

function filesMatching(index, predicate) {
  return index.files.filter((f) => predicate(f)).map((f) => f.path);
}

function diffMatches(diff, re) {
  const out = [];
  for (const [path, f] of diff) if (f.added.some((l) => re.test(l))) out.push(path);
  return out;
}

/**
 * Slaa een paastand op. Rent over to indekser (main + PR-head) og diffen.
 */
export function lookupClaim(claim, ctx) {
  const { head, base, diff, headPaths, basePaths, isIgnored } = ctx;
  const res = { ...claim, verdict: "findes-ikke", inDiff: false, onMain: false, where: [] };

  if (claim.type === "sti") {
    const v = claim.value.replace(/\\/g, "/");
    const re = v.includes("/")
      ? new RegExp(`^${v.split("*").map(escapeRe).join("[^/]*")}$`)
      : new RegExp(`(^|/)${v.split("*").map(escapeRe).join("[^/]*")}$`);
    const inHead = [...headPaths].filter((p) => re.test(p));
    const inBase = [...basePaths].filter((p) => re.test(p));
    const touched = [...diff.keys()].filter((p) => re.test(p));
    res.inDiff = touched.length > 0;
    res.onMain = inBase.length > 0;
    res.where = [...new Set([...inHead, ...inBase])].slice(0, 5);
    if (inHead.length > 0) res.verdict = "findes";
    else if (touched.some((p) => diff.get(p).status === "deleted")) res.verdict = "slettet-i-diffen";
    else if (isIgnored && isIgnored(v)) res.verdict = "gitignoreret";
    else res.verdict = "findes-ikke";
    return res;
  }

  let re;
  let pick;
  if (claim.type === "param") {
    re = new RegExp(`["'\`]${escapeRe(claim.value)}["'\`]|[?&]${escapeRe(claim.value)}=`);
    pick = (f) => f.kind !== "sql" && f.kind !== "docs" && re.test(f.text);
  } else if (claim.type === "endpoint") {
    const suffix = claim.value.replace(/^\/api/, "");
    re = new RegExp(`["'\`](?:/api)?${escapeRe(suffix)}["'\`]`);
    pick = (f) => re.test(f.text) && (f.kind !== "prod" || f.path.startsWith("backend/") || f.kind === "mock");
  } else {
    re = new RegExp(`(?<![\\w$])${escapeRe(claim.value)}(?![\\w$])`);
    pick = (f) => f.kind !== "docs" && (f.tokens ? f.tokens.has(claim.value) : re.test(f.text));
  }
  const headHits = filesMatching(head, pick);
  const baseHits = filesMatching(base, pick);
  res.inDiff = diffMatches(diff, re).length > 0;
  res.onMain = baseHits.length > 0;
  const all = [...new Set([...headHits])];
  res.where = all.slice(0, 8);
  const prodKinds = claim.type === "env" ? ["prod", "script", "other"] : ["prod"];
  res.verdict = verdictFromHits(all, { prodKinds });
  if (claim.type === "endpoint" && res.verdict === "findes-ikke") {
    const callers = filesMatching(head, (f) => f.kind === "prod" && f.text.includes(claim.value));
    if (callers.length > 0) res.note = `kaldes fra ${callers.slice(0, 3).join(", ")}, men ingen backend-route definerer den`;
  }

  if (claim.type === "kontakt") {
    let key = claim.value;
    if (/_FLAG_KEY$|_KEY$/.test(key)) {
      const def = head.files.map((f) => new RegExp(`\\bconst\\s+${escapeRe(key)}\\s*=\\s*["']([a-z0-9_]+)["']`).exec(f.text)).find(Boolean);
      if (def) key = def[1];
    }
    res.key = key;
    res.isNew = !base.files.some((f) => f.tokens && (f.tokens.has(claim.value) || f.tokens.has(key)));
    if (/^[a-z0-9_]+$/.test(key)) {
      const r = findReaders(key, head);
      res.callSites = r.readers;
      res.homes = r.homes;
      res.bypass = bypassReaders(key, r, head);
    } else {
      // camelCase opts-felt: kaldesteder = produktionsfiler der naevner det.
      const prod = headHits.filter((p) => classifyPath(p) === "prod");
      res.homes = prod.slice(0, 1);
      res.callSites = prod.slice(1);
      res.bypass = [];
    }
  }
  return res;
}

/**
 * Produktionsfiler der laeser kontaktens data-fil (*.json) direkte, udenom
 * kontaktens hjemmemodul. PR #5446: model-kontakten valgte mellem to JSON-
 * modeller, men tre filer indlaeste den gamle model selv.
 */
export function bypassReaders(key, readerInfo, index) {
  const homes = readerInfo.homes.length > 0 ? readerInfo.homes : readerInfo.mentions;
  const assets = new Set();
  for (const h of homes) {
    const f = index.byPath.get(h);
    if (!f) continue;
    const code = f.text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
    for (const m of code.matchAll(/["'`]([^"'`\s]*?([\w.-]+\.json))["'`]/g)) assets.add(m[2]);
  }
  if (assets.size === 0) return [];
  const out = [];
  for (const f of index.files) {
    if (f.kind !== "prod" || homes.includes(f.path)) continue;
    const code = f.text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
    for (const a of assets) {
      if (new RegExp(`["'\`/]${escapeRe(a)}["'\`]`).test(code)) {
        out.push({ path: f.path, asset: a });
        break;
      }
    }
  }
  return out;
}

/**
 * Hele tjekket. Ren funktion - testene giver fixtures, CLI'en giver git.
 * @param {{body: string, diffText: string, headFiles: Array<{path:string,text:string}>, baseFiles: Array<{path:string,text:string}>, headPaths?: string[], basePaths?: string[], isIgnored?: (p:string)=>boolean}} input
 */
export function checkClaims(input) {
  const head = buildIndex(input.headFiles);
  const base = buildIndex(input.baseFiles);
  const diff = parseDiff(input.diffText);
  const headPaths = new Set(input.headPaths || input.headFiles.map((f) => f.path));
  const basePaths = new Set(input.basePaths || input.baseFiles.map((f) => f.path));
  const knownKeys = knownKeysFrom(head);
  for (const k of knownKeysFrom(base)) knownKeys.add(k);
  const claims = extractClaims(input.body, knownKeys);
  const ctx = { head, base, diff, headPaths, basePaths, isIgnored: input.isIgnored };
  const results = claims.map((c) => lookupClaim(c, ctx));

  const warnings = [];
  const notices = [];
  for (const r of results) {
    if (r.verdict === "kun-mock-preview") {
      warnings.push(`${r.type} "${r.value}" findes kun i preview-mocken (${r.where.filter((p) => classifyPath(p) === "mock").join(", ")}; aktiv kun med VITE_PREVIEW_MOCK) - virker ikke paa et rigtigt preview eller i prod.`);
    }
    if (r.type === "kontakt") {
      if (r.verdict === "findes-ikke") notices.push(`kontakt "${r.value}" findes ikke i koden.`);
      else if ((r.callSites || []).length === 0) warnings.push(`kontakt "${r.value}"${r.key !== r.value ? ` (${r.key})` : ""} har intet kaldested/ingen laeser i produktionskode uden for ${(r.homes || []).join(", ") || "sin definition"}.`);
      if ((r.bypass || []).length > 0) {
        warnings.push(`kontakt "${r.value}": ${r.bypass.length} produktionsfil(er) laeser ${[...new Set(r.bypass.map((b) => b.asset))].join(", ")} udenom kontakten: ${r.bypass.map((b) => b.path).join(", ")}.`);
      }
    }
    if (r.verdict === "kun-test") notices.push(`${r.type} "${r.value}" findes kun i tests.`);
    if (r.verdict === "findes-ikke" && r.type !== "kontakt" && r.type !== "konstant") notices.push(`${r.type} "${r.value}" findes ikke i diffen, i main eller i PR-headen${r.note ? ` (${r.note})` : ""}.`);
    if (r.verdict === "slettet-i-diffen") notices.push(`sti "${r.value}" slettes af denne PR.`);
  }
  return { results, warnings, notices };
}

export function toMarkdown(report, title = "PR-paastands-tjek (#5507)") {
  const lines = [`### ${title}`, ""];
  if (report.warnings.length === 0) lines.push("Ingen advarsler.");
  for (const w of report.warnings) lines.push(`- ADVARSEL: ${w}`);
  for (const n of report.notices) lines.push(`- Bemaerkning: ${n}`);
  lines.push("", "| type | paastand | svar | i diffen | paa main | hvor / kaldesteder |", "|---|---|---|---|---|---|");
  for (const r of report.results) {
    const where = r.type === "kontakt" && r.callSites
      ? `kaldesteder: ${r.callSites.length ? r.callSites.join(", ") : "INGEN"}${r.bypass && r.bypass.length ? `; udenom: ${r.bypass.map((b) => b.path).join(", ")}` : ""}`
      : r.where.slice(0, 3).join(", ");
    lines.push(`| ${r.type} | \`${r.value}\` | ${r.verdict} | ${r.inDiff ? "ja" : "nej"} | ${r.onMain ? "ja" : "nej"} | ${where} |`);
  }
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------- CLI
function git(args, opts = {}) {
  return execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...opts });
}

function hasCommit(ref) {
  try {
    git(["cat-file", "-e", `${ref}^{commit}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function allPaths(ref) {
  if (ref === "WORKTREE") return git(["ls-files", "-z"]).split("\0").filter(Boolean);
  return git(["ls-tree", "-r", "-z", "--name-only", ref]).split("\0").filter(Boolean);
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}

function main(argv) {
  const pr = arg(argv, "--pr");
  let body = null;
  let base = arg(argv, "--base");
  let headRef = arg(argv, "--head");
  let diffText = arg(argv, "--diff-file") ? readFileSync(arg(argv, "--diff-file"), "utf8") : null;

  if (pr) {
    const meta = JSON.parse(execFileSync("gh", ["pr", "view", pr, "--json", "body,baseRefOid,headRefOid"], { encoding: "utf8" }));
    body = meta.body;
    base = base || meta.baseRefOid;
    headRef = headRef || meta.headRefOid;
    if (!hasCommit(headRef)) git(["fetch", "-q", "origin", `refs/pull/${pr}/head`], { stdio: "ignore" });
    if (!hasCommit(base)) git(["fetch", "-q", "origin", base], { stdio: "ignore" });
    if (!diffText) diffText = execFileSync("gh", ["pr", "diff", pr], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  }
  if (arg(argv, "--body-file")) body = readFileSync(arg(argv, "--body-file"), "utf8");
  base = base || "origin/main";
  headRef = headRef || "HEAD";
  if (body === null) {
    console.error("Brug: --pr <N> eller --body-file <fil> [--base <ref>] [--head <ref>|WORKTREE]");
    return 2;
  }
  if (!diffText) diffText = headRef === "WORKTREE" ? git(["diff", "--no-color", base]) : git(["diff", "--no-color", `${base}...${headRef}`]);

  const headFiles = headRef === "WORKTREE" ? loadRepoFiles(ROOT, CLAIM_DIRS) : loadTreeFiles(ROOT, headRef, CLAIM_DIRS);
  const report = checkClaims({
    body,
    diffText,
    headFiles,
    baseFiles: loadTreeFiles(ROOT, base, CLAIM_DIRS),
    headPaths: allPaths(headRef),
    basePaths: allPaths(base),
    isIgnored: (p) => {
      try {
        git(["check-ignore", "-q", "--no-index", p], { stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    },
  });

  if (argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const md = toMarkdown(report, pr ? `PR-paastands-tjek #${pr} (#5507)` : undefined);
    const out = arg(argv, "--markdown");
    if (out) writeFileSync(out, md);
    console.log(md);
    if (process.env.GITHUB_ACTIONS === "true") {
      for (const w of report.warnings) console.log(`::warning title=PR-paastande (#5507)::${w}`);
      for (const n of report.notices) console.log(`::notice title=PR-paastande (#5507)::${n}`);
    }
  }
  return report.warnings.length > 0 ? 1 : 0;
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase();
if (isCli) process.exitCode = main(process.argv.slice(2));
