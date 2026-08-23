#!/usr/bin/env node
// #3371 - mindre mekanisk etaperækkefølge for S3's KORTE etapeløb (5-8 etaper).
// DRY-RUN ER DEFAULT.
//
// HVAD DETTE SCRIPT ER, OG HVAD DET IKKE ER.
// Ejer-direktiv 23/8: sæson 3's korte etapeløb har for mekaniske rækkefølger målt
// i prod (fx "itt>rolling>flat>itt>mountain>mountain>mountain>mountain" - 4 bjerg i
// træk). #4133's generator-fix (`weaveMountainFamilyBlocks()`) løser det KUN for
// FREMTIDIGE kalender-materialiseringer - S3 regenereres ikke (kalenderen er lovet
// spillerne som låst), så dette script er den eneste vej til at rette S3's
// EKSISTERENDE rækker inden sæsonskiftet i aften.
//
// SCOPE: kun S3-løb (season_id nedenfor) med race_type='stage_race' og PRÆCIS
// 5-8 persisterede race_stage_profiles-rækker (alle puljer/divisioner). Grand
// tours (15+ etaper) røres IKKE - ejer-krav.
//
// HVAD DER FLYTTES: kun race_stage_profiles.stage_number. Selve rækken (climbs,
// sectors, sprints, demand_vector, finale_type, distance_km, elevation_gain_m -
// v4/#3855's segments+weather ligger allerede INDE i disse kolonner, ikke i egne
// kolonner) flytter med, fordi det ER rækken der flytter - kun dens stage_number
// ændres. race_stage_schedule (dato pr. stage_number) RØRES ALDRIG: etape 1 er
// stadig første dag efter kørslen.
//
// AFLEDTE TABELLER (nøglet på race_id+stage_number): race_stage_moments,
// race_stage_passages, race_stage_roles - målt tomme for ALLE S3-løb 23/8 (se
// dry-run-rapportens "Afledte tabeller"-afsnit). race_entries er nøglet på
// (race_id, rider_id), ikke stage_number - ikke stage-scoped, røres aldrig her.
//
// SCOREREN: backend/scripts/lib/stageOrderReorder3371.js - ren, testet
// (`node --test scripts/lib/stageOrderReorder3371.test.js`), brute-force over
// permutationsrummet (n ≤ 8), vælger færrest hårde brud → mindst flytning →
// bedst åbning, deterministisk seedet pr. race_id. Se filens header for HVORFOR
// den er en ny scorer og ikke stageOrderMetrics.js (sæson- vs. løb-niveau).
//
// UNIQUE-CONSTRAINT (race_id, stage_number): apply skriver i to trin pr. løb -
// +100-offset først, så de rigtige mål-numre - for aldrig at ramme constrainten
// midt i en flytning.
//
// APPLY. Kræver BEGGE dele: CONFIRM_3371=yes i miljøet OG --apply. Skriver et
// før-snapshot af ALLE berørte rækker til docs/snapshots/3371/before-<dato>.json
// FØR den rører databasen. Idempotent: en 2. kørsel finder 0 løb at ændre
// (identity-permutationen vinder altid ties på flytning=0 - se scorerens tests).
//
// KØRSEL
//   dry-run mod prod (read-only), fra backend/:
//     infisical run --env=prod --silent -- node scripts/dev/reorderShortStageRaces3371.mjs
//   skrivning (ejer-gated på dagen, KUN efter ejer-go - orkestratoren kører IKKE selv):
//     CONFIRM_3371=yes infisical run --env=prod -- node scripts/dev/reorderShortStageRaces3371.mjs --apply
//
// Refs #3371 #4133.

import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { chooseBestOrder, countViolations, sequenceLabel } from "../lib/stageOrderReorder3371.js";

const SEASON_ID = "00000000-0000-0000-0000-000000000003";
const MIN_STAGES = 5;
const MAX_STAGES = 8;
const REPORT_DATE = "2026-08-23";
const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = join(__dirname, "..", "..", "..", "docs", "snapshots", "3371");

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const CONFIRMED = process.env.CONFIRM_3371 === "yes";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE-secrets (kør via: infisical run --env=prod -- ...)");
  process.exit(1);
}
if (APPLY && !CONFIRMED) {
  console.error("STOP - --apply kræver også miljøvariablen CONFIRM_3371=yes.");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const projectRef = (SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\./) || [])[1] || "ukendt";

