#!/usr/bin/env node
// scripts/lint-dropped-supabase-error.mjs
// ============================================================
// Forward-guard mod NYE droppede Supabase-fejl i backend-runtime (#2897).
//
// WHY (#2861-rodårsagen, fundet 25/7):
//   supabase-js KASTER ikke. Den returnerer altid `{ data, error }`. Skriver man
//     const { data } = await supabase.from("x").select(...)
//   uden at destrukturere `error` ud, forsvinder fejlen SPORLØST: ingen throw,
//   ingen 500, ingen Sentry-linje, ingen log. Kalder man et endpoint der ikke
//   KAN lykkes, ser man kun symptomet — kalender-siden brændte 8-9 sekunder pr.
//   load på et kald der aldrig kunne returnere data, og ingen opdagede det.
//
//   Fejlklassen har ramt os tre gange (#2861 kalender-perf, #2898 fuld-sim's
//   utjekkede race_results-delete, #2877 tabt etape-berigelse). `lint-swallowed-
//   catches.mjs` fanger den IKKE: den leder efter catch-blokke, og en droppet
//   `error` involverer aldrig en catch — der er ingen exception at fange.
//
// REGEL:
//   En destrukturering af et await'et Supabase-/PostgREST-kald der binder `data`
//   (direkte eller aliaseret) skal OGSÅ binde `error` (direkte eller aliaseret):
//     ✓ const { data, error } = await supabase.from("x").select("*");
//     ✓ const { data: rows, error: rowsErr } = await supabase.from("x").select("*");
//     ✗ const { data } = await supabase.from("x").select("*");
//     ✗ const { data: team } = await supabase.from("teams").select("*").single();
//   Escape-hatch: en markør-kommentar (`// best-effort`, `// error-ok`,
//   `// swallow-ok`) på/omkring statementet der forklarer HVORFOR fejlen
//   bevidst ignoreres.
//
// SCOPE: backend/lib/**/*.js + backend/routes/**/*.js + backend/cron.js
//   (samme runtime-flade som lint-swallowed-catches.mjs efter #2897).
//
// HEURISTIK (regex/AST-let — samme trade-off som de øvrige lint-*.mjs):
//   Strenge + kommentarer blankes til whitespace før scan (delt helper i
//   scripts/lib/js-source-scan.mjs), hvorefter destruktureringsmønsteret
//   brace-matches og højresiden læses frem til statement-enden. Et kald tælles
//   som Supabase når højresiden indeholder en PostgREST-/Supabase-metode
//   (`.from(`, `.rpc(`, `.auth.`, `.storage.`, `.functions.`, `.schema(`).
//   Wrappere der selv returnerer {data,error} kan derfor false-positive'e —
//   det håndteres af baseline-ratchet'en nedenfor.
//
// IKKE dækket (bevidst, for at holde signal/støj-forholdet højt):
//   - `await supabase.from("x").delete()...` HELT uden destrukturering
//     (fire-and-forget mutation). Samme fejlklasse, men et separat og langt
//     større korpus — sporet i #2974/#2898.
//   - `const res = await supabase...; if (res.error)` — property-adgang, ikke
//     destrukturering. Fejlen er der ikke droppet.
//
// Usage:
//   node scripts/lint-dropped-supabase-error.mjs          # check (CI), fail-hard
//   node scripts/lint-dropped-supabase-error.mjs --warn   # rapport-only (exit 0)
//   npm run lint:supabase-error                           # samme som default
//
// Exit codes:
//   0 — ingen net-nye droppede errors (eller --warn)
//   1 — mindst én fil OVER sin baseline
//
// Refs #2897, #2861, #2395.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { blankStringsAndComments, lineAt } from "./lib/js-source-scan.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

// ── Fil-udvælgelse ───────────────────────────────────────────────────────────
export function collectFiles(root = ROOT) {
  const files = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith(".js")) continue;
      if (entry.endsWith(".test.js")) continue; // tests må gerne droppe error
      files.push(full);
    }
  };
  walk(join(root, "backend", "lib"));
  walk(join(root, "backend", "routes"));
  const cron = join(root, "backend", "cron.js");
  if (existsSync(cron)) files.push(cron);
  return files;
}

