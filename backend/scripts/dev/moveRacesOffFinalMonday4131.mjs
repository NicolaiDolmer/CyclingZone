#!/usr/bin/env node
// backend/scripts/dev/moveRacesOffFinalMonday4131.mjs
// #4131 (ejer-direktiv 23/8, revideret): kalenderen er lovet spillerne som LAAST — en fuld
// regenerering (se docs/snapshots/4131/dry-run-2026-08-23.md) blev AFVIST fordi 82% af
// loebene ville skifte dato/pulje og 25 loeb ville forsvinde. Denne MINIMAL-PATCH-variant
// flytter KUN de 25 endagsloeb der i dag ligger mandag 21/9 til en tidligere dag i
// 25/8-20/9 — alt andet (navn, pulje, tier, etaper, oevrige 446 loeb) er 100% uroert.
//
// ALGORITME (pr. flyttet loeb, greedy, stabilt sorteret):
//   1. Find kandidat-dage i [2026-08-25, 2026-09-20] for loebets EGEN pulje
//      (league_division_id) — puljens oevrige loeb/etaper flyttes ALDRIG.
//   2. Vaelg dagen med FAeRREST loeb i puljen i dag, betinget af:
//      (a) GT-etaper-pr-dag i puljen den dag forbliver <= MAX_GT_STAGES_PER_DAY (4, #4121)
//      (b) loeb-i-puljen-den-dag efter flytning overstiger IKKE puljens NUVAeRENDE maks
//          pr. dag (maalt FOeR nogen flytning, ikke den evigt-voksende post-flytning-vaerdi)
//      (c) loeb-i-puljen-den-dag efter flytning overstiger IKKE TIER_OVERLAP_CAP[tier]
//          (samme kapacitets-tal som selve kalender-pakkeren bruger, raceCalendarLanePacker.js
//          / tierCalendarMaterializer.js — "1 rytter = 1 loeb/dag"-loftet)
//   3. scheduled_for + race_stage_schedule.scheduled_at saettes til samme klokkeslaet som et
//      EKSISTERENDE loeb i puljen den dag (genbruger TIER_STAGE_SLOTS-moenstret uden at
//      opfinde nye tider). game_day genbruges FRA et eksisterende loeb i puljen den dag
//      (samme bindings-noegle som resten af puljens loeb den dag — game_day-rummet er
//      sekventielt over HELE saesonens tidslinje, IKKE per-kalenderdag, saa det er forkert
//      at udlede et nyt tal isoleret; findes intet eksisterende loeb den dag i puljen,
//      allokeres et nyt game_day = (maks game_day i saesonen) + 1 og det FLAGES tydeligt
//      i output som en lavere-tillid-allokering, ikke stille).
//   4. game_day_start (races-tabellen) genbruges FRA et eksisterende loeb i puljen den dag.
//
// IDEMPOTENT: en race der IKKE laengere har scheduled_for=2026-09-21 (allerede flyttet af en
// tidligere koersel) springes over ved en gentaget koersel — ingen dobbelt-flytning.
//
// SIKKERHED
//   - DRY-RUN er default (100% read-only). --apply KRAeVER OGSAA env CONFIRM_4131=yes.
//   - Roerer ALDRIG andre loeb end de <=25 der reelt ligger 21/9 — ingen regenerering.
//   - Efter --apply: recomputeSeasonRaceDays() kaldes (samme mekanisme som materializeren,
//     #3990) saa seasons.race_days_total opdateres til 27.
//   - Entries: scriptet TAeLLER race_entries for saeson 3 FOeRST og rapporterer det — hvis
//     >0, regenereres entries for HELE saesonen via den eksisterende, allerede-testede
//     runRaceEntryGenerator({supabase, seasonId, dryRun:false}) (raceEntryGenerator.js),
//     IKKE ny logik. Er der 0 entries (S3 er 2 dage fra saesonstart, 23/8-maaling),
//     springes dette skridt over og rapporteres tydeligt.
//
// KOeRSEL
//   dry-run (default, laeser kun):
//     cd backend && infisical run --env=prod -- node scripts/dev/moveRacesOffFinalMonday4131.mjs
//   apply (skriver, kraever BEGGE flag):
//     cd backend && CONFIRM_4131=yes infisical run --env=prod -- node scripts/dev/moveRacesOffFinalMonday4131.mjs --apply
//
// Refs #4131

