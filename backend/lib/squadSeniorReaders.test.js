// Forward-guard + skema-bevis for trup-datamodellens A2 (#5517, spec §3.2 slice 2).
//
// HVAD DER LÅSES HER
//   1) Migrationen (database/2026-09-24-5517-squad-leagues-races-teams.sql) gør det
//      den siger, mod ÆGTE DDL i PGlite: kolonner + DEFAULT, den nye pulje-nøgle
//      (squad, tier, pool_index) i stedet for (tier, pool_index), CHECK på begge
//      tabeller, holdenes ungdoms-FK'er med ON DELETE SET NULL — og den kan køres to
//      gange (auto-migrate-sikker).
//   2) Forward-guard: enhver LISTE-læser af league_divisions (backend/lib,
//      backend/routes OG frontend/src) og enhver læser af races i kalender-/
//      resultat-filerne (routes/api.js, lib/tierCalendarMaterializer.js) går gennem
//      squads.withSeniorSquadScope — eller står på en navngiven, begrundet liste.
//   3) Seed-gaten: ungdomspuljer må ikke seedes (INSERT/UPDATE i en auto-migration)
//      så længe listen i 2) rummer læsere der ville vise eller bruge dem forkert.
//
// HVORFOR
// Efter A2 bor ungdomspuljer og ungdomsløb i SAMME tabeller som seniorernes, med
// samme tier 1-4. En læser der lister "alle puljer" eller "alle sæsonens løb" uden
// scope er i dag bit-identisk (alt er 'senior'), men bliver tavst forkert i det
// øjeblik ungdomspuljerne seedes: U23-puljer i seniorkalenderen, AI-hold i
// U23-puljer, en op/nedrykning der nøgler på tier:pool_index og rammer to puljer.
// Ingen almindelig test ser det, fordi fixtures ingen ungdomsrækker har. Samme klasse
// som #1307/#1308 (ét kaldsted uden akademi-filter → 264 akademiryttere i seniorløb).
//
// HVAD GUARDEN BEVIDST IKKE FÆLDER
//   • Enkelt-række-opslag (.eq("id") / .in("id") / .maybeSingle() / .single()) — de
//     læser en pulje/et løb kalderen allerede har valgt.
//   • Skrivninger (insert/update/upsert/delete).
//   • races-læsninger scopet på ÉN pulje (.eq("league_division_id", …)): en
//     seniorpuljes løb er seniorløb.
//   • races-læsninger med en `squad-scope-ok: <begrundelse>`-kommentar højst 6 linjer
//     over — til stier der SKAL se alle trupper (fx sæson-afslutningens tjek).
//   • Embeddede joins (races!inner(...)) og backend/scripts/** (analyse, ikke gameplay).
//   • races-læsere i øvrige lib-filer (motor, udtagelse, præmier): de er spor B1-B4 i
//     spec §8 og skal have en trup-DIMENSION, ikke et senior-scope.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

import { createTestDb, RACE_HUB_SCHEMA_FILES } from "./testdb/createTestDb.js";
import { sanitizeForPglite } from "./testdb/sanitizeForPglite.js";
import { distributeCompression } from "./pyramidCompression.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = join(__dirname, "..");
const REPO_DIR = join(BACKEND_DIR, "..");
const DATABASE_DIR = join(REPO_DIR, "database");
const MIGRATION_FILE = "2026-09-24-5517-squad-leagues-races-teams.sql";
const HELPER = "withSeniorSquadScope";

// ── Kilde-scanner ────────────────────────────────────────────────────────────────

const toPosix = (p) => p.split(sep).join("/");

