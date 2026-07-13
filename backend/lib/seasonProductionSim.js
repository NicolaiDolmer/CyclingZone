// backend/lib/seasonProductionSim.js
// Værdimodel v4 slice 1 (#2428), TRIN A — sæson-produktions-simulering: REN
// felt-tildeling + aggregering. INGEN DB her (I/O bor i
// scripts/simulateSeasonProduction.js, jf. #2428-kontrakten). Determinisme
// krævet: ingen Math.random/Date i denne fil.
//
// To ansvar, holdt adskilt så hver del er testbar mod små syntetiske fixtures:
//   1. assignSeasonFields — hvilke ryttere kører hvilke løb (FAST på tværs af
//      alle K Monte Carlo-runs; kun race-motorens interne seed varierer per run).
//   2. aggregateSeasonSamples — mean/sd/percentiler af K runs' resultRows pr. rytter.
//
// Felt-tildelings-invariant (§2428 Kontrakt 1, "1 rytter = 1 løb/dag som i drift",
// jf. project_race_overlap_intended_grace_rejected): en rytter kan ikke optræde i to
// løb der deler et game_day. Håndhæves via et GLOBALT busy-set keyed på game_day —
// når et hold får tildelt ryttere til et løb, markeres de optaget på ALLE løbets
// game_days (etapeløb spænder flere dage), så de er utilgængelige for ethvert andet
// løb der overlapper blot ét af dem. Løbene behandles i stigende game_day-orden
// (mindste game_day pr. løb, stabil id-tiebreak) — det er en BEVIDST, dokumenteret
// prioritering: løb der falder tidligere i sæsonen "vinder" ryttere ved konflikt.

import { autopickTeamSelection, selectionSizeForRace } from "./raceAutopick.js";
import { percentile } from "./valuationScorecard.js";

/**
 * Tildel et fast startfelt til hvert løb i sæsonen — ÉN gang, deterministisk,
 * ingen RNG. Kandidat-hold for et løb = hold i løbets division
 * (teamsByDivision-nøgle = race.league_division_id). Pr. hold: dets ledige
 * ryttere (ikke allerede optaget på nogen af løbets game_days) sendes gennem
 * autopickTeamSelection (samme funktion prod bruger til auto-fill).
 *
 * @param {{
 *   races: Array<{id, race_type, race_class?, league_division_id,
 *     stages: Array<{stage_number, profile_type, demand_vector, finale_type?}>,
 *     game_days: number[]}>,
 *   teamsByDivision: Map<number|string, string[]>,  // league_division_id → team_id[]
 *   ridersByTeam: Map<string, Array<{rider_id, abilities, form?, fatigue?}>>,
 * }} args
 * @returns {{
 *   entrantsByRaceId: Map<string, Array<{rider_id, team_id, abilities, race_role, form?, fatigue?}>>,
 *   stats: { races_considered, races_included, skipped_no_stages_or_schedule,
 *            skipped_no_division, skipped_no_candidate_teams, skipped_no_entrants },
 * }}
 */
export function assignSeasonFields({ races = [], teamsByDivision = new Map(), ridersByTeam = new Map() } = {}) {
  // busyByGameDay: game_day → Set(rider_id) allerede tildelt et løb på den dag.
  const busyByGameDay = new Map();
  const isBusy = (riderId, gameDays) => gameDays.some((gd) => busyByGameDay.get(gd)?.has(riderId));
  const markBusy = (riderId, gameDays) => {
    for (const gd of gameDays) {
      if (!busyByGameDay.has(gd)) busyByGameDay.set(gd, new Set());
      busyByGameDay.get(gd).add(riderId);
    }
  };

  // Stigende game_day (mindste dag pr. løb); stabil id-tiebreak ved lige dage.
  const sortedRaces = [...races].sort((a, b) => {
    const ga = a.game_days?.length ? Math.min(...a.game_days) : Infinity;
    const gb = b.game_days?.length ? Math.min(...b.game_days) : Infinity;
    if (ga !== gb) return ga - gb;
    return String(a.id).localeCompare(String(b.id));
  });

  const stats = {
    races_considered: sortedRaces.length,
    races_included: 0,
    skipped_no_stages_or_schedule: 0,
    skipped_no_division: 0,
    skipped_no_candidate_teams: 0,
    skipped_no_entrants: 0,
  };

  const entrantsByRaceId = new Map();
  for (const race of sortedRaces) {
    if (!race.stages?.length || !race.game_days?.length) {
      stats.skipped_no_stages_or_schedule++;
      continue;
    }
    if (race.league_division_id == null) {
      stats.skipped_no_division++;
      continue;
    }
    const teamIds = teamsByDivision.get(race.league_division_id) || [];
    if (!teamIds.length) {
      stats.skipped_no_candidate_teams++;
      continue;
    }

    const sizeRule = selectionSizeForRace(race);
    const entrants = [];
    for (const teamId of teamIds) {
      const roster = ridersByTeam.get(teamId) || [];
      const available = roster.filter((r) => !isBusy(r.rider_id, race.game_days));
      if (!available.length) continue;
      const picks = autopickTeamSelection({ riders: available, stages: race.stages, sizeRule });
      if (!picks.length) continue;
      const byId = new Map(available.map((r) => [r.rider_id, r]));
      for (const p of picks) {
        const r = byId.get(p.rider_id);
        entrants.push({
          rider_id: p.rider_id,
          team_id: teamId,
          abilities: r.abilities,
          race_role: p.race_role,
          ...(r.form != null ? { form: r.form } : {}),
          ...(r.fatigue != null ? { fatigue: r.fatigue } : {}),
        });
      }
      for (const p of picks) markBusy(p.rider_id, race.game_days);
    }

    if (!entrants.length) {
      stats.skipped_no_entrants++;
      continue;
    }
    entrantsByRaceId.set(race.id, entrants);
    stats.races_included++;
  }

  return { entrantsByRaceId, stats };
}

