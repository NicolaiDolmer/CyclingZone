#!/usr/bin/env node
// backend/scripts/dev/moveRacesOffFinalMonday4131.mjs
// #4131 (ejer-beslutning 23/8, ordret): "Vi skal have en kalender fra 25/8-20/9 paa lige
// saa mange loebsdage som vi havde planlagt i forvejen ... 1. division skal f.eks. have
// 28x5 loebsdage spredt ud paa 27 irl dage." INGEN loeb udgaar, INGEN regenerering — kun
// de 25 endagsloeb der ligger mandag 21/9 flyttes til en tidligere dag i deres EGEN pulje.
// Puljens loft for loeb/dag maa overskrides med noejagtigt +1 paa de dage det kraever
// (aldrig +2), spredt saa +1-dage ikke ligger i traek og ikke paa saesonens sidste 3 dage.
//
// Tidligere revision (git-historik) forsoegte at holde loftet STRENGT uaendret — det gav
// kun 5/25 flytbare loeb (kalenderen er 100% maettet, 0 slack). Denne revision implementerer
// ejerens eksplicitte +1-tilladelse i stedet.
//
// ALGORITME (pr. flyttet loeb, greedy, stabilt sorteret paa race.id):
//   1. Kandidat-dage = [2026-08-25 .. 2026-09-20], egen pulje (league_division_id) kun.
//   2. Feasible dag: (a) GT-etaper-pr-dag i puljen forbliver <= 4 (#4121 — trivielt sandt,
//      vi tilfoejer aldrig en GT-etape) OG (b) puljens loebs-antal den dag <= M_pool (dvs.
//      efter tilfoejelse bliver den <= M_pool+1 — ALDRIG +2, haandhaevet ved at et loeb der
//      allerede har naaet M_pool+1 aldrig kan vaelges igen).
//   3. Blandt feasible dage: vaelg LAVEST samlet belastning (loeb-antal foerst, etape-antal
//      som tiebreak). Delt lavest belastning: foretraek en dag der (a) IKKE ligger inden for
//      1 dags afstand af en allerede-tildelt +1-dag i SAMME pulje (helst >=2 dages mellemrum)
//      og (b) IKKE er blandt saesonens sidste 3 dage — begge er BLOeDE praeferencer
//      (tiebreak), ikke harde blokeringer, saa algoritmen aldrig fejler paa dem alene.
//   4. scheduled_for + race_stage_schedule.scheduled_at genbruger et EKSISTERENDE loebs
//      klokkeslaet i puljen den dag; game_day genbruges ligesaa (bindings-noeglerummet er
//      sekventielt over hele saesonen, ikke per-kalenderdag — se docstring i tidligere
//      revision). Findes intet eksisterende loeb den dag, allokeres et nyt game_day
//      (naeste ledige globalt) og det FLAGES i output.
//
// IDEMPOTENT: finder scriptet 0 loeb med scheduled_for=2026-09-21, stopper det med det
// samme (baade dry-run og --apply) — ingen dobbelt-flytning ved en gentaget koersel.
//
// SIKKERHED
//   - DRY-RUN er default (100% read-only). --apply KRAeVER OGSAA env CONFIRM_4131=yes.
//   - --apply skriver FOeRST et snapshot af de 25 raekkers FOeR-tilstand til
//     docs/snapshots/4131/moved-2026-08-23.json (rollback-grundlag).
//   - Efter skrivning: recomputeSeasonRaceDays() (#3990-mekanismen) saa
//     seasons.race_days_total bliver 27, og verifySeason3Calendar.mjs koeres som
//     post-verify (samme invarianter som apply-workflowets sidste trin).
//   - Entries: 0 fundet for saeson 3 ved denne maaling (2 dage foer foerste loebsdag) —
//     scriptet bekraefter tallet igen ved hver koersel og springer entry-regenerering over
//     naar det er 0. Bliver det >0 (fx en senere koersel taettere paa saesonstart),
//     regenereres entries for HELE saesonen via den eksisterende
//     runRaceEntryGenerator({supabase, seasonId, dryRun:false}) — ingen ny logik.
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
import { execFileSync } from "node:child_process";
import { TIER_STAGE_SLOTS } from "../../lib/tierCalendarMaterializer.js";
import { MAX_GT_STAGES_PER_DAY } from "../../lib/raceCalendarLanePacker.js";
import { recomputeSeasonRaceDays } from "../../lib/seasonRaceDays.js";
import { runRaceEntryGenerator } from "../../lib/raceEntryGenerator.js";
import { selectionSizeForRace } from "../../lib/raceAutopick.js";