import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync } from "node:fs";
import { TIER_OVERLAP_CAP, TIER_STAGE_SLOTS } from "../../lib/tierCalendarMaterializer.js";
import { MAX_GT_STAGES_PER_DAY } from "../../lib/raceCalendarLanePacker.js";
import { recomputeSeasonRaceDays } from "../../lib/seasonRaceDays.js";
import { runRaceEntryGenerator } from "../../lib/raceEntryGenerator.js";

const SEASON_ID = "00000000-0000-0000-0000-000000000003";
const STALE_DAY = "2026-09-21"; // dagen der skal toemmes (ejer-direktiv 23/8, #4131)
const WINDOW_START = "2026-08-25";
const WINDOW_END = "2026-09-20";
const GT_MIN_STAGES = 15; // matcher verifySeason3Calendar.mjs

const APPLY = process.argv.includes("--apply");
const CONFIRMED = process.env.CONFIRM_4131 === "yes";
if (APPLY && !CONFIRMED) {
  console.error("STOP — --apply kraever ogsaa env CONFIRM_4131=yes. Koer dry-run foerst.");
  process.exit(1);
}

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE-secrets (koer via: infisical run --env=prod -- ...)");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

function datesBetween(a, b) {
  const out = [];
  let [y, m, d] = a.split("-").map(Number);
  const end = b;
  while (true) {
    const s = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    out.push(s);
    if (s === end) break;
    const nd = new Date(Date.UTC(y, m - 1, d + 1, 12));
    y = nd.getUTCFullYear(); m = nd.getUTCMonth() + 1; d = nd.getUTCDate();
    if (out.length > 200) throw new Error("datesBetween: for mange dage — sanity-stop");
  }
  return out;
}
const CANDIDATE_DAYS = datesBetween(WINDOW_START, WINDOW_END);

console.log("=== #4131 minimal-patch: flyt de 21/9-endagsloeb til tidligere dage ===");
console.log(APPLY ? "TILSTAND: APPLY (skriver til prod)" : "TILSTAND: DRY-RUN (100% read-only)");

// ── 1. Grunddata ────────────────────────────────────────────────────────────
const { data: races, error: rErr } = await supabase
  .from("races").select("id, name, race_type, stages, race_class, league_division_id, scheduled_for, game_day_start")
  .eq("season_id", SEASON_ID);
if (rErr) throw new Error(`races: ${rErr.message}`);
console.log(`Loeb i alt for saeson 3: ${races.length}`);

const { data: divs, error: dErr } = await supabase.from("league_divisions").select("id, tier");
if (dErr) throw new Error(`league_divisions: ${dErr.message}`);
const tierOf = new Map(divs.map((d) => [d.id, d.tier]));

const raceIds = races.map((r) => r.id);
let sched = [];
for (let i = 0; i < raceIds.length; i += 100) {
  const { data, error } = await supabase.from("race_stage_schedule").select("race_id, stage_number, scheduled_at, game_day").in("race_id", raceIds.slice(i, i + 100));
  if (error) throw new Error(`race_stage_schedule: ${error.message}`);
  sched.push(...data);
}
console.log(`race_stage_schedule-raekker: ${sched.length}`);

const dayOf = (iso) => String(iso).slice(0, 10);
const schedByRace = new Map();
for (const s of sched) {
  if (!schedByRace.has(s.race_id)) schedByRace.set(s.race_id, []);
  schedByRace.get(s.race_id).push(s);
}

// ── 2. Find de 25 maal-loeb ────────────────────────────────────────────────
const targets = races.filter((r) => r.race_type === "single" && r.scheduled_for && dayOf(r.scheduled_for) === STALE_DAY);
console.log(`\nLoeb med scheduled_for=${STALE_DAY} og race_type=single: ${targets.length}`);
if (targets.length === 0) {
  console.log("\nIngen loeb tilbage paa 21/9 — enten allerede flyttet (idempotent no-op), eller kalenderen matcher ikke forventningen. Intet at goere.");
}

// ── 3. Belastning FOeR flytning: pr. pulje, pr. dag (race-count + etape-count + GT-etaper) ──
const poolsInvolved = new Set(targets.map((r) => r.league_division_id));
const loadBefore = new Map(); // poolId -> Map(day -> {races:Set, etaper:number, gtEtaper:number})
const gtRaceIds = new Set(races.filter((r) => r.race_type === "stage_race" && r.stages >= GT_MIN_STAGES && (r.race_class === "TourFrance" || r.race_class === "GiroVuelta")).map((r) => r.id));