function sourceFilesIn(dir, exts) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "__fixtures__" || entry === "testdb" || entry === "dist") continue;
      out.push(...sourceFilesIn(full, exts));
      continue;
    }
    if (!exts.some((ext) => entry.endsWith(ext))) continue;
    if (/\.(test|spec)\.(js|mjs|jsx|ts|tsx)$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

function lineNumberAt(src, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (src[i] === "\n") line += 1;
  return line;
}

// Et fund på en kommentarlinje er et citat, ikke en læser (JSDoc-eksemplet i
// squads.js, headere der forklarer historikken).
const isCommentLine = (line) => /^\s*(\/\/|\*|\/\*)/.test(line ?? "");

const fromRe = (table) => new RegExp(String.raw`\.from\(\s*(["'\x60])${table}\1\s*\)`, "g");

// Kæden efter .from(...) — KUN dens eget udtryk. Scanneren følger parenteser/
// klammer/strenge og stopper ved et komma, semikolon eller en lukkende parentes på
// udtrykkets eget niveau. En naiv "frem til næste `;`" ville i et
// `Promise.all([a, b, c])` låne naboens `.maybeSingle()` og kalde en liste-læser et
// enkelt-række-opslag. Kommentarer i kæden (api.js har mange) springes over.
function chainAfter(src, index) {
  let depth = 0;
  let i = index;
  const limit = Math.min(src.length, index + 2000);
  while (i < limit) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === "/" && next === "/") { const nl = src.indexOf("\n", i); i = nl === -1 ? limit : nl; continue; }
    if (ch === "/" && next === "*") { const close = src.indexOf("*/", i + 2); i = close === -1 ? limit : close + 2; continue; }
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < limit && src[j] !== ch) j += src[j] === "\\" ? 2 : 1;
      i = j + 1;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) break;
      depth -= 1;
    } else if (depth === 0 && (ch === "," || ch === ";")) break;
    i += 1;
  }
  return src.slice(index, i);
}

const stripLineComments = (text) => text.replace(/\/\/[^\n]*/g, "");