const SEASON_ID = "00000000-0000-0000-0000-000000000003";
const STALE_DAY = "2026-09-21";
const WINDOW_START = "2026-08-25";
const WINDOW_END = "2026-09-20";
const GT_MIN_STAGES = 15;
const TODAY = "2026-08-23";

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
  while (true) {
    const s = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    out.push(s);
    if (s === b) break;
    const nd = new Date(Date.UTC(y, m - 1, d + 1, 12));
    y = nd.getUTCFullYear(); m = nd.getUTCMonth() + 1; d = nd.getUTCDate();
    if (out.length > 200) throw new Error("datesBetween: sanity-stop");
  }
  return out;
}
function dayDiff(a, b) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000);
}
const CANDIDATE_DAYS = datesBetween(WINDOW_START, WINDOW_END);
const LAST_3_DAYS = new Set(CANDIDATE_DAYS.slice(-3));

console.log("=== #4131 minimal-patch v2: flyt 21/9's endagsloeb (+1-loft tilladt, ejer-beslutning 23/8) ===");
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

// ── 2. Find de maal-loeb der (stadig) ligger 21/9 — idempotens-tjek ────────
const targets = races.filter((r) => r.race_type === "single" && r.scheduled_for && dayOf(r.scheduled_for) === STALE_DAY);
console.log(`\nLoeb med scheduled_for=${STALE_DAY} og race_type=single: ${targets.length}`);

if (targets.length === 0) {
  console.log("\n0 loeb tilbage paa 21/9 — allerede flyttet (idempotent no-op) ELLER kalenderen matcher ikke forventningen. Stopper.");
  process.exit(0);
}

// ── 3. Belastning FOeR flytning: pr. pulje, pr. dag ─────────────────────────
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
// M_pool: puljens NUVAeRENDE maks loeb/dag, malt over 25/8-20/9 (21/9 udelades — den skal
// jo netop toemmes).
const M_pool = new Map();
for (const poolId of poolsInvolved) {
  const m = loadBefore.get(poolId) || new Map();
  let max = 0;
  for (const day of CANDIDATE_DAYS) { const c = m.get(day); if (c) max = Math.max(max, c.races.size); }
  M_pool.set(poolId, max);
}

// ── 4. Genbrugbart (tid, game_day) for (pool, day) ─────────────────────────
function existingSlotFor(poolId, day) {
  for (const r of races) {
    if (r.league_division_id !== poolId) continue;
    const rows = schedByRace.get(r.id) || [];
    for (const s of rows) if (dayOf(s.scheduled_at) === day) return { time: String(s.scheduled_at).slice(11), game_day: s.game_day };
  }
  return null;
}
const globalMaxGameDay = Math.max(0, ...sched.map((s) => s.game_day ?? 0));
let gameDayFallbackCounter = globalMaxGameDay;

// ── 5. Greedy-tildeling med +1-loft + spredning af +1-dage ──────────────────
const sortedTargets = [...targets].sort((a, b) => String(a.id).localeCompare(String(b.id)));
const workingLoad = new Map(); // poolId -> Map(day -> {races, etaper})
for (const poolId of poolsInvolved) {
  const src = loadBefore.get(poolId) || new Map();
  const m = new Map();
  for (const day of CANDIDATE_DAYS) m.set(day, { races: src.get(day)?.races?.size ?? 0, etaper: src.get(day)?.etaper ?? 0 });
  workingLoad.set(poolId, m);
}
const capPlusOneDays = new Map(); // poolId -> Set(day)
for (const poolId of poolsInvolved) capPlusOneDays.set(poolId, new Set());

