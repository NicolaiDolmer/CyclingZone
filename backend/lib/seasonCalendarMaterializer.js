// Sæson-kalender-materializer (launch-checklist #2) — persisterer per-division-kalendre.
//
// Tager de rene udvalg fra divisionCalendarGenerator og skriver dem til DB pr. LIVE
// pulje: races-rows (med league_division_id) → race_stage_profiles (terræn, så
// ruteprofilen er synlig FØR løbet, launch-checklist #6) → race_stage_schedule +
// races.scheduled_for (stage-scheduleren afvikler dem automatisk).
//
// Wiring (gøres separat, kræver edits i eksisterende filer):
//   • relaunchOrchestrator.runRelaunchSeason1 — efter sæson 0→1-transitionen +
//     AI-fyld (puljer er populeret, sæson 1 er aktiv), så sæson 1 åbner med en
//     fuld per-division-kalender.
//   • seasonTransition.transitionToNextSeason — bag flag auto_calendar_enabled,
//     så HVER ny sæson (forever) får friske kalendre uden manuel race-selection.
//
// IDEMPOTENT: springer (pulje, pool_race) over hvis et løb allerede er
// materialiseret for sæsonen → re-run indsætter 0. dryRun=true previewer planen
// uden writes (default, samme forsigtigheds-mønster som relaunchOrchestrator).

import { generateDivisionCalendars } from "./divisionCalendarGenerator.js";
import { generateRaceStageProfiles, GENERATOR_VERSION } from "./raceStageProfileGenerator.js";
// planRaceSchedules er en ren funktion (ingen DB) eksporteret fra backfill-scriptet;
// CLI-guarden dér fyrer ikke ved import. (Kandidat til at flytte til lib/ senere.)
import { planRaceSchedules } from "../scripts/backfillRaceScheduledFor.js";
import { LAUNCH_POPULATION } from "./fictionalLaunchPopulation.js";

const INSERT_BATCH = 500;

// Samme "ægte manager"-diskriminator som aiTeamGenerator (#1688) — HOLD I SYNC, så
// kalender-liveness og AI-felt-liveness aldrig divergerer (en pulje med kalender men
// uden felt, eller omvendt, ville give løb der ikke kan afvikles).
function isRealManager(team) {
  return team.is_ai === false && !team.is_bank && !team.is_frozen && !team.is_test_account;
}

// edition_year = kalenderåret fra sæsonens start-dato (ren baggrunds-metadata, jf.
// #1126; sæson-nummeret er den spiller-vendte identitet). Samme logik som
// POST /admin/seasons/:id/race-selection.
function editionYearFrom(startDate) {
  if (!startDate) return null;
  const y = Number.parseInt(String(startDate).slice(0, 4), 10);
  return Number.isFinite(y) && y >= 2000 && y <= 2099 ? y : null;
}

/**
 * Materialisér per-division-kalendre for en sæson.
 *
 * @param {object}  args
 * @param {object}  args.supabase          service-role-klient (kalderen ejer den).
 * @param {string}  args.seasonId          sæsonen kalendrene tilhører.
 * @param {string} [args.seasonStartDate]  'YYYY-MM-DD' → edition_year.
 * @param {number} [args.baseSeed]         sæson-seed (per-pulje = baseSeed XOR pool.id).
 * @param {Date}   [args.from]             schedule-anker (etape 1 = from + 1 dag).
 * @param {object} [args.tierRaceClasses]  override af klasse-mix pr. tier.
 * @param {number} [args.raceDaysTarget]   løbsdage pr. division.
 * @param {number} [args.stageRaceQuota]   garanterede etapeløb pr. division.
 * @param {boolean}[args.dryRun=true]      true = preview uden writes.
 * @returns {Promise<object>} summary { dryRun, racesInserted, stageProfiles, stageSchedules, pools[] }
 */
