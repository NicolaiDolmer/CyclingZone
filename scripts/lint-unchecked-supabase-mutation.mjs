#!/usr/bin/env node
// scripts/lint-unchecked-supabase-mutation.mjs
// ============================================================
// Forward-guard mod NYE fire-and-forget Supabase-MUTATIONER i backend-runtime
// (#2974 / #2898).
//
// WHY (#2898-rodårsagen, gentaget i #2974):
//   supabase-js KASTER ikke. Et mutations-kald returnerer `{ data, error }` som
//   et helt almindeligt resolved promise — også når skrivningen fejlede. Skriver
//   man derfor
//     await supabase.from("race_results").delete().eq("race_id", id);
//   uden at binde resultatet OVERHOVEDET, så fortsætter koden som om sletningen
//   lykkedes. Står der et insert lige efter (det idempotente
//   delete-then-insert-mønster som hele persist-laget i raceRunner.js bruger),
//   indsættes de nye rækker OVEN PÅ de gamle.
//
//   #2898 var præcis det: fuld-sim'ens `race_results`-delete fejlede tavst ved
//   statement timeout under samtidige etaper (CYCLINGZONE-3D/3E) → dublerede
//   `points_earned` og DOBBELT `prize_money`. Direkte spillervendt: forkerte
//   stillinger og penge udbetalt to gange.
//
//   `lint-dropped-supabase-error.mjs` (#2897/#3002) fanger den IKKE og siger det
//   selv: den kræver en destrukturering der binder `data`, og her bindes intet.
//   `lint-swallowed-catches.mjs` fanger den heller ikke — der er ingen catch,
//   fordi der aldrig kastes noget. Denne guard lukker præcis det hul.
//
// REGEL:
//   Et await'et Supabase-mutations-kald (`.delete(` / `.insert(` / `.update(` /
//   `.upsert(` på en `.from(...)`-kæde) må ikke stå som et bart expression-
//   statement. Resultatet skal bindes, så `error` kan tjekkes:
//     x const { error } = await supabase.from("x").delete().eq("id", id);
//       if (error) throw new Error(...);                     // ← tjek + kast
//     x const res = await supabase.from("x").delete().eq("id", id);
//     x return supabase.from("x").delete().eq("id", id);     // delegeret til opkalder
//     - await supabase.from("x").delete().eq("id", id);      // FLAGES
//   Rene læsninger (`.select(` uden mutation) rammes ikke — en fire-and-forget
//   select kan ikke korrumpere data.
//
//   Escape-hatch: en markør-kommentar (`// best-effort`, `// error-ok`,
//   `// swallow-ok`) på/omkring statementet der forklarer HVORFOR fejlen
//   bevidst ignoreres. Samme token-familie som de øvrige lint-*.mjs.
//
// SCOPE: backend/lib/**/*.js + backend/routes/**/*.js + backend/cron.js
//   (samme runtime-flade som lint-dropped-supabase-error.mjs / lint-swallowed-
//   catches.mjs efter #2897/#3002 — ingen hardkodet fil-liste, hele træet
//   walkes, så guarden ikke kan drive fra virkeligheden når nye filer tilføjes).
//
// HEURISTIK (regex/AST-let — samme trade-off som de øvrige lint-*.mjs):
//   Strenge + kommentarer blankes til whitespace via den delte helper i
//   scripts/lib/js-source-scan.mjs. Derefter findes `await`-tokens der står i
//   STATEMENT-position (forudgående ikke-whitespace-tegn er `;` `{` `}` `)`,
//   eller `else`/`do`, eller filstart) — altså hvor resultatet umuligt kan være
//   bundet. Højresiden læses frem til statement-enden og skal indeholde både en
//   `.from(`-kæde og en mutations-metode.
//
// IKKE dækket (bevidst, for at holde signal/støj-forholdet højt):
//   - `await supabase.rpc("...")` uden binding. En RPC er transaktionel på
//     DB-siden, og navnet alene afslører ikke om den muterer. Destrukturerede
//     RPC-kald dækkes allerede af lint-dropped-supabase-error.mjs.
//   - `const res = await supabase...` UDEN et efterfølgende `if (res.error)`.
//     Resultatet ER bundet; at verificere at bindingen faktisk læses kræver
//     dataflow-analyse, ikke en regex-scanner.
//   - Fire-and-forget `.select(` — kan ikke korrumpere data.
//
// Usage:
//   node scripts/lint-unchecked-supabase-mutation.mjs          # check (CI), fail-hard
//   node scripts/lint-unchecked-supabase-mutation.mjs --warn   # rapport-only (exit 0)
//   npm run lint:supabase-mutation                             # samme som default
//
// Exit codes:
//   0 — ingen net-nye utjekkede mutationer (eller --warn)
//   1 — mindst én fil OVER sin baseline
//
// Refs #2974, #2898, #2897.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { blankStringsAndComments, lineAt } from "./lib/js-source-scan.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