const plan = [];
const unresolved = [];
for (const race of sortedTargets) {
  const poolId = race.league_division_id;
  const tier = tierOf.get(poolId);
  const m = workingLoad.get(poolId);
  const gtCellsByDay = loadBefore.get(poolId) || new Map();
  const cap1Set = capPlusOneDays.get(poolId);
  const maxAllowed = M_pool.get(poolId); // +1 haandteres ved: count<=maxAllowed er feasible (bliver <=maxAllowed+1)

  const scored = CANDIDATE_DAYS.map((day) => {
    const cell = m.get(day);
    const count = cell.races;
    const etaper = cell.etaper;
    const feasible = count <= maxAllowed && (gtCellsByDay.get(day)?.gtEtaper ?? 0) <= MAX_GT_STAGES_PER_DAY;
    const wouldBeCapPlusOne = count === maxAllowed; // dette valg BRUGER +1-slottet
    let penalty = 0;
    if (wouldBeCapPlusOne) {
      const nearExistingCap1 = [...cap1Set].some((d2) => d2 !== day && Math.abs(dayDiff(day, d2)) < 2);
      if (nearExistingCap1) penalty += 1;
      if (LAST_3_DAYS.has(day)) penalty += 1;
    }
    return { day, count, etaper, feasible, wouldBeCapPlusOne, penalty };
  }).filter((c) => c.feasible)
    .sort((a, b) => a.count - b.count || a.penalty - b.penalty || a.etaper - b.etaper || a.day.localeCompare(b.day));

  const chosen = scored[0];
  if (!chosen) { unresolved.push(race); continue; }

  m.set(chosen.day, { races: chosen.count + 1, etaper: chosen.etaper + 1 });
  if (chosen.wouldBeCapPlusOne) cap1Set.add(chosen.day);

  const slot = existingSlotFor(poolId, chosen.day);
  let time, game_day, note = "";
  if (slot) { time = slot.time; game_day = slot.game_day; }
  else {
    time = (TIER_STAGE_SLOTS[tier] || TIER_STAGE_SLOTS[3])[0] + ":00";
    gameDayFallbackCounter += 1;
    game_day = gameDayFallbackCounter;
    note = "INGEN eksisterende loeb i puljen denne dag — nyt game_day allokeret (lavere tillid)";
  }
  const scheduledAtIso = `${chosen.day}T${time.length === 5 ? time + ":00" : time}Z`;

  plan.push({
    raceId: race.id, name: race.name, poolId, tier,
    from: STALE_DAY, to: chosen.day, scheduledAtIso, game_day,
    loadBeforeThisMove: chosen.count, loadAfterThisMove: chosen.count + 1,
    capStatus: chosen.wouldBeCapPlusOne ? `+1 (var ${maxAllowed})` : "inden for eksisterende loft",
    note,
  });
}

// ── 6. Rapport-tabel (console) ──────────────────────────────────────────────
console.log(`\n── Flytnings-plan (${plan.length} loeb) ──`);
console.log("Loeb".padEnd(34) + "Pulje".padEnd(7) + "Fra".padEnd(12) + "Til".padEnd(12) + "Foer".padEnd(6) + "Efter".padEnd(7) + "Cap-status".padEnd(24) + "Note");
for (const p of plan) {
  console.log(
    p.name.slice(0, 32).padEnd(34) + String(p.poolId).padEnd(7) + p.from.padEnd(12) + p.to.padEnd(12) +
    String(p.loadBeforeThisMove).padEnd(6) + String(p.loadAfterThisMove).padEnd(7) + p.capStatus.padEnd(24) + p.note
  );
}
if (unresolved.length) {
  console.log(`\n⚠ ${unresolved.length} loeb kunne IKKE flyttes (selv med +1-loftet):`);
  for (const r of unresolved) console.log(`   - ${r.name} (pulje ${r.league_division_id})`);
}

// ── 7. Pr.-pulje opsummering + game-days-uaendret-verifikation ─────────────
const perPoolSummary = [];
for (const poolId of [...poolsInvolved].sort((a, b) => a - b)) {
  const cap1Count = capPlusOneDays.get(poolId).size;
  const racesInPoolBefore = races.filter((r) => r.league_division_id === poolId).length;
  perPoolSummary.push({ poolId, tier: tierOf.get(poolId), M_pool: M_pool.get(poolId), cap1Days: cap1Count, cap1DayList: [...capPlusOneDays.get(poolId)].sort(), racesInPool: racesInPoolBefore });
}
console.log(`\n── Pr.-pulje: cap+1-dage + loebs-antal (uaendret pr. definition — vi flytter kun DATO) ──`);
for (const s of perPoolSummary) {
  console.log(`  pulje ${s.poolId} (tier ${s.tier}): M_pool=${s.M_pool} · cap+1-dage=${s.cap1Days} [${s.cap1DayList.join(", ")}] · loeb i puljen=${s.racesInPool} (uaendret)`);
}