// Supabase-/PostgREST-signatur i den await'ede højreside.
const SUPABASE_CALL_RE = /\.\s*(?:from|rpc|schema)\s*\(|\.\s*(?:auth|storage|functions)\s*\./;
// Bevidst-ignoreret-markør (samme token-familie som lint-swallowed-catches.mjs).
const MARKER_RE = /best[-\s]?effort|swallow-ok|catch-ok|error-ok/i;
const DECL_RE = /\b(?:const|let|var)\s*\{/g;

// Split et destruktureringsmønster (inkl. yderste tuborg) i top-level nøgler.
// "{ data: rows, error: e }" → ["data", "error"];  "{ data: { user }, error }" → ["data", "error"]
export function topLevelKeys(pattern) {
  const inner = pattern.slice(1, -1);
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (c === "," && depth === 0) { parts.push(inner.slice(start, i)); start = i + 1; }
  }
  parts.push(inner.slice(start));
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const colon = p.indexOf(":");
      const eq = p.indexOf("=");
      if (colon !== -1 && (eq === -1 || colon < eq)) return p.slice(0, colon).trim();
      if (eq !== -1) return p.slice(0, eq).trim();
      return p;
    });
}

// ── Detektion ────────────────────────────────────────────────────────────────
export function findDroppedSupabaseErrors(rawSrc) {
  const src = blankStringsAndComments(rawSrc);
  const findings = [];
  DECL_RE.lastIndex = 0;
  let m;
  while ((m = DECL_RE.exec(src)) !== null) {
    const declStart = m.index;
    const openBrace = declStart + m[0].length - 1;

    // 1) Brace-match destruktureringsmønsteret.
    let depth = 0;
    let p = openBrace;
    for (; p < src.length; p++) {
      if (src[p] === "{") depth++;
      else if (src[p] === "}") { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) continue; // ubalanceret → spring over
    const closeBrace = p;
    const pattern = src.slice(openBrace, closeBrace + 1);

    // 2) Efter mønsteret skal der stå `= await `.
    let q = closeBrace + 1;
    while (q < src.length && /\s/.test(src[q])) q++;
    if (src[q] !== "=" || src[q + 1] === "=" || src[q + 1] === ">") continue;
    q++;
    while (q < src.length && /\s/.test(src[q])) q++;
    if (!/^await\b/.test(src.slice(q, q + 6))) continue;

    // 3) Læs højresiden frem til statement-enden (`;` på dybde 0).
    let rhsEnd = q;
    let d = 0;
    for (; rhsEnd < src.length; rhsEnd++) {
      const c = src[rhsEnd];
      if (c === "(" || c === "[" || c === "{") d++;
      else if (c === ")" || c === "]" || c === "}") d--;
      else if (c === ";" && d === 0) break;
    }
    const rhs = src.slice(q, rhsEnd);
    if (!SUPABASE_CALL_RE.test(rhs)) continue;

    // 4) Binder mønsteret `data` men ikke `error`?
    const keys = topLevelKeys(pattern);
    if (!keys.includes("data")) continue;
    if (keys.includes("error")) continue;

    // 5) Eksplicit markør-kommentar i den RÅ kilde omkring statementet
    //    (inkl. resten af den linje `;` står på, så en trailing `// best-effort` tæller).
    let lineEnd = rhsEnd;
    while (lineEnd < rawSrc.length && rawSrc[lineEnd] !== "\n") lineEnd++;
    const rawSpan = rawSrc.slice(declStart, Math.min(lineEnd, rawSrc.length));
    if (MARKER_RE.test(rawSpan)) continue;

    findings.push({ line: lineAt(rawSrc, declStart) });
  }
  return findings;
}

// ── Baseline (ratchet) ────────────────────────────────────────────────────────
// Antal ACCEPTEREDE droppede Supabase-errors pr. fil da guarden blev indført
// (#2897, målt 26/7). Guarden er en RATCHET: en fil må aldrig OVERSTIGE sit
// baseline-tal → net-nye droppede errors fejler CI. Tallet kan kun gå NED: retter
// du et site (destrukturér `error` + håndtér det), så sænk baseline tilsvarende
// (guarden minder om det). Nye filer har implicit baseline 0.
//
// Formålet er IKKE at legitimere de eksisterende — det er at forhindre at bunken
// VOKSER, mens vi æder den ned fil for fil.
//
// Målt 26/7: 178 fund, hvoraf 111 i api.js alene. Nedspisning sporet i #2997.
// De 8 i cutover-stien (seasonTransition.js 7/7 + economyEngine.js'
// processSeasonStart) blev ryddet i PR #3000, og #2986 (kalender-perf) ryddede
// én i api.js → 169 tilbage. seasonTransition.js er derfor helt væk fra listen:
// den har implicit baseline 0, og enhver ny droppet error i sæsonskiftet fejler
// CI med det samme. Ratchet'en virker begge veje — når en anden PR rydder et
// site, strammes tallet her i samme ombæring.
const BASELINE = {
  "backend/routes/api.js": 110,
  "backend/lib/discordNotifier.js": 6,
  "backend/lib/loanEngine.js": 6,
  "backend/lib/proxyBidding.js": 6,
  "backend/lib/raceRunner.js": 5,
  "backend/lib/academyTransfer.js": 4,
  "backend/lib/academyGraduation.js": 3,
  "backend/lib/aiTeamGenerator.js": 3,
  "backend/lib/deadlineDayReport.js": 3,
  "backend/lib/economyEngine.js": 2,
  "backend/lib/riderBidTimeline.js": 3,
  "backend/lib/auctionEngine.js": 2,
  "backend/lib/auctionFinalization.js": 2,
  "backend/lib/discordDmRecipient.js": 2,
  "backend/lib/transferExecution.js": 2,
  "backend/lib/youthMarket.js": 2,
  "backend/cron.js": 1,
  "backend/lib/academyGraduationSweep.js": 1,
  "backend/lib/academyIntake.js": 1,
  "backend/lib/adminSimulateRace.js": 1,
  "backend/lib/aluntaWebhook.js": 1,
  "backend/lib/marketPause.js": 1,
  "backend/lib/prizePayoutEngine.js": 1,
  "backend/lib/squadEnforcement.js": 1,
};

// ── Main ──────────────────────────────────────────────────────────────────────
function isMain() {
  if (!import.meta || !import.meta.url) return false;
  try {
    return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? "");
  } catch {
    return false;
  }
}

