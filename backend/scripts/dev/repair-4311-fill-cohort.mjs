// #4311 REPARATIONS-SCRIPT — koeres IKKE af Claude. Ejer applierer selv efter merge
// (idempotent + post-verify, #2642-rammer). Kun SELECT mod prod under udvikling/
// verifikation; skrivninger sker udelukkende under --live.
//
// FORMAAL: 28/8 koerte topup-starter-depth.mjs (#4307, inaktive-hold-fyld) FOER
// #4311's evne-loft-fix landede. De fyld-ryttere der blev indsat den dag baerer
// derfor hverken generation_tag='fill_tail' eller et klemt potentiale, og deres
// tactics/hidden_potential kan laese som en normal senior (se #4311's issue-tekst).
// Dette script retter DEN specifikke kohorte op EFTER kode-fixet er merged.
//
// IDENTIFIKATION (maalt read-only mod prod 28/8, se PR #4311-bodyen for det fulde
// investigations-udtraek):
//   riders.created_at::date = '2026-08-28' AND riders.team_id IS NOT NULL
//   AND riders.base_value < 30000 AND riders.salary IS NOT NULL
//   AND holdets starter_squad_allocated_at::date != '2026-08-28'
//
// Den sidste betingelse er den afgoerende: 28/8 fik ÉT hold (12 ryttere) en helt
// NY start-trup via et almindeligt signup (allocateStarterSquadForTeam saetter
// starter_squad_allocated_at = i dag for DET hold) — de 12 ryttere er en rigtig
// spillers foerste trup, ikke fyld, og skal IKKE tagges her (selvom de OGSAA kommer
// fra buildWeakStarterPool og fremover automatisk faar taggen VED INSERT — denne
// reparation rammer kun den HISTORISKE 28/8-kohorte fra FOER kode-fixet).
// Alle andre hold der modtog ryttere 28/8 fik dem fra topup-starter-depth.mjs
// (fyld til eksisterende, for-svage trupper) — enten med markoeren korrekt sat
// (starter_depth_topped_up_at = 28/8, 52 hold, 234 ryttere) eller UDEN markoer
// fordi foerste koersel doede foer markoer-trinnet (37 hold, 177 ryttere).
// base_value<30000 + salary-sat er et baelte-og-seler-filter (begge grupper
// opfylder det i den maalte prod-kohorte; udelukker enhver anden rytterkilde
// der tilfaeldigvis er oprettet samme dag).
//
// Maalt 28/8 (foer reparation): 423 ryttere oprettet i dag med team_id, heraf
// 12 paa det ene nye-signup-hold (ekskluderes) => 411 fyld-ryttere paa 89 hold
// (52 med markoer + 37 uden).
//
// KOERSEL:
//   Dry-run (default, ingen writes):
//     infisical run --env=prod -- node backend/scripts/dev/repair-4311-fill-cohort.mjs
//   Live (efter ejer-go):
//     infisical run --env=prod -- node backend/scripts/dev/repair-4311-fill-cohort.mjs --live
//
// IDEMPOTENS: alle tre trin er sikre at koere flere gange.
//   - generation_tag/potentiale-opdateringen filtrerer PAA riders der endnu IKKE
//     baerer generation_tag='fill_tail' (WHERE-lignende filter i JS efter select).
//   - markoer-opdateringen filtrerer paa hold der stadig mangler starter_depth_topped_up_at.
//   - deriveForRiderIds er i forvejen idempotent (skriver samme output for samme input).
// En anden koersel efter den foerste finder derfor 0 kandidater og er et no-op.

import { createClient } from "@supabase/supabase-js";
import { deriveForRiderIds } from "../../lib/backfillCores.js";
import { fetchAllRows } from "../../lib/supabasePagination.js";
import { computeFrozenSalary } from "../../lib/contractSeed.js";
import { FILL_TAIL_GENERATION_TAG, FILL_TAIL_MAX_POTENTIALE } from "../../lib/abilityDerivation.js";

const LIVE = process.argv.includes("--live");
const TARGET_DATE = "2026-08-28";
const MAX_BASE_VALUE = 30000;
const SELECT_IN_BATCH = 150;

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("Mangler SUPABASE secrets (infisical run --env=prod)"); process.exit(1); }
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function fetchByIdsBatched(ids, table, columns, idCol = "id") {
  const out = [];
  for (let i = 0; i < ids.length; i += SELECT_IN_BATCH) {
    const chunk = ids.slice(i, i + SELECT_IN_BATCH);
    const rows = await fetchAllRows(() => sb.from(table).select(columns).in(idCol, chunk).order(idCol));
    out.push(...rows);
  }
  return out;
}

console.log(`${LIVE ? "LIVE" : "DRY-RUN"} — #4311 reparation af 28/8-fyld-kuldet\n`);

// 1) Kandidat-ryttere: oprettet 28/8, har et hold, endnu ikke tagget.
const dayStart = `${TARGET_DATE}T00:00:00Z`;
const dayEnd = "2026-08-29T00:00:00Z";
const createdToday = await fetchAllRows(() =>
  sb.from("riders")
    .select("id, team_id, base_value, salary, potentiale, generation_tag, created_at")
    .gte("created_at", dayStart).lt("created_at", dayEnd)
    .order("id"));