// ── 8. Maalinger ─────────────────────────────────────────────────────────
console.log(`\n── Maalinger ──`);
console.log(`Loeb flyttet: ${plan.length} (mal: 25)`);
console.log(`Loeb med uaendret dato: ${races.length - plan.length} (mal: 446)`);

// ── 9. Entries-tjek ─────────────────────────────────────────────────────
let entriesCount = 0;
for (let i = 0; i < raceIds.length; i += 100) {
  const { count, error } = await supabase.from("race_entries").select("race_id", { count: "exact", head: true }).in("race_id", raceIds.slice(i, i + 100));
  if (error) throw new Error(`race_entries: ${error.message}`);
  entriesCount += count ?? 0;
}
console.log(`\nrace_entries for saeson 3 (foer flytning): ${entriesCount}`);

// ── 10. Bemandings-analyse for de cap+1-ramte puljer ────────────────────
const staffingByPool = [];
const poolsWithCap1 = perPoolSummary.filter((s) => s.cap1Days > 0);
if (poolsWithCap1.length) {
  const involvedPoolIds = poolsWithCap1.map((s) => s.poolId);
  const { data: teams, error: tErr } = await supabase.from("teams")
    .select("id, is_ai, is_bank, is_test_account, league_division_id")
    .in("league_division_id", involvedPoolIds);
  if (tErr) throw new Error(`teams: ${tErr.message}`);
  const humanTeams = (teams || []).filter((t) => t.is_ai === false && !t.is_bank && !t.is_test_account);
  const teamIds = humanTeams.map((t) => t.id);

  let riderRows = [];
  for (let i = 0; i < teamIds.length; i += 100) {
    const { data, error } = await supabase.from("riders")
      .select("id, team_id, is_academy, is_retired")
      .in("team_id", teamIds.slice(i, i + 100));
    if (error) throw new Error(`riders: ${error.message}`);
    riderRows.push(...data);
  }
  // #3896: skades-status bor i rider_condition (rider_id, injured_until), ikke paa
  // riders selv — samme kilde som raceEntryGenerator.js's kanoniske applyInjuredFilter.
  const riderIds = riderRows.map((r) => r.id);
  const injuredUntilByRider = new Map();
  for (let i = 0; i < riderIds.length; i += 100) {
    const { data, error } = await supabase.from("rider_condition")
      .select("rider_id, injured_until")
      .in("rider_id", riderIds.slice(i, i + 100));
    if (error) throw new Error(`rider_condition: ${error.message}`);
    for (const row of data) injuredUntilByRider.set(row.rider_id, row.injured_until ?? null);
  }
  const isEligible = (r) => {
    if (r.is_academy === true || r.is_retired === true) return false;
    const iu = injuredUntilByRider.get(r.id) ?? null;
    return !iu || iu < TODAY;
  };
  const squadByTeam = new Map();
  for (const t of humanTeams) squadByTeam.set(t.id, 0);
  for (const r of riderRows) if (isEligible(r)) squadByTeam.set(r.team_id, (squadByTeam.get(r.team_id) ?? 0) + 1);

  for (const s of poolsWithCap1) {
    const poolTeamIds = humanTeams.filter((t) => t.league_division_id === s.poolId).map((t) => t.id);
    const squadSizes = poolTeamIds.map((id) => squadByTeam.get(id) ?? 0).sort((a, b) => a - b);
    const min = squadSizes[0] ?? 0;
    const median = squadSizes.length ? squadSizes[Math.floor(squadSizes.length / 2)] : 0;

    for (const day of s.cap1DayList) {
      // Alle loeb i puljen den dag (eksisterende + evt. flyttede) — summen af deres
      // udtagelses-stoerrelse (max) er det VAeRSTE tilfaelde "ét hold i alle dagens loeb".
      const raceIdsToday = new Set();
      for (const r of races) {
        if (r.league_division_id !== s.poolId) continue;
        const rows = schedByRace.get(r.id) || [];
        if (rows.some((row) => dayOf(row.scheduled_at) === day)) raceIdsToday.add(r.id);
      }
      for (const p of plan) if (p.poolId === s.poolId && p.to === day) raceIdsToday.add(p.raceId);

      const racesTodayObjs = [...raceIdsToday].map((id) => races.find((r) => r.id === id)).filter(Boolean);
      const required = racesTodayObjs.reduce((sum, r) => sum + selectionSizeForRace(r).max, 0);
      const unstaffable = poolTeamIds.filter((id) => (squadByTeam.get(id) ?? 0) < required).length;

      staffingByPool.push({ poolId: s.poolId, tier: s.tier, day, teams: poolTeamIds.length, minSquad: min, medianSquad: median, required, unstaffable });
    }
  }
}
console.log(`\n── Bemanding paa cap+1-dage ──`);
for (const st of staffingByPool) {
  console.log(`  pulje ${st.poolId} (tier ${st.tier}), ${st.day}: ${st.teams} hold · min trup=${st.minSquad} · median trup=${st.medianSquad} · rytter-behov=${st.required} · IKKE fuldt bemandede hold=${st.unstaffable}`);
}

