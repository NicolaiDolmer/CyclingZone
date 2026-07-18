#!/usr/bin/env node
// scripts/lint-swallowed-catches.mjs
// ============================================================
// Forward-guard mod NYE svaltede catch-blokke i backend-runtime (#2395 del 2).
//
// WHY (owner-beslutning, #2395 / #2389-hærdningen):
//   En `catch`-blok der HVERKEN captureException'er, rethrow'er, eller er
//   eksplicit markeret som bevidst best-effort, skjuler fejl for Sentry. Under
//   Sentry-hærdningen 12/7 fandt catch-audittet ~20 sådanne sites — flere skjulte
//   ægte fejl (tavst deaktiveret betalt feature, fail-forkert-retning). Dette er
//   den strukturelle forebyggelse: hver svaltet catch skal træffe et BEVIDST valg.
//
// REGEL:
//   Enhver `catch`-blok i backend/lib/**/*.js + backend/cron.js skal enten
//     (a) captureException'e / sentryCapture'e fejlen, ELLER
//     (b) rethrow'e (throw), ELLER
//     (c) bære en eksplicit markør-kommentar: `// best-effort` (eller `swallow-ok`)
//         der forklarer HVORFOR fejlen bevidst sluges (fx "notificationService
//         capturer internt", "aggregeret i cron.js", "fire-and-forget UI-notif").
//   Alt andet flages.
//
// HEURISTIK (ikke en fuld JS-parser — samme trade-off som de andre lint-*.mjs):
//   Strenge + kommentarer blankes til whitespace før brace-matching, så et
//   `catch`/`throw` inde i en streng eller kommentar ikke tæller. Markør-kommentaren
//   søges i den RÅ kildetekst inden for catch-blokkens span. Regex-literaler med
//   ubalancerede tuborg-parenteser i en catch-krop er teoretisk en fejlkilde, men
//   findes ikke i praksis i denne kodebase; markøren er escape-hatch hvis det sker.
//
// Usage:
//   node scripts/lint-swallowed-catches.mjs            # scanner backend/lib + cron.js
//   node scripts/lint-swallowed-catches.mjs --warn     # rapport-only (exit 0)
//   npm run lint:catches                               # samme som default (fail-hard)
//
// Exit codes:
//   0 — ingen usvaltede catch-blokke (eller --warn)
//   1 — mindst én svaltet catch uden capture/rethrow/markør
//
// Refs #2395 #2389.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

// ── Fil-udvælgelse ───────────────────────────────────────────────────────────
function collectFiles() {
  const files = [];
  const libDir = join(ROOT, "backend", "lib");
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) { walk(full); continue; }
      if (!entry.endsWith(".js")) continue;
      if (entry.endsWith(".test.js")) continue; // tests må gerne sluge
      files.push(full);
    }
  };
  walk(libDir);
  files.push(join(ROOT, "backend", "cron.js"));
  return files;
}

// ── Blank strenge + kommentarer til whitespace (bevar længde + newlines) ──────
// Returnerer { blanked } hvor strenge/kommentar-indhold er erstattet med mellemrum,
// så brace-matching + keyword-scan ikke rammer indhold inde i strenge/kommentarer.
function blankStringsAndComments(src) {
  const out = src.split("");
  let i = 0;
  const n = src.length;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) {
      if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
    }
  };
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    // Line-kommentar
    if (c === "/" && next === "/") {
      let j = i + 2;
      while (j < n && src[j] !== "\n") j++;
      blank(i, j);
      i = j;
      continue;
    }
    // Blok-kommentar
    if (c === "/" && next === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      j = Math.min(n, j + 2);
      blank(i, j);
      i = j;
      continue;
    }
    // Streng (', ", `) — håndter escapes; template-literals blankes fladt (godt nok).
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === quote) { j++; break; }
        j++;
      }
      blank(i + 1, j - 1); // bevar selve quote-tegnene så strukturen ikke skrider
      i = j;
      continue;
    }
    i++;
  }
  return out.join("");
}

// ── Linjenr fra char-offset ───────────────────────────────────────────────────
function lineAt(src, offset) {
  let line = 1;
  for (let k = 0; k < offset && k < src.length; k++) if (src[k] === "\n") line++;
  return line;
}

const MARKER_RE = /best[-\s]?effort|swallow-ok|catch-ok/i;
const HANDLED_RE = /\bcaptureException\b|\bsentryCapture\b|\bcaptureExceptionFn\b|\bthrow\b/;

// ── Find catch-blokke via brace-matching på den blankede kilde ────────────────
export function findSwallowedCatches(rawSrc) {
  const src = blankStringsAndComments(rawSrc);
  const findings = [];
  const catchRe = /\bcatch\b/g;
  let m;
  while ((m = catchRe.exec(src)) !== null) {
    const catchStart = m.index;
    // Find den åbnende `{` efter catch (spring evt. `(err)` over).
    let p = catchStart + 5;
    while (p < src.length && src[p] !== "{" && src[p] !== "\n" && src[p] !== ";") p++;
    // tillad newline mellem catch(...) og {
    while (p < src.length && src[p] !== "{" && /\s/.test(src[p])) p++;
    if (src[p] !== "{") continue; // ikke en catch-blok (fx ordet i en identifier — usandsynligt efter blanking)
    // Brace-match
    let depth = 0;
    let q = p;
    for (; q < src.length; q++) {
      if (src[q] === "{") depth++;
      else if (src[q] === "}") { depth--; if (depth === 0) { q++; break; } }
    }
    const bodyBlanked = src.slice(p, q);   // struktur (strenge/kommentarer blanket)
    const bodyRaw = rawSrc.slice(catchStart, q); // rå (til markør-søgning)

    const handled = HANDLED_RE.test(bodyBlanked); // capture/throw i ægte kode
    const marked = MARKER_RE.test(bodyRaw);       // eksplicit markør-kommentar
    if (!handled && !marked) {
      findings.push({ line: lineAt(rawSrc, catchStart) });
    }
  }
  return findings;
}