console.log("=== #3371 - S3 kort-etapeløbs rækkefølge ===");
console.log(APPLY ? "TILSTAND: APPLY (skriver race_stage_profiles.stage_number)" : "TILSTAND: DRY-RUN (skriver intet)");
console.log(`Database : ${projectRef}`);

async function selectAll(table, cols, orderCol, filterFn) {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(cols).order(orderCol, { ascending: true }).range(from, from + PAGE - 1);
    if (filterFn) q = filterFn(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

// ── 1. Hent S3-løb + deres persisterede etaper ──────────────────────────────
const races = await selectAll(
  "races",
  "id, name, race_type, league_division_id",
  "id",
  (q) => q.eq("season_id", SEASON_ID).eq("race_type", "stage_race"),
);
const raceById = new Map(races.map((r) => [r.id, r]));

const allProfiles = await selectAll(
  "race_stage_profiles",
  "id, race_id, stage_number, profile_type",
  "race_id",
  (q) => q.in("race_id", races.map((r) => r.id)),
);

const byRace = new Map();
for (const p of allProfiles) {
  if (!byRace.has(p.race_id)) byRace.set(p.race_id, []);
  byRace.get(p.race_id).push(p);
}

const shortRaces = [];
for (const [raceId, rows] of byRace) {
  if (rows.length < MIN_STAGES || rows.length > MAX_STAGES) continue;
  rows.sort((a, b) => a.stage_number - b.stage_number);
  shortRaces.push({ race: raceById.get(raceId), rows });
}
shortRaces.sort((a, b) => (a.race.name === b.race.name ? a.race.league_division_id - b.race.league_division_id : a.race.name.localeCompare(b.race.name)));

console.log(`\nS3 etapeløb 5-8 etaper (alle puljer): ${shortRaces.length}`);

// ── 2. Afledte-tabel-tjek (§ opgavekravet) ──────────────────────────────────
const shortRaceIds = shortRaces.map((r) => r.race.id);
const [entries, roles, moments, passages] = await Promise.all([
  selectAll("race_entries", "race_id", "race_id", (q) => q.in("race_id", shortRaceIds)),
  selectAll("race_stage_roles", "race_id", "race_id", (q) => q.in("race_id", shortRaceIds)),
  selectAll("race_stage_moments", "race_id", "race_id", (q) => q.in("race_id", shortRaceIds)),
  selectAll("race_stage_passages", "race_id", "race_id", (q) => q.in("race_id", shortRaceIds)),
]);
console.log(`\nAfledte tabeller (race_id+stage_number-nøglet) for de ${shortRaces.length} berørte løb:`);
console.log(`   race_entries        : ${entries.length} (IKKE stage-scoped - key er race_id+rider_id, røres aldrig)`);
console.log(`   race_stage_roles    : ${roles.length}`);
console.log(`   race_stage_moments  : ${moments.length}`);
console.log(`   race_stage_passages : ${passages.length}`);
const derivedNonEmpty = roles.length + moments.length + passages.length;
if (derivedNonEmpty > 0) {
  console.error(`\nSTOP - ${derivedNonEmpty} rækker i afledte stage-scopede tabeller for berørte løb. Manuel gennemgang krævet før apply.`);
  process.exit(1);
}

// ── 3. Planlæg reorder pr. løb ───────────────────────────────────────────────
const plan = [];
let violationsBefore = 0;
let violationsAfter = 0;
let changedCount = 0;

for (const { race, rows } of shortRaces) {
  const result = chooseBestOrder(rows, race.id);
  violationsBefore += result.before.total;
  violationsAfter += result.after.total;
  if (result.changed) changedCount++;

  const origStageNumbers = rows.map((r) => r.stage_number);
  // origIdx → newPos (inverse af result.order, som er newPos → origIdx)
  const newPosForOrigIdx = new Array(rows.length);
  result.order.forEach((origIdx, newPos) => { newPosForOrigIdx[origIdx] = newPos; });

  const updates = rows.map((row, origIdx) => ({
    id: row.id,
    from: row.stage_number,
    to: origStageNumbers[newPosForOrigIdx[origIdx]],
  })).filter((u) => u.from !== u.to);

  plan.push({
    raceId: race.id,
    name: race.name,
    division: race.league_division_id,
    beforeSeq: sequenceLabel(rows.map((r) => r.profile_type)),
    afterSeq: sequenceLabel(result.order.map((origIdx) => rows[origIdx].profile_type)),
    before: result.before,
    after: result.after,
    displacement: result.displacement,
    changed: result.changed,
    updates,
  });
}

console.log(`\nLøb ændret : ${changedCount} / ${shortRaces.length}`);
console.log(`Løb uændret: ${shortRaces.length - changedCount}`);
console.log(`Brud (sum over alle løb) FØR : ${violationsBefore}`);
console.log(`Brud (sum over alle løb) EFTER: ${violationsAfter}`);

// ── 4. Dry-run-rapport (skrives altid - også ved --apply, som "før"-facit) ──
mkdirSync(SNAPSHOT_DIR, { recursive: true });
const reportLines = [];
reportLines.push(`# #3371 - dry-run: S3 kort-etapeløbs rækkefølge (${REPORT_DATE})`);
reportLines.push("");
reportLines.push(`Kørt mod: ${projectRef} · tilstand: ${APPLY ? "APPLY" : "DRY-RUN"}`);
reportLines.push("");
reportLines.push(`Scope: S3-løb (season_id ${SEASON_ID}), race_type=stage_race, 5-8 persisterede etaper. Grand tours (15+) rørt: 0 (uden for scope).`);
reportLines.push("");
reportLines.push(`## Resultat`);
reportLines.push(`- Løb i scope: ${shortRaces.length}`);
reportLines.push(`- Løb ændret: ${changedCount}`);
reportLines.push(`- Løb uændret (allerede 0 brud eller bedst mulig): ${shortRaces.length - changedCount}`);
reportLines.push(`- Brud (sum, de tre hårde regler) FØR: ${violationsBefore}`);
reportLines.push(`- Brud (sum) EFTER: ${violationsAfter}`);
reportLines.push("");
reportLines.push(`## Afledte tabeller (nøglet på race_id+stage_number)`);
reportLines.push(`race_stage_roles / race_stage_moments / race_stage_passages: 0 rækker for alle ${shortRaces.length} berørte løb - S3 er ikke startet endnu. race_entries: ${entries.length} rækker, men er nøglet på (race_id, rider_id) ikke stage_number - ikke stage-scoped, røres ikke. race_stage_schedule (dato pr. stage_number) røres bevidst ikke - etape 1 forbliver første dag.`);
reportLines.push("");
reportLines.push(`## Pr. løb (kun ændrede vises i detalje; uændrede opsummeres)`);
for (const p of plan) {
  if (!p.changed) continue;
  reportLines.push("");
  reportLines.push(`### ${p.name} (pulje ${p.division})`);
  reportLines.push(`- Før : \`${p.beforeSeq}\` (brud: ${p.before.total})`);
  reportLines.push(`- Efter: \`${p.afterSeq}\` (brud: ${p.after.total})`);
  reportLines.push(`- Flytning (sum |ny-gammel position|): ${p.displacement}`);
}
reportLines.push("");
reportLines.push(`## Uændrede løb`);
for (const p of plan) {
  if (p.changed) continue;
  reportLines.push(`- ${p.name} (pulje ${p.division}): \`${p.beforeSeq}\` (brud: ${p.before.total})`);
}
reportLines.push("");
reportLines.push(`## Apply-kommando`);
reportLines.push("```");
reportLines.push("cd backend");
reportLines.push("CONFIRM_3371=yes infisical run --env=prod -- node scripts/dev/reorderShortStageRaces3371.mjs --apply");
reportLines.push("```");
reportLines.push("");
reportLines.push(`Refs #3371 #4133.`);

const reportPath = join(SNAPSHOT_DIR, `dry-run-${REPORT_DATE}.md`);
writeFileSync(reportPath, reportLines.join("\n") + "\n", "utf8");
console.log(`\nDry-run-rapport skrevet: ${reportPath}`);

if (!APPLY) {
  console.log(`\nDRY-RUN slut - intet skrevet.`);
  console.log(`Skrivning kræver: CONFIRM_3371=yes + --apply + ejerens go på dagen.`);
  process.exit(0);
}

const toWrite = plan.filter((p) => p.changed);
if (!toWrite.length) {
  console.log("\nIntet at skrive - alle løb er allerede optimale. (Idempotent no-op.)");
  process.exit(0);
}

// ── 5. Før-snapshot af ALLE berørte rækker (FØR skrivning) ─────────────────
const affectedRaceIds = toWrite.map((p) => p.raceId);
const beforeRows = await selectAll(
  "race_stage_profiles",
  "id, race_id, stage_number, profile_type, finale_type, demand_vector, generator_version, is_manual, generated_at, distance_km, elevation_gain_m, climbs, sprints, sectors",
  "race_id",
  (q) => q.in("race_id", affectedRaceIds),
);
mkdirSync(SNAPSHOT_DIR, { recursive: true });
const beforePath = join(SNAPSHOT_DIR, `before-${REPORT_DATE}.json`);
writeFileSync(beforePath, JSON.stringify({ snapshotAt: new Date().toISOString(), raceCount: toWrite.length, rows: beforeRows }, null, 2), "utf8");
console.log(`\nFør-snapshot skrevet: ${beforePath} (${beforeRows.length} rækker, ${toWrite.length} løb)`);

// ── 6. Skrivning - to-trins swap pr. løb (undgår unique(race_id, stage_number)) ──
const OFFSET = 100;
let racesWritten = 0;
for (const p of toWrite) {
  // Trin 1: flyt alle berørte rækker til et sikkert offset-interval.
  for (const u of p.updates) {
    const { error } = await sb.from("race_stage_profiles").update({ stage_number: u.from + OFFSET }).eq("id", u.id);
    if (error) throw new Error(`${p.name} (offset-trin) række ${u.id}: ${error.message}`);
  }
  // Trin 2: sæt de rigtige mål-numre.
  for (const u of p.updates) {
    const { error } = await sb.from("race_stage_profiles").update({ stage_number: u.to }).eq("id", u.id);
    if (error) throw new Error(`${p.name} (mål-trin) række ${u.id}: ${error.message}`);
  }
  racesWritten++;
  if (racesWritten % 10 === 0) console.log(`   ${racesWritten}/${toWrite.length} løb skrevet`);
}
console.log(`\nSkrevet: ${racesWritten}/${toWrite.length} løb.`);

// ── 7. Post-verify ───────────────────────────────────────────────────────────
const afterRows = await selectAll(
  "race_stage_profiles",
  "id, race_id, stage_number, profile_type",
  "race_id",
  (q) => q.in("race_id", affectedRaceIds),
);
const afterByRace = new Map();
for (const r of afterRows) {
  if (!afterByRace.has(r.race_id)) afterByRace.set(r.race_id, []);
  afterByRace.get(r.race_id).push(r);
}

let verifyFail = 0;
for (const p of toWrite) {
  const rows = (afterByRace.get(p.raceId) || []).slice().sort((a, b) => a.stage_number - b.stage_number);
  const beforeForRace = beforeRows.filter((r) => r.race_id === p.raceId);

  if (rows.length !== beforeForRace.length) {
    console.error(`POST-VERIFY FEJL (${p.name}): etape-antal ændret (${beforeForRace.length} → ${rows.length}).`);
    verifyFail++;
    continue;
  }
  const beforeTypes = beforeForRace.map((r) => r.profile_type).sort();
  const afterTypes = rows.map((r) => r.profile_type).sort();
  if (JSON.stringify(beforeTypes) !== JSON.stringify(afterTypes)) {
    console.error(`POST-VERIFY FEJL (${p.name}): profile_type-multisæt ændret - kun rækkefølgen må ændre sig.`);
    verifyFail++;
    continue;
  }
  const v = countViolations(rows.map((r) => r.profile_type));
  if (v.mountainStreak > 0 || v.mountainBreak > 0) {
    console.error(`POST-VERIFY FEJL (${p.name}): maks-2-bjerg-reglen stadig brudt efter skrivning (${JSON.stringify(v)}).`);
    verifyFail++;
  }
}

if (verifyFail > 0) {
  console.error(`\nPOST-VERIFY FEJLEDE for ${verifyFail} løb. Se før-snapshot: ${beforePath}`);
  process.exit(1);
}
console.log(`\nPost-verify OK: alle ${toWrite.length} løb har 0 brud på maks-2-bjerg-reglen, samme etape-antal, samme profil-multisæt som før.`);
console.log(`Rollback: brug ${beforePath} (rækker matchet på id).`);