// ── 11. Rapport-fil ─────────────────────────────────────────────────────
let md = `# #4131 minimal-patch dry-run v2 — flyt 21/9's endagsloeb (+1-loft, ejer-beslutning 23/8)\n\n`;
md += `Koert ${TODAY}, 100% read-only (prod-data via infisical). Ejer-beslutning ordret: "Vi skal have en kalender fra 25/8-20/9 paa lige saa mange loebsdage som vi havde planlagt i forvejen ... Det kan vi godt faa til at fungere." INGEN loeb udgaar, INGEN regenerering — kun de ${targets.length} endagsloeb der ligger 21/9 flyttes, puljens loft maa overskrides med +1 paa de dage det kraever.\n\n`;
md += `## Maal\n\n| | Vaerdi | Maal |\n|---|---:|---:|\n`;
md += `| Loeb flyttet | ${plan.length} | 25 |\n`;
md += `| Loeb med uaendret dato | ${races.length - plan.length} | 446 |\n`;
md += `| race_entries for saeson 3 (foer) | ${entriesCount} | 0 |\n`;
md += `\n## Pr.-pulje: cap+1-dage + loebs-antal (verifikation: samlet loebs-antal pr. pulje er UAeNDRET — vi flytter kun DATO, ingen loeb tilfoejes/fjernes)\n\n`;
md += `| Pulje | Tier | M_pool (foer) | cap+1-dage | Dage | Loeb i puljen |\n|---|---|---:|---:|---|---:|\n`;
for (const s of perPoolSummary) md += `| ${s.poolId} | ${s.tier} | ${s.M_pool} | ${s.cap1Days} | ${s.cap1DayList.join(", ") || "—"} | ${s.racesInPool} |\n`;
md += `\n## Flytnings-plan (${plan.length} loeb)\n\n| Loeb | Pulje | Tier | Fra | Til | Belastning foer→efter | Cap-status | Note |\n|---|---|---|---|---|---|---|---|\n`;
for (const p of plan) md += `| ${p.name} | ${p.poolId} | ${p.tier} | ${p.from} | ${p.to} | ${p.loadBeforeThisMove}→${p.loadAfterThisMove} | ${p.capStatus} | ${p.note} |\n`;
if (unresolved.length) {
  md += `\n## Uloeste (${unresolved.length})\n\n| Loeb | Pulje |\n|---|---|\n`;
  for (const r of unresolved) md += `| ${r.name} | ${r.league_division_id} |\n`;
}
md += `\n## Bemanding paa cap+1-dage (information til ejeren, ikke en blokering)\n\n`;
if (staffingByPool.length) {
  md += `| Pulje | Tier | Dag | Hold | Min trup | Median trup | Rytter-behov (alle loeb den dag) | Hold der IKKE kan bemande fuldt |\n|---|---|---|---:|---:|---:|---:|---:|\n`;
  for (const st of staffingByPool) md += `| ${st.poolId} | ${st.tier} | ${st.day} | ${st.teams} | ${st.minSquad} | ${st.medianSquad} | ${st.required} | ${st.unstaffable} |\n`;
} else {
  md += `Ingen cap+1-dage opstod — alle 25 loeb kunne placeres inden for puljernes eksisterende loft.\n`;
}
md += `\n## Entries\n\nrace_entries for saeson 3 foer flytning: **${entriesCount}**. `;
md += entriesCount > 0
  ? `>0 fundet — --apply regenererer entries for HELE saesonen via \`runRaceEntryGenerator({supabase, seasonId, dryRun:false})\` (eksisterende motor) EFTER flytningen.\n`
  : `0 fundet (saeson 3 er ${TODAY}, 2 dage foer foerste loebsdag 25/8) — springes over ved --apply.\n`;