const withTeam = createdToday.filter((r) => r.team_id);
console.log(`Ryttere oprettet ${TARGET_DATE} med team_id: ${withTeam.length}`);

// 2) Hold-info for at udskille det ene nye-signup-hold.
const teamIds = [...new Set(withTeam.map((r) => r.team_id))];
const teamsInfo = await fetchByIdsBatched(teamIds, "teams", "id, starter_squad_allocated_at, starter_depth_topped_up_at");
const teamById = new Map(teamsInfo.map((t) => [t.id, t]));

const isNewSignupToday = (teamId) => {
  const t = teamById.get(teamId);
  const alloc = t?.starter_squad_allocated_at ? t.starter_squad_allocated_at.slice(0, 10) : null;
  return alloc === TARGET_DATE;
};

const fillCandidates = withTeam.filter((r) =>
  !isNewSignupToday(r.team_id) &&
  Number(r.base_value) < MAX_BASE_VALUE &&
  r.salary != null &&
  r.generation_tag !== FILL_TAIL_GENERATION_TAG);

console.log(`Fyld-kandidater (ekskl. dagens nye-signup-hold, base_value<${MAX_BASE_VALUE}, allerede utagget): ${fillCandidates.length}`);

const fillTeamIds = [...new Set(fillCandidates.map((r) => r.team_id))];
const teamsMissingMarker = fillTeamIds.filter((id) => {
  const t = teamById.get(id);
  const topped = t?.starter_depth_topped_up_at ? t.starter_depth_topped_up_at.slice(0, 10) : null;
  return topped !== TARGET_DATE;
});
console.log(`Hold ramt: ${fillTeamIds.length} (heraf ${teamsMissingMarker.length} uden korrekt markoer i dag — foerste koersel doede foer markoer-trinnet)`);

if (fillCandidates.length === 0) {
  console.log("\nIngen kandidater tilbage — allerede repareret (idempotent no-op).");
  process.exit(0);
}

if (!LIVE) {
  console.log("\n(dry-run — intet skrevet. Kør med --live efter ejer-go.)");
  process.exit(0);
}

// 3a+3b) generation_tag + potentiale-klem.
let tagged = 0;
for (const r of fillCandidates) {
  const potentiale = Number.isFinite(Number(r.potentiale))
    ? Math.min(FILL_TAIL_MAX_POTENTIALE, Number(r.potentiale))
    : r.potentiale;
  const { error } = await sb.from("riders")
    .update({ generation_tag: FILL_TAIL_GENERATION_TAG, potentiale })
    .eq("id", r.id);
  if (error) { console.error(`tag ${r.id}:`, error.message); process.exit(1); }
  tagged++;
}
console.log(`Tagget + potentiale-klemt: ${tagged} ryttere`);

// 3c) markoer paa hold der modtog fyld i dag men mangler den (crashed foerste koersel).
const nowIso = new Date().toISOString();
let markered = 0;
for (const teamId of teamsMissingMarker) {
  const { error } = await sb.from("teams").update({ starter_depth_topped_up_at: nowIso }).eq("id", teamId);
  if (error) { console.error(`markoer ${teamId}:`, error.message); process.exit(1); }
  markered++;
}
console.log(`Markoer sat paa: ${markered} hold`);

// 3d) re-derive (evne-loftet i abilityDerivation.js klemmer nu selv, da rytterne
// baerer generation_tag) + genberegn salary fra current_production_value.
const fillIds = fillCandidates.map((r) => r.id);
await deriveForRiderIds(sb, fillIds, { dryRun: false });
console.log(`Re-derived: ${fillIds.length} ryttere`);

const postDerive = await fetchByIdsBatched(fillIds, "riders", "id, current_production_value, potentiale, base_value");
let salariesUpdated = 0;
for (const r of postDerive) {
  const salary = computeFrozenSalary({ current_production_value: r.current_production_value });
  const { error } = await sb.from("riders").update({ salary }).eq("id", r.id);
  if (error) { console.error(`salary ${r.id}:`, error.message); process.exit(1); }
  salariesUpdated++;
}
console.log(`Salary genberegnet: ${salariesUpdated} ryttere`);

// 4) POST-VERIFY.
const abilities = await fetchByIdsBatched(fillIds, "rider_derived_abilities", "rider_id, tactics", "rider_id");
const overTactics = abilities.filter((a) => Number(a.tactics) > 15).length;
const overPotentiale = postDerive.filter((r) => Number(r.potentiale) > FILL_TAIL_MAX_POTENTIALE).length;
const baseValues = postDerive.map((r) => Number(r.base_value)).filter((v) => Number.isFinite(v));
console.log("\n── POST-VERIFY ──");
console.log(`antal med tactics > 15: ${overTactics} (skal vaere 0)`);
console.log(`antal med potentiale > ${FILL_TAIL_MAX_POTENTIALE}: ${overPotentiale} (skal vaere 0)`);
console.log(`base_value: min ${baseValues.length ? Math.min(...baseValues) : "—"} / max ${baseValues.length ? Math.max(...baseValues) : "—"}`);
if (overTactics > 0 || overPotentiale > 0) {
  console.error("\nFEJL: post-verify fandt afvigelser over loftet — se ovenfor.");
  process.exit(1);
}
console.log("\nLIVE færdig.");