function ensurePoolDay(poolId, day) {
  if (!loadBefore.has(poolId)) loadBefore.set(poolId, new Map());
  const m = loadBefore.get(poolId);
  if (!m.has(day)) m.set(day, { races: new Set(), etaper: 0, gtEtaper: 0 });
  return m.get(day);
}
for (const r of races) {
  if (!poolsInvolved.has(r.league_division_id)) continue;
  const rows = schedByRace.get(r.id) || [];
  for (const s of rows) {
    const day = dayOf(s.scheduled_at);
    const cell = ensurePoolDay(r.league_division_id, day);
    cell.races.add(r.id);
    cell.etaper += 1;
    if (gtRaceIds.has(r.id)) cell.gtEtaper += 1;
  }
}
// Puljens NUVAeRENDE maks loeb/dag, maalt over vinduet 25/8-20/9 KUN (21/9 udelades bevidst —
// den dag skal jo netop toemmes, dens tal er ikke et loft vi vil bevare).
const poolMaxPerDay = new Map();
for (const poolId of poolsInvolved) {
  const m = loadBefore.get(poolId) || new Map();
  let max = 0;
  for (const day of CANDIDATE_DAYS) {
    const cell = m.get(day);
    if (cell) max = Math.max(max, cell.races.size);
  }
  poolMaxPerDay.set(poolId, max);
}

// ── 4. Find et EKSISTERENDE (tid, game_day) at genbruge for en given (pool, day) ──────
function existingSlotFor(poolId, day) {
  for (const r of races) {
    if (r.league_division_id !== poolId) continue;
    const rows = schedByRace.get(r.id) || [];
    for (const s of rows) {
      if (dayOf(s.scheduled_at) === day) return { time: String(s.scheduled_at).slice(11), game_day: s.game_day };
    }
  }
  return null;
}
const globalMaxGameDay = Math.max(0, ...sched.map((s) => s.game_day ?? 0));
let gameDayFallbackCounter = globalMaxGameDay;

// ── 5. Greedy-tildeling: mindst-belastede dag foerst, pr. maal-loeb (stabil raekkefoelge) ──
const sortedTargets = [...targets].sort((a, b) => String(a.id).localeCompare(String(b.id)));
const plan = []; // { race, from, to, newLoad, poolId, tier, note }
const workingLoad = new Map(); // poolId -> Map(day -> count)
for (const poolId of poolsInvolved) {
  const src = loadBefore.get(poolId) || new Map();
  const m = new Map();
  for (const day of CANDIDATE_DAYS) m.set(day, src.get(day)?.races?.size ?? 0);
  workingLoad.set(poolId, m);
}

const unresolved = [];
for (const race of sortedTargets) {
  const poolId = race.league_division_id;
  const tier = tierOf.get(poolId);
  const cap = Math.min(poolMaxPerDay.get(poolId) ?? Infinity, TIER_OVERLAP_CAP[tier] ?? 2);
  const m = workingLoad.get(poolId);
  const gtCellsByDay = loadBefore.get(poolId) || new Map();

  const ranked = [...CANDIDATE_DAYS].sort((a, b) => (m.get(a) - m.get(b)) || a.localeCompare(b));
  let chosen = null;
  for (const day of ranked) {
    const currentCount = m.get(day) ?? 0;
    if (currentCount + 1 > cap) continue; // (b)+(c): puljens nuvaerende maks / overlap-cap
    const gtThatDay = gtCellsByDay.get(day)?.gtEtaper ?? 0;
    if (gtThatDay > MAX_GT_STAGES_PER_DAY) continue; // (a) — defensivt
    chosen = day;
    break;
  }
  if (!chosen) {
    unresolved.push(race);
    continue;
  }
  m.set(chosen, (m.get(chosen) ?? 0) + 1);

  const slot = existingSlotFor(poolId, chosen);
  let time, game_day, note = "";
  if (slot) {
    time = slot.time; game_day = slot.game_day;
  } else {
    time = (TIER_STAGE_SLOTS[tier] || TIER_STAGE_SLOTS[3])[0] + ":00";
    gameDayFallbackCounter += 1;
    game_day = gameDayFallbackCounter;
    note = "INGEN eksisterende loeb i puljen denne dag — allokerede nyt game_day (lavere tillid, verificer manuelt)";
  }
  const scheduledAtIso = `${chosen}T${time.length === 5 ? time + ":00" : time}Z`;

  plan.push({
    raceId: race.id, name: race.name, poolId, tier,
    from: STALE_DAY, to: chosen, scheduledAtIso, game_day, newLoad: m.get(chosen), note,
  });
}