md += `\n## Konklusion\n\n${unresolved.length === 0 ? `Alle ${plan.length} loeb placeret. ${perPoolSummary.reduce((s, p) => s + p.cap1Days, 0)} cap+1-dage i alt paa tvaers af ${poolsWithCap1.length} puljer (se bemandings-tabellen for ejerens beslutningsgrundlag). 0 loeb fjernet, 0 puljer/tiers aendret, 0 andre loeb roert.` : `${unresolved.length} loeb kunne ikke placeres selv med +1-loftet — se "Uloeste" ovenfor.`}\n`;

mkdirSync("../docs/snapshots/4131", { recursive: true });
writeFileSync("../docs/snapshots/4131/minimal-patch-dry-run-2026-08-23.md", md);
console.log(`\nRapport skrevet: docs/snapshots/4131/minimal-patch-dry-run-2026-08-23.md`);

// ── 12. APPLY ────────────────────────────────────────────────────────────
if (!APPLY) {
  console.log(`\nDRY-RUN slut — intet skrevet. Gentag med --apply (+ CONFIRM_4131=yes) for at skrive.`);
  process.exitCode = unresolved.length ? 1 : 0;
} else {
  if (unresolved.length) {
    console.error(`\nSTOP — ${unresolved.length} loeb kunne ikke placeres selv med +1-loftet. Afviser at apply'e en delvis plan.`);
    process.exit(1);
  }
  console.log(`\n--- Snapshot (foer-tilstand) ---`);
  const snapshotRows = targets.map((r) => ({
    id: r.id, name: r.name, league_division_id: r.league_division_id,
    scheduled_for: r.scheduled_for, game_day_start: r.game_day_start,
    schedule: (schedByRace.get(r.id) || []).map((s) => ({ stage_number: s.stage_number, scheduled_at: s.scheduled_at, game_day: s.game_day })),
  }));
  writeFileSync("../docs/snapshots/4131/moved-2026-08-23.json", JSON.stringify({ takenAt: new Date().toISOString(), seasonId: SEASON_ID, rows: snapshotRows }, null, 2));
  console.log(`Snapshot skrevet: docs/snapshots/4131/moved-2026-08-23.json (${snapshotRows.length} raekker)`);

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
  if (seasonRow?.race_days_total !== 27) console.error(`⚠ race_days_total er ${seasonRow?.race_days_total}, ikke 27 — undersoeg.`);

  if (entriesCount > 0) {
    console.log(`\n--- runRaceEntryGenerator (eksisterende motor, dryRun:false) ---`);
    const result = await runRaceEntryGenerator({ supabase, seasonId: SEASON_ID, dryRun: false });
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`\nIngen entries fundet foer flytning — springer runRaceEntryGenerator over.`);
  }

  console.log(`\n--- Post-verify: verifySeason3Calendar.mjs ---`);
  try {
    execFileSync(process.execPath, ["scripts/dev/verifySeason3Calendar.mjs"], { stdio: "inherit", env: process.env });
    console.log(`\n✅ APPLY afsluttet. Post-verify OK.`);
  } catch (e) {
    console.error(`\n❌ Post-verify FEJLEDE (verifySeason3Calendar.mjs exit != 0). Undersoeg FOeR videre skridt.`);
    process.exitCode = 1;
  }
}