// Er `<klient>.from(...)` pakket direkte ind i scope-parameteren fra en
// withSeniorSquadScope((X) => …)? Dvs. teksten før `.from(` ender på `X(<klient>`,
// og `X` er bundet af helperen lidt længere oppe. At helperen blot står i nærheden
// er IKKE nok — `withSeniorSquadScope(() => supabase.from(...))` scoper ingenting.
// Linjekommentarer mellem `X(supabase` og `.from(` (api.js' #4701-noter) fjernes først.
function isScopeWrapped(src, fromIndex) {
  const before = stripLineComments(src.slice(Math.max(0, fromIndex - 600), fromIndex));
  const m = before.match(/([A-Za-z_$][\w$]*)\(\s*[A-Za-z_$][\w$.]*\s*$/);
  if (!m) return false;
  const wrapper = m[1];
  const bind = new RegExp(String.raw`${HELPER}\(\s*(?:async\s*)?\(?\s*${wrapper}\s*\)?\s*=>`);
  return bind.test(before);
}

const WRITE_RE = /\.(insert|update|upsert|delete)\(/;
const SINGLE_ROW_RE = /\.eq\(\s*["']id["']|\.in\(\s*["']id["']|\.maybeSingle\(|\.single\(/;
const ONE_POOL_RE = /\.eq\(\s*["']league_division_id["']/;
// #5536: et eksplicit trup-valg (.eq("squad", <trup>)) er et scope — læseren har valgt
// ÉN trup, fx buildPoolTree(client, { squad: "u23" }).
const SQUAD_EQ_RE = /\.eq\(\s*["']squad["']\s*,/;
const OPT_OUT_RE = /squad-scope-ok:\s*\S/;

function hasOptOut(lines, lineNo) {
  for (let l = Math.max(1, lineNo - 6); l <= lineNo; l++) if (OPT_OUT_RE.test(lines[l - 1] ?? "")) return true;
  return false;
}

/**
 * Klassificér hver `.from("<table>")` i kildeteksten.
 * @returns {Array<{line:number, kind:"scoped"|"write"|"single-row"|"one-pool"|"opt-out"|"unscoped"}>}
 */
function classifyReads(src, table, { allowOnePool = false, allowOptOut = false } = {}) {
  const lines = src.split("\n");
  const out = [];
  const re = fromRe(table);
  let m;
  while ((m = re.exec(src)) !== null) {
    const line = lineNumberAt(src, m.index);
    if (isCommentLine(lines[line - 1])) continue;
    const chain = chainAfter(src, m.index);
    let kind = "unscoped";
    if (isScopeWrapped(src, m.index)) kind = "scoped";
    else if (WRITE_RE.test(chain)) kind = "write";
    else if (SQUAD_EQ_RE.test(chain)) kind = "scoped";
    else if (SINGLE_ROW_RE.test(chain)) kind = "single-row";
    else if (allowOnePool && ONE_POOL_RE.test(chain)) kind = "one-pool";
    else if (allowOptOut && hasOptOut(lines, line)) kind = "opt-out";
    out.push({ line, kind });
  }
  return out;
}

// ── Kendte, uscopede liste-læsere af league_divisions (ratchet) ─────────────────
//
// Filer UDEN FOR denne slices ejerskab. Hver post har et EKSAKT antal: en ny læser i
// en af filerne fælder guarden lige så vel som en læser i en ny fil, og en rettet
// læser tvinger listen til at skrumpe. `blocksYouthSeed: true` = læseren ville vise
// eller bruge en ungdomspulje forkert og SKAL rettes før ungdomspuljerne seedes
// (seed-gaten nedenfor håndhæver det). Rettes en læser, så flyt den over på
// withSeniorSquadScope (backend) eller et squad-filter/trup-valg (frontend, spec §7).
const KNOWN_UNSCOPED_LEAGUE_READERS = Object.freeze({
  "backend/lib/aiPoolRetirement.js": {
    count: 1, blocksYouthSeed: false,
    reason: "Pensions-sweepet finder hold via teams.league_division_id (plan_/reserve_ai_pool_retirements), som altid peger på en seniorpulje — en ungdomspulje giver 0 kandidater.",
  },
  "backend/lib/balanceDriftWatch.js": {
    count: 1, blocksYouthSeed: false,
    reason: "id→tier-opslag for allerede valgte løb; itererer ikke puljerne.",
  },
  "backend/lib/teamProfileEngine.js": {
    count: 1, blocksYouthSeed: true,
    reason: "Et nyt holds entry-pulje vælges på tier alene — ville kunne placere holdet i en ungdomspulje.",
  },
  "frontend/src/pages/DashboardPage.jsx": {
    count: 1, blocksYouthSeed: true,
    reason: "Læser Supabase direkte; pulje-etiketter/-træ uden squad-filter (spec §7).",
  },
  "frontend/src/pages/RaceCentrePage.jsx": {
    count: 1, blocksYouthSeed: true,
    reason: "Læser Supabase direkte; pulje-listen uden squad-filter (spec §7).",
  },
  "frontend/src/pages/ResultaterPage.jsx": {
    count: 1, blocksYouthSeed: true,
    reason: "Resultater: pulje-vælgeren ville vise ungdomspuljer (spec §7: filtrér squad='senior' eller tilbyd trup-valg).",
  },
  "frontend/src/pages/RiderRankingsPage.jsx": {
    count: 1, blocksYouthSeed: true,
    reason: "Ranglister: pulje-vælgeren ville vise ungdomspuljer (spec §6.3/§7).",
  },
  "frontend/src/pages/StandingsPage.jsx": {
    count: 1, blocksYouthSeed: true,
    reason: "Standings: pulje-fanerne ville vise ungdomspuljer (spec §7, spor B3/B5).",
  },
});

// Filer hvis races-LÆSERE er kalender-/resultat-læsere og derfor skal være scopet.
const RACE_READER_FILES = Object.freeze(["backend/routes/api.js", "backend/lib/tierCalendarMaterializer.js"]);

function scanLeagueDivisionReaders() {
  const files = [
    ...sourceFilesIn(join(BACKEND_DIR, "lib"), [".js", ".mjs"]),
    ...sourceFilesIn(join(BACKEND_DIR, "routes"), [".js", ".mjs"]),
    ...sourceFilesIn(join(REPO_DIR, "frontend", "src"), [".js", ".jsx", ".mjs", ".ts", ".tsx"]),
  ];
  const unscopedByFile = new Map();
  let scoped = 0;
  for (const file of files) {
    const rel = toPosix(relative(REPO_DIR, file));
    const src = readFileSync(file, "utf8");
    for (const hit of classifyReads(src, "league_divisions")) {
      if (hit.kind === "scoped") scoped += 1;
      if (hit.kind !== "unscoped") continue;
      if (!unscopedByFile.has(rel)) unscopedByFile.set(rel, []);
      unscopedByFile.get(rel).push(hit.line);
    }
  }
  return { unscopedByFile, scoped };
}

test("#5517 forward-guard: hver liste-læser af league_divisions går gennem withSeniorSquadScope (eller står på den begrundede liste)", () => {
  const { unscopedByFile, scoped } = scanLeagueDivisionReaders();
  const problems = [];
  for (const [rel, lines] of unscopedByFile) {
    const known = KNOWN_UNSCOPED_LEAGUE_READERS[rel];
    if (!known) {
      problems.push(`NY uscopet læser: ${rel}:${lines.join(",")} — brug squads.withSeniorSquadScope`);
    } else if (lines.length !== known.count) {
      problems.push(
        `${rel}: ${lines.length} uscopede læsere (linje ${lines.join(",")}), listen siger ${known.count} — ` +
          (lines.length > known.count ? "en NY læser skal scopes" : "en læser er rettet: sænk count/fjern posten"),
      );
    }
  }
  for (const rel of Object.keys(KNOWN_UNSCOPED_LEAGUE_READERS)) {
    if (!unscopedByFile.has(rel)) problems.push(`${rel} står på listen men har ingen uscopede læsere længere — fjern posten`);
  }
  assert.deepEqual(problems, [], problems.join("\n"));
  // Guarden må ikke kunne bestå fordi scanneren er blevet blind.
  // 4 i api.js (planlægger, kalender, browse, admin-preview) + materializer + AI-generator.
  assert.ok(scoped >= 6, `scanneren skal se de scopede læsere i api.js/materializer/AI-generatoren (så ${scoped})`);
});

test("#5517 forward-guard: kalender-/resultat-filernes races-læsere er scopet, enkelt-række, én pulje eller begrundet", () => {
  const problems = [];
  let scoped = 0;
  for (const rel of RACE_READER_FILES) {
    const src = readFileSync(join(REPO_DIR, rel), "utf8");
    for (const hit of classifyReads(src, "races", { allowOnePool: true, allowOptOut: true })) {
      if (hit.kind === "scoped") scoped += 1;
      if (hit.kind === "unscoped") problems.push(`${rel}:${hit.line}`);
    }
  }
  assert.deepEqual(
    problems,
    [],
    "races-læser uden senior-scope (brug squads.withSeniorSquadScope, eller skriv " +
      "`// squad-scope-ok: <hvorfor alle trupper>` over læseren): " + problems.join(", "),
  );
  assert.ok(scoped >= 15, `scanneren skal se de scopede races-læsere (så ${scoped})`);
});

test("#5517 hver post på den kendte liste har en begrundelse og et positivt antal", () => {
  for (const [rel, entry] of Object.entries(KNOWN_UNSCOPED_LEAGUE_READERS)) {
    assert.ok(Number.isInteger(entry.count) && entry.count > 0, `${rel}: count`);
    assert.equal(typeof entry.blocksYouthSeed, "boolean", `${rel}: blocksYouthSeed`);
    assert.ok(typeof entry.reason === "string" && entry.reason.length > 20, `${rel}: begrundelse`);
  }
});

test("#5517 scanneren ville fange en ny læser (selvtest)", () => {
  const kinds = (src, opts) => classifyReads(src, "league_divisions", opts).map((h) => h.kind);
  // Fanges:
  assert.deepEqual(kinds('const { data } = await supabase.from("league_divisions").select("id, tier");'), ["unscoped"]);
  assert.deepEqual(kinds("x = db\n  .from('league_divisions')\n  .select('id')\n  .order('id');"), ["unscoped"]);
  // Helperen i nærheden, men builderen er IKKE pakket ind i scopet → stadig uscopet.
  assert.deepEqual(kinds('await withSeniorSquadScope(() => supabase.from("league_divisions").select("id"));'), ["unscoped"]);
  // Fanges ikke:
  assert.deepEqual(kinds('await withSeniorSquadScope((senior) => senior(supabase.from("league_divisions").select("id")).order("tier"));'), ["scoped"]);
  assert.deepEqual(kinds('await withSeniorSquadScope(async (s) => fetchAllRows(() => s(supabase\n  .from("league_divisions").select("id")).order("id")));'), ["scoped"]);
  assert.deepEqual(kinds('await supabase.from("league_divisions").select("label").eq("id", poolId).maybeSingle();'), ["single-row"]);
  // #5536: et eksplicit trup-valg er et scope (buildPoolTree(client, { squad })).
  assert.deepEqual(kinds('await client.from("league_divisions").select("id, tier").eq("squad", squad);'), ["scoped"]);
  assert.deepEqual(kinds("await client\n  .from('league_divisions')\n  .select('id')\n  .eq('squad', 'u23')\n  .order('tier');"), ["scoped"]);
  // … men et filter på en ANDEN kolonne der blot hedder noget med squad er det ikke.
  assert.deepEqual(kinds('await client.from("league_divisions").select("id").eq("squad_size", 24);'), ["unscoped"]);
  // Og et squad-filter i NABO-udtrykket (Promise.all) låner læseren ikke.
  assert.deepEqual(
    kinds('await Promise.all([\n  supabase.from("league_divisions").select("id"),\n  supabase.from("races").select("id").eq("squad", "u23"),\n]);'),
    ["unscoped"],
  );
  assert.deepEqual(kinds('// her stod supabase.from("league_divisions").select("*")'), []);
  // En liste-læser i et Promise.all må ikke låne naboens .maybeSingle().
  assert.deepEqual(
    kinds('await Promise.all([\n  supabase.from("league_divisions").select("id").order("tier"),\n  supabase.from("seasons").select("id").eq("status", "active").maybeSingle(),\n]);'),
    ["unscoped"],
  );
  // Kommentarlinjer mellem scope-kaldet og .from( (api.js' #4701-noter) bryder ikke genkendelsen.
  assert.deepEqual(
    kinds('await withSeniorSquadScope((senior) => senior(supabase\n  // note med "citat" (og parentes)\n  .from("league_divisions").select("id")));'),
    ["scoped"],
  );
  // races: én pulje og opt-out er kun tilladt når kalderen beder om det.
  const races = (src) => classifyReads(src, "races", { allowOnePool: true, allowOptOut: true }).map((h) => h.kind);
  assert.deepEqual(races('await supabase.from("races").select("id").eq("season_id", s).eq("league_division_id", p);'), ["one-pool"]);
  assert.deepEqual(races('// squad-scope-ok: alle trupper skal med\nawait supabase.from("races").select("id").eq("season_id", s);'), ["opt-out"]);
  assert.deepEqual(races('await supabase.from("races").select("id").eq("season_id", s);'), ["unscoped"]);
  assert.deepEqual(races('await supabase.from("races").insert(rows).select("id");'), ["write"]);
});

// ── Seed-gaten ───────────────────────────────────────────────────────────────────
//
// Ungdomspuljer seedes via en migration (C1 + ejer-go). Finder vi en auto-migration der
// indsætter/sætter en ungdomspulje eller et holds ungdoms-FK, SKAL listen ovenfor være
// fri for `blocksYouthSeed`-poster — ellers lander puljerne i prod med læsere der viser
// eller bruger dem forkert.

function stripSqlComments(sql) {
  return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function youthSeedStatements(sql) {
  const hits = [];
  for (const raw of stripSqlComments(sql).split(";")) {
    const stmt = raw.trim();
    if (!stmt) continue;
    const intoPools = /^INSERT\s+INTO\s+(public\.)?league_divisions\b/i.test(stmt) || /^UPDATE\s+(public\.)?league_divisions\b/i.test(stmt);
    if (intoPools && /'(u23|junior)'/i.test(stmt)) hits.push(stmt.slice(0, 120));
    if (/^UPDATE\s+(public\.)?teams\b/i.test(stmt) && /\b(u23|junior)_league_division_id\s*=/i.test(stmt)) hits.push(stmt.slice(0, 120));
  }
  return hits;
}

test("#5517 seed-gate: ingen auto-migration seeder ungdomspuljer før de blokerende læsere er rettet", () => {
  const seeds = [];
  for (const file of readdirSync(DATABASE_DIR)) {
    if (!/^2026-.*\.sql$/.test(file)) continue; // = auto-migrate.yml's glob
    for (const stmt of youthSeedStatements(readFileSync(join(DATABASE_DIR, file), "utf8"))) seeds.push(`${file}: ${stmt}`);
  }
  const blocking = Object.entries(KNOWN_UNSCOPED_LEAGUE_READERS).filter(([, e]) => e.blocksYouthSeed).map(([rel]) => rel);
  if (seeds.length === 0) return; // i dag: ingen seed (A2 seeder bevidst intet)
  assert.deepEqual(
    blocking,
    [],
    `ungdomspuljer seedes (${seeds.join(" | ")}) mens disse læsere stadig ville vise/bruge dem forkert: ${blocking.join(", ")}`,
  );
});

test("#5517 seed-gaten ville genkende en seed (selvtest)", () => {
  assert.equal(youthSeedStatements("INSERT INTO public.league_divisions (squad, tier, pool_index, label) VALUES ('u23', 1, 0, 'U23 Division 1');").length, 1);
  assert.equal(youthSeedStatements("UPDATE teams SET u23_league_division_id = 42 WHERE id = 'x';").length, 1);
  // A2's egen DDL (CHECK/COMMENT nævner 'u23') er IKKE en seed.
  assert.deepEqual(youthSeedStatements(readFileSync(join(DATABASE_DIR, MIGRATION_FILE), "utf8")), []);
  assert.deepEqual(youthSeedStatements("INSERT INTO league_divisions (tier, pool_index, label) VALUES (1, 0, 'Division 1');"), []);
});

// ── Pyramide-fordelingen (ren funktion) ──────────────────────────────────────────

test("#5517 distributeCompression fordeler kun over seniorpuljer — ungdomspuljer med samme tier ignoreres", () => {
  const senior = [
    { id: 1, tier: 1, pool_index: 0 },
    { id: 2, tier: 2, pool_index: 0 }, { id: 3, tier: 2, pool_index: 1 },
    { id: 4, tier: 3, pool_index: 0 }, { id: 5, tier: 3, pool_index: 1 }, { id: 6, tier: 3, pool_index: 2 }, { id: 7, tier: 3, pool_index: 3 },
    { id: 8, tier: 4, pool_index: 0 }, { id: 9, tier: 4, pool_index: 1 },
  ];
  // Ungdomspuljerne spejler seniorpyramiden (spec §6.1) → samme tier/pool_index.
  const youth = senior.map((p) => ({ ...p, id: p.id + 100, squad: "u23" }));
  const teams = Array.from({ length: 160 }, (_, i) => ({ teamId: `t${i}`, name: `Hold ${i}`, rank: i + 1, fromTier: 4, fromPoolId: 8 }));

  const plain = distributeCompression(teams, senior);
  const mixed = distributeCompression(teams, [...senior, ...youth]);
  assert.deepEqual(mixed, plain, "ungdomspuljerne ændrer intet");
  assert.ok(mixed.assignments.every((a) => a.toPoolId < 100), "ingen managerhold i en ungdomspulje");
  // Kontrol: som seniorpuljer ville de samme rækker vælte strukturtjekket (4 tier 2-puljer).
  assert.throws(() => distributeCompression(teams, [...senior, ...youth.map((p) => ({ ...p, squad: "senior" }))]), /expected 2 tier 2 pools/);
});

// ── Migrationen mod ægte DDL (PGlite) ────────────────────────────────────────────

let db;
before(async () => {
  db = await createTestDb();
});
after(async () => {
  if (db) await db.close();
});

const rows = async (sql, params) => (await db.query(sql, params)).rows;

test("#5517 createTestDb loader A2-migrationen", () => {
  assert.ok(RACE_HUB_SCHEMA_FILES.includes(MIGRATION_FILE));
  assert.ok(
    RACE_HUB_SCHEMA_FILES.indexOf(MIGRATION_FILE) > RACE_HUB_SCHEMA_FILES.indexOf("2026-09-15-4619-riders-squad.sql"),
    "dato-rækkefølge",
  );
});

test("#5517 kolonnerne findes med de rigtige defaults og nullability", async () => {
  const cols = await rows(
    `SELECT table_name, column_name, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND ((table_name IN ('league_divisions', 'races') AND column_name = 'squad')
          OR (table_name = 'teams' AND column_name IN ('u23_league_division_id', 'junior_league_division_id')))
      ORDER BY 1, 2`,
  );
  const byKey = Object.fromEntries(cols.map((c) => [`${c.table_name}.${c.column_name}`, c]));
  for (const key of ["league_divisions.squad", "races.squad"]) {
    assert.ok(byKey[key], `${key} skal findes`);
    assert.equal(byKey[key].is_nullable, "NO", `${key} er NOT NULL`);
    assert.match(byKey[key].column_default ?? "", /'senior'/, `${key} DEFAULT 'senior'`);
  }
  for (const key of ["teams.u23_league_division_id", "teams.junior_league_division_id"]) {
    assert.ok(byKey[key], `${key} skal findes`);
    assert.equal(byKey[key].is_nullable, "YES", `${key} er nullable (NULL = ingen ungdomspulje endnu)`);
  }
});

test("#5517 pulje-nøglen er (squad, tier, pool_index) — den gamle (tier, pool_index) er væk", async () => {
  await db.exec("BEGIN");
  try {
    await db.query("INSERT INTO league_divisions (tier, pool_index, label) VALUES (1, 0, 'Division 1')");
    const [def] = await rows("SELECT squad FROM league_divisions WHERE label = 'Division 1'");
    assert.equal(def.squad, "senior", "en pulje uden squad er senior (bit-identisk)");
    // Samme tier/pool_index under en anden trup er nu lovligt …
    await db.query("INSERT INTO league_divisions (squad, tier, pool_index, label) VALUES ('u23', 1, 0, 'U23 Division 1')");
    // … men en dublet inden for samme trup er det stadig ikke.
    await assert.rejects(
      db.query("INSERT INTO league_divisions (squad, tier, pool_index, label) VALUES ('u23', 1, 0, 'U23 dublet')"),
      /duplicate key|unique/i,
    );
  } finally {
    await db.exec("ROLLBACK");
  }
  const uniques = await rows(
    `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'public.league_divisions'::regclass AND contype = 'u'`,
  );
  assert.deepEqual(uniques.map((u) => u.def), ["UNIQUE (squad, tier, pool_index)"]);
  // tier-domænet er urørt: ungdomspuljer bruger tier 1-4 (spec §3.2).
  const [tierCheck] = await rows(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'public.league_divisions'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%tier%'`,
  );
  assert.match(tierCheck.def, /1.*2.*3.*4/);
});

test("#5517 CHECK afviser en ukendt trup på både puljer og løb (og er valideret)", async () => {
  await assert.rejects(
    db.query("INSERT INTO league_divisions (squad, tier, pool_index, label) VALUES ('pro', 2, 5, 'x')"),
    /league_divisions_squad_check/,
  );
  await assert.rejects(db.query("INSERT INTO races (name, squad) VALUES ('x', 'pro')"), /races_squad_check/);
  const checks = await rows(
    `SELECT conname, convalidated FROM pg_constraint
      WHERE conname IN ('league_divisions_squad_check', 'races_squad_check') ORDER BY 1`,
  );
  assert.deepEqual(checks, [
    { conname: "league_divisions_squad_check", convalidated: true },
    { conname: "races_squad_check", convalidated: true },
  ]);
});

test("#5517 et nyt løb er senior, og senior-scopets prædikat ser det (bit-identisk)", async () => {
  await db.exec("BEGIN");
  try {
    await db.query("INSERT INTO races (name) VALUES ('Løb A')");
    await db.query("INSERT INTO races (name, squad) VALUES ('Løb B', 'u23')");
    // Samme prædikat som SENIOR_SQUAD_OR_FILTER oversat til SQL.
    const seen = await rows("SELECT name FROM races WHERE (squad IS NULL OR squad = 'senior') ORDER BY name");
    assert.deepEqual(seen.map((r) => r.name), ["Løb A"]);
  } finally {
    await db.exec("ROLLBACK");
  }
  const [idx] = await rows("SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_races_season_squad'");
  assert.match(idx.indexdef, /\(season_id, squad\)/);
});

test("#5517 holdets ungdoms-FK: ON DELETE SET NULL, indekseret, og holdet overlever puljens sletning", async () => {
  const fks = await rows(
    `SELECT conname, confdeltype, confrelid::regclass::text AS target FROM pg_constraint
      WHERE conrelid = 'public.teams'::regclass
        AND conname IN ('teams_u23_league_division_id_fkey', 'teams_junior_league_division_id_fkey')
      ORDER BY 1`,
  );
  assert.deepEqual(fks, [
    { conname: "teams_junior_league_division_id_fkey", confdeltype: "n", target: "league_divisions" },
    { conname: "teams_u23_league_division_id_fkey", confdeltype: "n", target: "league_divisions" },
  ]);
  const idx = await rows(
    `SELECT indexname FROM pg_indexes
      WHERE indexname IN ('idx_teams_u23_league_division', 'idx_teams_junior_league_division') ORDER BY 1`,
  );
  assert.equal(idx.length, 2);

  await db.exec("BEGIN");
  try {
    const [pool] = await rows("INSERT INTO league_divisions (squad, tier, pool_index, label) VALUES ('u23', 2, 0, 'U23 Division 2') RETURNING id");
    const [team] = await rows("INSERT INTO teams (name, u23_league_division_id) VALUES ('Hold A', $1) RETURNING id", [pool.id]);
    await db.query("DELETE FROM league_divisions WHERE id = $1", [pool.id]);
    const [after] = await rows("SELECT u23_league_division_id FROM teams WHERE id = $1", [team.id]);
    assert.equal(after.u23_league_division_id, null);
  } finally {
    await db.exec("ROLLBACK");
  }
});

test("#5517 migrationen er idempotent: en genkørsel fejler ikke og ændrer ingen constraints", async () => {
  const snapshot = () => rows(
    `SELECT conrelid::regclass::text AS rel, conname, pg_get_constraintdef(oid) AS def
       FROM pg_constraint
      WHERE conrelid IN ('public.league_divisions'::regclass, 'public.races'::regclass, 'public.teams'::regclass)
      ORDER BY 1, 2`,
  );
  const before = await snapshot();
  const sql = sanitizeForPglite(readFileSync(join(DATABASE_DIR, MIGRATION_FILE), "utf8"));
  await db.exec(sql);
  await db.exec(sql);
  assert.deepEqual(await snapshot(), before);
});