// ── Fil-udvælgelse ───────────────────────────────────────────────────────────
// Bevidst et TRÆ-walk, ikke en fil-liste: en hardkodet liste driver fra
// virkeligheden i det øjeblik nogen tilføjer en ny fil (den fælde bed os 25/7).
export function collectFiles(root = ROOT) {
  const files = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith(".js")) continue;
      if (entry.endsWith(".test.js")) continue; // tests må gerne fyre-og-glemme
      files.push(full);
    }
  };
  walk(join(root, "backend", "lib"));
  walk(join(root, "backend", "routes"));
  const cron = join(root, "backend", "cron.js");
  if (existsSync(cron)) files.push(cron);
  return files;
}

// PostgREST-tabelkæde. En mutation uden .from(...) findes ikke i supabase-js.
const FROM_CALL_RE = /\.\s*from\s*\(/;
// Skrivende PostgREST-metoder.
const MUTATION_RE = /\.\s*(delete|insert|update|upsert)\s*\(/;
// Bevidst-ignoreret-markør (samme token-familie som lint-dropped-supabase-error.mjs).
const MARKER_RE = /best[-\s]?effort|swallow-ok|catch-ok|error-ok/i;

// Tegn der kan stå umiddelbart FØR et `await` som starter et expression-statement.
// `)` dækker `if (cond) await x();` / `while (cond) await x();` — stadig et bart
// statement. `(` `=` `,` `[` `:` `>` osv. betyder derimod at værdien konsumeres.
const STATEMENT_LEAD_CHARS = new Set([";", "{", "}", ")"]);
const STATEMENT_LEAD_WORDS = /\b(?:else|do|try)$/;

const AWAIT_RE = /\bawait\b/g;

// ── Detektion ────────────────────────────────────────────────────────────────
export function findUncheckedMutations(rawSrc) {
  const src = blankStringsAndComments(rawSrc);
  const findings = [];
  AWAIT_RE.lastIndex = 0;
  let m;
  while ((m = AWAIT_RE.exec(src)) !== null) {
    const awaitStart = m.index;

    // 1) Står `await` i statement-position (= resultatet bindes umuligt)?
    const before = src.slice(0, awaitStart).replace(/\s+$/, "");
    if (before.length !== 0) {
      const lastChar = before[before.length - 1];
      if (!STATEMENT_LEAD_CHARS.has(lastChar) && !STATEMENT_LEAD_WORDS.test(before)) continue;
    }

    // 2) Læs højresiden frem til statement-enden (`;` på dybde 0, eller til
    //    dybden bliver negativ fordi den omsluttende blok lukker).
    let end = awaitStart;
    let depth = 0;
    for (; end < src.length; end++) {
      const c = src[end];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") { depth--; if (depth < 0) break; }
      else if (c === ";" && depth === 0) break;
    }
    const rhs = src.slice(awaitStart, end);

    // 3) Er det en Supabase-MUTATION? Både tabelkæde og skrivende metode kræves.
    if (!FROM_CALL_RE.test(rhs)) continue;
    if (!MUTATION_RE.test(rhs)) continue;

    // 4) Eksplicit markør-kommentar i den RÅ kilde omkring statementet (inkl.
    //    resten af linjen `;` står på, så en trailing `// best-effort` tæller).
    let lineEnd = end;
    while (lineEnd < rawSrc.length && rawSrc[lineEnd] !== "\n") lineEnd++;
    const rawSpan = rawSrc.slice(awaitStart, Math.min(lineEnd, rawSrc.length));
    if (MARKER_RE.test(rawSpan)) continue;

    const method = (rhs.match(MUTATION_RE) || [])[1] ?? "?";
    findings.push({ line: lineAt(rawSrc, awaitStart), method });
  }
  return findings;
}

// ── Baseline (ratchet) ────────────────────────────────────────────────────────
// Antal TILBAGEVÆRENDE utjekkede mutationer pr. fil da guarden blev indført
// (#2974, målt 26/7 EFTER at denne PR rettede race-motorens egne forekomster).
// Guarden er en RATCHET: en fil må aldrig OVERSTIGE sit tal → net-nye utjekkede
// mutationer fejler CI. Tallet kan kun gå NED: retter du et site, så sænk
// baseline tilsvarende (guarden minder om det). Nye filer har implicit baseline 0.
//
// Formålet er IKKE at legitimere de tilbageværende — det er at forhindre at
// bunken VOKSER, mens vi æder den ned fil for fil.
//
// Målt 26/7: 107 fund tilbage (114 før denne PR — de 7 i race-motoren og
// PCM-import-stien er rettet her). 49 af de 107 ligger i api.js alene.
//
// `backend/lib/economyEngine.js` (2 fund) er BEVIDST ikke rørt i #2974:
// sæson-cutoveren køres 26/7 kl. 19:30, og PR #3000 ligger allerede med
// rettelser i netop den sti og venter på ejer-beslutning. Når #3000 merger,
// falder tallet her.
const BASELINE = {
  "backend/routes/api.js": 49,
  "backend/lib/transferExecution.js": 10,
  "backend/lib/boardConsequences.js": 8,
  "backend/lib/auctionFinalization.js": 4,
  "backend/lib/squadEnforcement.js": 4,
  "backend/cron.js": 3,
  "backend/lib/dailyTrainingEngine.js": 3,
  "backend/lib/discordDmOutbox.js": 3,
  "backend/lib/marketUtils.js": 3,
  "backend/lib/proxyBidding.js": 3,
  "backend/lib/starterSquadAllocator.js": 3,
  "backend/lib/auctionCancellation.js": 2,
  "backend/lib/auctionEngine.js": 2,
  "backend/lib/boardMembers.js": 2,
  "backend/lib/economyEngine.js": 2,
  "backend/lib/backfillCores.js": 1,
  "backend/lib/boardAutoAccept.js": 1,
  "backend/lib/contractSeed.js": 1,
  "backend/lib/pcmResultsImport.js": 1,
  "backend/lib/prizePayoutEngine.js": 1,
  "backend/lib/riderValueRefresh.js": 1,
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
    const findings = findUncheckedMutations(rawSrc);
    const base = BASELINE[rel] ?? 0;
    liveTotal += findings.length;
    for (const f of findings) allReport.push(`  ${rel}:${f.line} — .${f.method}()`);
    if (findings.length > base) {
      overBaseline.push({ rel, count: findings.length, base, findings });
    } else if (findings.length < base) {
      underBaseline.push({ rel, count: findings.length, base });
    }
  }

  if (warnOnly) {
    console.log(`lint:supabase-mutation (--warn) — ${liveTotal} utjekkede mutationer i alt:`);
    console.log(allReport.join("\n"));
    process.exit(0);
  }

  if (underBaseline.length) {
    console.log("i lint:supabase-mutation — disse filer er UNDER baseline (saenk tallet i BASELINE):");
    for (const u of underBaseline) console.log(`  ${u.rel}: ${u.count} (baseline ${u.base})`);
  }

  if (overBaseline.length === 0) {
    console.log(`OK lint:supabase-mutation — ingen net-nye utjekkede Supabase-mutationer (baseline-total ${liveTotal})`);
    process.exit(0);
  }

  console.error("FEJL lint:supabase-mutation — NET-NYE utjekkede Supabase-mutationer over baseline:");
  for (const o of overBaseline) {
    console.error(`  ${o.rel}: ${o.count} (baseline ${o.base})`);
    for (const f of o.findings) console.error(`    :${f.line} — .${f.method}()`);
  }
  console.error(
    "\nsupabase-js kaster ikke: et fejlet delete/insert/update/upsert returnerer bare\n" +
    "{ data, error } og koden fortsaetter som om skrivningen lykkedes. Staar der et\n" +
    "insert efter et fejlet delete (det idempotente delete-then-insert-moenster),\n" +
    "indsaettes de nye raekker OVEN PAA de gamle — det var #2898: dublerede\n" +
    "points_earned og dobbelt prize_money.\n" +
    "Bind resultatet og tjek fejlen: `const { error } = await supabase.from(...)...;`\n" +
    "efterfulgt af `if (error) throw ...` — eller saet en '// best-effort'-kommentar\n" +
    "der forklarer hvorfor fejlen bevidst ignoreres.\n" +
    "Ryddede du op i en fil med vilje? Saenk dens tal i BASELINE i denne fil (#2974)."
  );
  process.exit(1);
}

if (isMain()) main();