export async function materializeSeasonCalendar({
  supabase,
  seasonId,
  seasonStartDate = null,
  baseSeed = LAUNCH_POPULATION.seed,
  from = new Date(),
  tierRaceClasses,
  raceDaysTarget,
  stageRaceQuota,
  dryRun = true,
  log = () => {},
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!seasonId) throw new Error("seasonId required");

  // 1. Puljer + ægte-manager-tælling pr. pulje (samme felter som aiTeamGenerator).
  const { data: pools, error: poolErr } = await supabase
    .from("league_divisions").select("id, tier, pool_index, label").order("tier").order("pool_index");
  if (poolErr) throw new Error(`league_divisions: ${poolErr.message}`);
  if (!pools?.length) return { dryRun, pools: [], racesInserted: 0, skipped: "no_pools" };

  const { data: teams, error: teamErr } = await supabase
    .from("teams").select("id, is_ai, is_bank, is_frozen, is_test_account, league_division_id");
  if (teamErr) throw new Error(`teams: ${teamErr.message}`);
  const realCountByPool = new Map();
  for (const t of teams || []) {
    if (isRealManager(t) && t.league_division_id != null) {
      realCountByPool.set(t.league_division_id, (realCountByPool.get(t.league_division_id) || 0) + 1);
    }
  }
  const poolsWithCounts = pools.map((p) => ({ ...p, realManagerCount: realCountByPool.get(p.id) || 0 }));

  // 2. Verdens-katalog (race_pool).
  const { data: catalog, error: catErr } = await supabase
    .from("race_pool").select("id, external_id, terrain_archetype, name, race_class, race_type, stages");
  if (catErr) throw new Error(`race_pool: ${catErr.message}`);
  // Seed-nøgle pr. katalog-løb (external_id) → identisk parcours i alle en divisions
  // puljer; terrain_archetype driver terrænfordelingen (jf. raceStageProfileGenerator.js).
  const externalIdByPoolRace = new Map((catalog || []).map((c) => [c.id, c.external_id ?? null]));
  const archetypeByPoolRace = new Map((catalog || []).map((c) => [c.id, c.terrain_archetype ?? null]));

  // 3. Eksisterende races i sæsonen → idempotens-nøgle (pulje:pool_race).
  const { data: existing, error: exErr } = await supabase
    .from("races").select("league_division_id, pool_race_id").eq("season_id", seasonId);
  if (exErr) throw new Error(`races (existing): ${exErr.message}`);
  const existingKey = new Set((existing || []).map((r) => `${r.league_division_id}:${r.pool_race_id}`));

  // 4. Rene udvalg pr. live pulje.
  const calendars = generateDivisionCalendars({
    pools: poolsWithCounts,
    catalog: catalog || [],
    ...(tierRaceClasses ? { tierRaceClasses } : {}),
    ...(raceDaysTarget ? { raceDaysTarget } : {}),
    ...(stageRaceQuota != null ? { stageRaceQuota } : {}),
    baseSeed,
  });

  // Global de-dup (#1714) kan beskære de sidste puljer hvis et klasse-segment løber
  // tør for etapeløb (katalog-loft: ~49 etapeløb < puljer × quota). Rapportér det
  // eksplicit i summary + log — ALDRIG tavs beskæring.
  const truncated = calendars.truncated || [];
  for (const t of truncated) {
    log(`  ⚠ pulje ${t.leagueDivisionId} (tier ${t.tier}) beskåret: ${t.stageRacesSelected}/${t.stageRaceTarget} etapeløb (mangler ${t.stageRacesShort})`);
  }

  const editionYear = editionYearFrom(seasonStartDate);
  const summary = { dryRun, editionYear, racesInserted: 0, stageProfiles: 0, stageSchedules: 0, truncated, pools: [] };

  // 5. Pr. pulje: skip allerede-materialiserede, insert races → profiler → schedule.
  for (const cal of calendars) {
    const fresh = cal.races.filter((r) => !existingKey.has(`${cal.leagueDivisionId}:${r.id}`));
    const line = { pool_id: cal.leagueDivisionId, tier: cal.tier, selected: cal.races.length, fresh: fresh.length, inserted: 0 };

    if (dryRun || fresh.length === 0) {
      summary.pools.push(line);
      continue;
    }

    const toInsert = fresh.map((r) => ({
      season_id: seasonId,
      league_division_id: cal.leagueDivisionId,
      pool_race_id: r.id,
      name: r.name,
      race_class: r.race_class,
      race_type: r.race_type,
      stages: r.stages,
      edition_year: editionYear,
      status: "scheduled",
    }));

    const insertedRaces = [];
    for (let i = 0; i < toInsert.length; i += INSERT_BATCH) {
      const { data, error } = await supabase
        .from("races").insert(toInsert.slice(i, i + INSERT_BATCH)).select("id, pool_race_id, name, race_type, stages");
      if (error) throw new Error(`races insert (pulje ${cal.leagueDivisionId}): ${error.message}`);
      insertedRaces.push(...(data || []));
    }
    summary.racesInserted += insertedRaces.length;

    // 5a. Stage-profiler (deterministisk pr. løbets external_id, jf. seedIdentityFor)
    // — synlige FØR løb (#6). external_id binder parcours til den virkelige løbs-
    // identitet, så puljerne i en division deler parcours.
    const profileRows = [];
    for (const race of insertedRaces) {
      const seedRace = { ...race, external_id: externalIdByPoolRace.get(race.pool_race_id) ?? null, terrain_archetype: archetypeByPoolRace.get(race.pool_race_id) ?? null, season_id: seasonId };
      for (const p of generateRaceStageProfiles(seedRace)) {
        profileRows.push({
          race_id: race.id,
          stage_number: p.stage_number,
          profile_type: p.profile_type,
          finale_type: p.finale_type,
          demand_vector: p.demand_vector,
          generator_version: GENERATOR_VERSION,
          is_manual: false,
        });
      }
    }
    for (let i = 0; i < profileRows.length; i += INSERT_BATCH) {
      const { error } = await supabase.from("race_stage_profiles").insert(profileRows.slice(i, i + INSERT_BATCH));
      if (error) throw new Error(`race_stage_profiles insert (pulje ${cal.leagueDivisionId}): ${error.message}`);
    }
    summary.stageProfiles += profileRows.length;

    // 5b. Schedule (scheduled_for + race_stage_schedule). planRaceSchedules fordeler
    // puljens løb på 2 parallelle spor (default) → tids-overlappende løb, så bindingen
    // (Fase 0a) er aktiv. Throughput uændret (2 etaper/dag/pulje); MAX_STAGES_PER_DAY rører vi ikke.
    const { raceUpdates, stageRows } = planRaceSchedules({ races: insertedRaces, from });
    for (const ru of raceUpdates) {
      const { error } = await supabase.from("races").update({ scheduled_for: ru.scheduled_for }).eq("id", ru.id);
      if (error) throw new Error(`races scheduled_for update ${ru.id}: ${error.message}`);
    }
    for (let i = 0; i < stageRows.length; i += INSERT_BATCH) {
      const { error } = await supabase.from("race_stage_schedule").insert(stageRows.slice(i, i + INSERT_BATCH));
      if (error) throw new Error(`race_stage_schedule insert (pulje ${cal.leagueDivisionId}): ${error.message}`);
    }
    summary.stageSchedules += stageRows.length;

    line.inserted = insertedRaces.length;
    summary.pools.push(line);
    log(`  pulje ${cal.leagueDivisionId} (tier ${cal.tier}): +${insertedRaces.length} løb · ${profileRows.length} profiler · ${stageRows.length} etape-tider`);
  }

  return summary;
}