// ── 6. Rapport-tabel ────────────────────────────────────────────────────────
console.log(`\n── Flytnings-plan (${plan.length} loeb) ──`);
console.log("Loeb".padEnd(34) + "Pulje".padEnd(8) + "Fra".padEnd(13) + "Til".padEnd(13) + "Ny belastning".padEnd(16) + "Note");
for (const p of plan) {
  console.log(
    p.name.slice(0, 32).padEnd(34) + String(p.poolId).padEnd(8) + p.from.padEnd(13) + p.to.padEnd(13) + String(p.newLoad).padEnd(16) + p.note
  );
}
if (unresolved.length) {
  console.log(`\n⚠ ${unresolved.length} loeb kunne IKKE flyttes (ingen gyldig dag inden for kapacitets-loftet):`);
  for (const r of unresolved) console.log(`   - ${r.name} (pulje ${r.league_division_id})`);
}

// ── 7. Maalinger (foer/efter) ────────────────────────────────────────────────
function d1SingleRaceDays(loadMap) {
  const d1PoolId = [...divs].find((d) => d.tier === 1)?.id;
  const m = loadMap.get(d1PoolId);
  if (!m) return null;
  let count = 0;
  for (const day of CANDIDATE_DAYS) if ((m.get(day)?.races?.size ?? m.get(day) ?? 0) === 1) count++;
  return count;
}
function maxPerPoolBefore() {
  const out = new Map();
  for (const poolId of poolsInvolved) out.set(poolId, poolMaxPerDay.get(poolId));
  return out;
}
function maxPerPoolAfter() {
  const out = new Map();
  for (const poolId of poolsInvolved) {
    const m = workingLoad.get(poolId);
    out.set(poolId, Math.max(0, ...[...m.values()]));
  }
  return out;
}

console.log(`\n── Maalinger ──`);
console.log(`Loeb flyttet: ${plan.length} (mal: 25)`);
console.log(`Loeb med uaendret dato: ${races.length - plan.length} (mal: 446)`);
console.log(`D1-dage med kun 1 loeb FOER: ${d1SingleRaceDays(loadBefore)}`);
console.log(`Maks loeb/dag pr. pulje FOER: ${JSON.stringify([...maxPerPoolBefore()])}`);
console.log(`Maks loeb/dag pr. pulje EFTER: ${JSON.stringify([...maxPerPoolAfter()])}`);

// ── 8. Entries-tjek ───────────────────────────────────────────────────────
let entriesCount = 0;
for (let i = 0; i < raceIds.length; i += 100) {
  const { count, error } = await supabase.from("race_entries").select("race_id", { count: "exact", head: true }).in("race_id", raceIds.slice(i, i + 100));
  if (error) throw new Error(`race_entries: ${error.message}`);
  entriesCount += count ?? 0;
}
console.log(`\nrace_entries for saeson 3 (foer flytning): ${entriesCount}`);

// ── 9. Rapport-fil ────────────────────────────────────────────────────────
const nowStr = "2026-08-23";
let md = `# #4131 minimal-patch dry-run — flyt 21/9's endagsloeb\n\n`;
md += `Koert ${nowStr}, 100% read-only (prod-data via infisical). Flytter KUN de ${targets.length} endagsloeb der ligger paa mandag 21/9 til en tidligere dag i puljens EGEN kalender (25/8-20/9). Alt andet er uroert.\n\n`;
md += `## Maal\n\n| | Vaerdi | Maal |\n|---|---:|---:|\n`;
md += `| Loeb flyttet | ${plan.length} | 25 |\n`;
md += `| Loeb med uaendret dato | ${races.length - plan.length} | 446 |\n`;
md += `| D1-dage med kun 1 loeb (foer) | ${d1SingleRaceDays(loadBefore)} | — |\n`;
md += `| race_entries for saeson 3 (foer) | ${entriesCount} | — |\n`;
md += `\n## Maks loeb/dag pr. involveret pulje\n\n| Pulje | Tier | Foer | Efter |\n|---|---|---:|---:|\n`;
const before = maxPerPoolBefore(), after = maxPerPoolAfter();
for (const poolId of [...poolsInvolved].sort((a, b) => a - b)) {
  md += `| ${poolId} | ${tierOf.get(poolId)} | ${before.get(poolId)} | ${after.get(poolId)} |\n`;
}
md += `\n## Flytnings-plan (${plan.length} loeb)\n\n| Loeb | Pulje | Tier | Fra | Til | Ny belastning den dag | Note |\n|---|---|---|---|---|---:|---|\n`;
for (const p of plan) md += `| ${p.name} | ${p.poolId} | ${p.tier} | ${p.from} | ${p.to} | ${p.newLoad} | ${p.note} |\n`;
if (unresolved.length) {
  md += `\n## Uloeste (${unresolved.length})\n\n| Loeb | Pulje |\n|---|---|\n`;
  for (const r of unresolved) md += `| ${r.name} | ${r.league_division_id} |\n`;
}
md += `\n## Entries\n\nrace_entries for saeson 3 foer flytning: **${entriesCount}**. `;
md += entriesCount > 0
  ? `>0 fundet — --apply vil koere \`runRaceEntryGenerator({supabase, seasonId, dryRun:false})\` (eksisterende, allerede-testet motor) EFTER flytningen, saa entries for de flyttede loeb regenereres konsistent med resten af saesonen.\n`
  : `0 fundet (saeson 3 er ${nowStr}, 2 dage foer foerste loebsdag 25/8) — INGEN entries at flytte/regenerere. Springes over ved --apply.\n`;