// ── Baseline (ratchet) ─────────────────────────────────────────────────────────
// Antal ACCEPTEREDE svaltede catch-blokke pr. fil på det tidspunkt guarden blev
// indført (#2395, målt 12/7 EFTER audit-oprydningen). Guarden er en RATCHET: en fil
// må aldrig OVERSTIGE sit baseline-tal → net-nye svaltede catches fejler CI. Tallet
// kan kun gå NED: fjerner/markerer/capturer du en catch, så sænk baseline tilsvarende
// (guarden minder om det). Nye filer har implicit baseline 0 → enhver svaltet catch
// i en ny fil fejler, medmindre den capt+er/rethrow'er/markeres '// best-effort'.
//
// Formålet er IKKE at legitimere de 47 eksisterende (mange er ægte best-effort med
// forklarende kommentar der bare mangler markør-token) — det er at forhindre at
// bunken VOKSER. Whittle den ned over tid ved at markere/capture pr. site.
const BASELINE = {
  "backend/lib/seasonTransition.js": 4,
  "backend/lib/responseCache.js": 4,
  "backend/cron.js": 3,
  "backend/lib/raceRunner.js": 3,
  "backend/lib/pcmResultsImport.js": 3,
  "backend/lib/discordDmDelivery.js": 3,
  "backend/lib/auctionFinalization.js": 3,
  "backend/lib/stageScheduler.js": 2,
  "backend/lib/riderProgressionEngine.js": 2,
  "backend/lib/dailyTrainingEngine.js": 2,
  "backend/lib/transferExecution.js": 1,
  "backend/lib/trainingSweep.js": 1,
  "backend/lib/starterSquadHealSweep.js": 1,
  "backend/lib/starterSquadAllocator.js": 1,
  "backend/lib/sentry.js": 1,
  "backend/lib/raceEntryGenerator.js": 0,
  "backend/lib/raceEntryCleanup.js": 1,
  "backend/lib/featureStage.js": 1,
  "backend/lib/discordRoleSync.js": 1,
  "backend/lib/discordNotifier.js": 1,
  "backend/lib/discordBotTokenCheck.js": 1,
  "backend/lib/boardUtils.js": 1,
  "backend/lib/attributionDashboard.js": 1,
  "backend/lib/aluntaWebhook.js": 1,
  "backend/lib/aiTeamTrimHealSweep.js": 1,
  "backend/lib/academyHealSweep.js": 1,
  "backend/lib/academyGraduationSweep.js": 1,
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
const overBaseline = [];   // filer der OVERSTIGER baseline → fejl
const underBaseline = [];  // filer under baseline → info (sænk baseline)
let liveTotal = 0;
const allReport = [];
for (const file of files) {
  const rawSrc = readFileSync(file, "utf8");
  const findings = findSwallowedCatches(rawSrc);
  const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
  const base = BASELINE[rel] ?? 0;
  liveTotal += findings.length;
  for (const f of findings) allReport.push(`  ${rel}:${f.line}`);
  if (findings.length > base) overBaseline.push({ rel, count: findings.length, base, lines: findings.map((f) => f.line) });
  else if (findings.length < base) underBaseline.push({ rel, count: findings.length, base });
}

if (warnOnly) {
  console.log(`lint:catches (--warn) — ${liveTotal} svaltet catch-blok(ke) i alt:`);
  console.log(allReport.join("\n"));
  process.exit(0);
}

// Info: filer der er kommet UNDER baseline → mind om at stramme (ikke en fejl).
if (underBaseline.length) {
  console.log("ℹ lint:catches — disse filer er UNDER baseline (sænk tallet i BASELINE):");
  for (const u of underBaseline) console.log(`  ${u.rel}: ${u.count} (baseline ${u.base})`);
}

if (overBaseline.length === 0) {
  console.log(`✓ lint:catches — ingen net-nye svaltede catch-blokke (baseline-total ${liveTotal})`);
  process.exit(0);
}

console.error("✗ lint:catches — NET-NYE svaltede catch-blokke over baseline:");
for (const o of overBaseline) {
  console.error(`  ${o.rel}: ${o.count} svaltede (baseline ${o.base}) — linjer: ${o.lines.join(", ")}`);
}
console.error(
  "\nEn ny svaltet catch skal enten: (a) captureException(err, …), (b) throw, eller\n" +
  "(c) bære en '// best-effort'-kommentar der forklarer hvorfor fejlen bevidst sluges.\n" +
  "Reducerede du med vilje en fil? Sænk dens tal i BASELINE i denne fil (#2395)."
);
process.exit(1);
}

if (isMain()) main();