/**
 * Antal løb hver rytter faktisk blev tildelt (konstant på tværs af alle K runs,
 * da felt-tildelingen er fast — se assignSeasonFields).
 * @param {Map<string, Array<{rider_id}>>} entrantsByRaceId
 * @returns {Map<string, number>} rider_id → races_entered
 */
export function computeRacesEnteredByRider(entrantsByRaceId) {
  const counts = new Map();
  for (const entrants of entrantsByRaceId.values()) {
    for (const e of entrants) counts.set(e.rider_id, (counts.get(e.rider_id) || 0) + 1);
  }
  return counts;
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// Population-standardafvigelse (ddof=0): de K runs ER hele populationen af
// simulerede træk for dette artefakt (ikke en stikprøve af en større population).
function stddevPop(arr, m) {
  if (!arr.length) return 0;
  const variance = arr.reduce((s, v) => s + (v - m) * (v - m), 0) / arr.length;
  return Math.sqrt(variance);
}

/**
 * Summér points_earned/prize_money pr. rytter, PR. RUN. rider_id==null-rækker
 * (hold-klassementer — team_id sat, rider_id null) EKSKLUDERES (Kontrakt 1 §4).
 * @param {Array<Array<{rider_id, points_earned, prize_money}>>} runsResultRows K runs' flade resultRows.
 * @returns {Array<Map<string, {points:number, prize:number}>>} én Map pr. run.
 */
export function aggregateRunTotals(runsResultRows) {
  return runsResultRows.map((rows) => {
    const totals = new Map();
    for (const row of rows) {
      if (row.rider_id == null) continue; // hold-række, ikke en rytter — ekskludér
      const cur = totals.get(row.rider_id) || { points: 0, prize: 0 };
      cur.points += row.points_earned || 0;
      cur.prize += row.prize_money || 0;
      totals.set(row.rider_id, cur);
    }
    return totals;
  });
}

/**
 * Bygger de endelige pr.-rytter-sample-statistikker (mean/sd/percentiler) over
 * K runs. Kun ryttere til stede i racesEnteredByRider (dvs. faktisk tildelt
 * mindst ét løb af assignSeasonFields) indgår — en rytter der aldrig blev
 * tildelt et løb, optræder aldrig i runsResultRows og skal ikke gættes ind her.
 * En tildelt rytter der scorer 0 i et givent run tæller stadig med som 0 i det
 * run (ikke udeladt) — ellers ville mean/percentiler blive skævvredet opad.
 *
 * @param {{ runsResultRows: Array<Array<object>>, racesEnteredByRider: Map<string, number> }} args
 * @returns {Map<string, { races_entered, e_points, e_prize, sd_prize, p10_prize, p50_prize, p90_prize }>}
 */
export function aggregateSeasonSamples({ runsResultRows = [], racesEnteredByRider = new Map() } = {}) {
  const perRunTotals = aggregateRunTotals(runsResultRows);
  const K = perRunTotals.length;
  const out = new Map();
  if (K === 0) return out;

  for (const [riderId, racesEntered] of racesEnteredByRider) {
    if (!racesEntered) continue;
    const pointsArr = [];
    const prizeArr = [];
    for (const totals of perRunTotals) {
      const t = totals.get(riderId);
      pointsArr.push(t ? t.points : 0);
      prizeArr.push(t ? t.prize : 0);
    }
    const ePoints = mean(pointsArr);
    const ePrize = mean(prizeArr);
    const sdPrize = stddevPop(prizeArr, ePrize);
    const sortedPrize = [...prizeArr].sort((a, b) => a - b);
    out.set(riderId, {
      races_entered: racesEntered,
      e_points: ePoints,
      e_prize: ePrize,
      sd_prize: sdPrize,
      p10_prize: percentile(sortedPrize, 0.10),
      p50_prize: percentile(sortedPrize, 0.50),
      p90_prize: percentile(sortedPrize, 0.90),
    });
  }
  return out;
}