function main() {
  const warnOnly = process.argv.includes("--warn");
  const files = collectFiles();
  const overBaseline = [];
  const underBaseline = [];
  let liveTotal = 0;
  const allReport = [];

  for (const file of files) {
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
    const rawSrc = readFileSync(file, "utf8");
    const findings = findDroppedSupabaseErrors(rawSrc);
    const base = BASELINE[rel] ?? 0;
    liveTotal += findings.length;
    for (const f of findings) allReport.push(`  ${rel}:${f.line}`);
    if (findings.length > base) overBaseline.push({ rel, count: findings.length, base, lines: findings.map((f) => f.line) });
    else if (findings.length < base) underBaseline.push({ rel, count: findings.length, base });
  }

  if (warnOnly) {
    console.log(`lint:supabase-error (--warn) — ${liveTotal} droppet Supabase-error i alt:`);
    console.log(allReport.join("\n"));
    process.exit(0);
  }

  if (underBaseline.length) {
    console.log("i lint:supabase-error — disse filer er UNDER baseline (saenk tallet i BASELINE):");
    for (const u of underBaseline) console.log(`  ${u.rel}: ${u.count} (baseline ${u.base})`);
  }

  if (overBaseline.length === 0) {
    console.log(`OK lint:supabase-error — ingen net-nye droppede Supabase-errors (baseline-total ${liveTotal})`);
    process.exit(0);
  }

  console.error("FEJL lint:supabase-error — NET-NYE droppede Supabase-errors over baseline:");
  for (const o of overBaseline) {
    console.error(`  ${o.rel}: ${o.count} (baseline ${o.base}) — linjer: ${o.lines.join(", ")}`);
  }
  console.error(
    "\nsupabase-js kaster ikke: den returnerer { data, error }. Destrukturerer du kun\n" +
    "`data`, forsvinder fejlen sporloest (ingen throw, ingen 500, ingen Sentry-linje).\n" +
    "Skriv `const { data, error } = await supabase...` og haandter `error` — eller saet en\n" +
    "'// best-effort'-kommentar der forklarer hvorfor fejlen bevidst ignoreres.\n" +
    "Ryddede du op i en fil med vilje? Saenk dens tal i BASELINE i denne fil (#2897)."
  );
  process.exit(1);
}

if (isMain()) main();