md += `\n## Konklusion\n\n${unresolved.length === 0 ? `Alle ${plan.length} loeb kunne placeres inden for eksisterende kapacitets-loft (puljens nuvaerende maks/dag + TIER_OVERLAP_CAP + GT-dags-loft #4121). Diffen er PRAeCIS de ${plan.length} loeb — 0 andre loeb roert, 0 loeb fjernet, 0 puljer/tiers aendret.` : `${unresolved.length} loeb kunne IKKE placeres inden for eksisterende kapacitets-loft — se tabellen "Uloeste" ovenfor. Kraever ejer-beslutning (loesne loftet for netop disse dage, eller acceptere at de forbliver paa 21/9).`}\n`;

mkdirSync("../docs/snapshots/4131", { recursive: true });
writeFileSync("../docs/snapshots/4131/minimal-patch-dry-run-2026-08-23.md", md);
console.log(`\nRapport skrevet: docs/snapshots/4131/minimal-patch-dry-run-2026-08-23.md`);

// ── 10. APPLY ────────────────────────────────────────────────────────────
if (!APPLY) {
  console.log(`\nDRY-RUN slut — intet skrevet. Gentag med --apply (+ CONFIRM_4131=yes) for at skrive.`);
  process.exitCode = unresolved.length ? 1 : 0;
} else {
  if (unresolved.length) {
    console.error(`\nSTOP — ${unresolved.length} loeb kunne ikke placeres. Afviser at apply'e en delvis/inkonsistent plan.`);
    process.exit(1);
  }
  console.log(`\n--- APPLY ---`);
  for (const p of plan) {
    const { error: e1 } = await supabase.from("races").update({ scheduled_for: p.scheduledAtIso }).eq("id", p.raceId);
    if (e1) throw new Error(`races update (${p.raceId}): ${e1.message}`);
    const { error: e2 } = await supabase.from("race_stage_schedule").update({ scheduled_at: p.scheduledAtIso, game_day: p.game_day }).eq("race_id", p.raceId).eq("stage_number", 1);
    if (e2) throw new Error(`race_stage_schedule update (${p.raceId}): ${e2.message}`);
  }
  console.log(`${plan.length} loeb flyttet.`);

  for (const p of plan) {
    const sibling = races.find((r) => r.league_division_id === p.poolId && r.id !== p.raceId && dayOf(r.scheduled_for) === p.to);
    if (sibling?.game_day_start != null) {
      const { error } = await supabase.from("races").update({ game_day_start: sibling.game_day_start }).eq("id", p.raceId);
      if (error) throw new Error(`races game_day_start update (${p.raceId}): ${error.message}`);
    }
  }

  console.log(`\n--- recomputeSeasonRaceDays ---`);
  const raceDaysCompleted = await recomputeSeasonRaceDays({ supabase, seasonId: SEASON_ID });
  console.log(`race_days_completed: ${raceDaysCompleted}`);
  const { data: seasonRow } = await supabase.from("seasons").select("race_days_total").eq("id", SEASON_ID).maybeSingle();
  console.log(`seasons.race_days_total efter recompute: ${seasonRow?.race_days_total}`);
  if (seasonRow?.race_days_total !== 27) {
    console.error(`⚠ race_days_total er ${seasonRow?.race_days_total}, ikke 27 — undersoeg.`);
  }

  if (entriesCount > 0) {
    console.log(`\n--- runRaceEntryGenerator (eksisterende motor, dryRun:false) ---`);
    const result = await runRaceEntryGenerator({ supabase, seasonId: SEASON_ID, dryRun: false });
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`\nIngen entries fundet foer flytning — springer runRaceEntryGenerator over.`);
  }

  console.log(`\n✅ APPLY afsluttet. Verificer med verifySeason3Calendar.mjs.`);
}
