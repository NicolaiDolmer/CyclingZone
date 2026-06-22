// Per-division kalender-generator (launch-checklist #2) — REN funktion (ingen DB/I/O).
//
// Givet liga-puljerne (league_divisions) + verdens-kataloget (race_pool), vælg ét
// sæt løb PR. LIVE pulje, så hver division/pulje får sin EGEN kalender:
// "Division 1 kører deres egne løb." seasonCalendarMaterializer.js persisterer output.
//
// Pulje-liveness spejler aiTeamGenerator.targetAiCountForPool (#1688) — så vi aldrig
// genererer løb til en pulje uden et felt at køre dem i:
//   tier 1 + 2  → ALTID en kalender (felterne er altid AI-fyldte til POOL_TARGET_SIZE).
//   tier 3 + 4  → kun puljer med >=1 ægte manager. Med managere i tier 3
//                 (MANAGER_ENTRY_DIVISION=3) er div-4-puljerne tomme → ingen kalender.
//
// Determinisme: seed pr. pulje = baseSeed XOR pool.id (league_divisions.id er SERIAL),
// så hver pulje får en varieret men reproducerbar kalender (samme per-pulje-seed-mønster
// som aiTeamGenerator). selectSeasonRaces er allerede seed-stabil (#1124).

import {
  selectSeasonRaces,
  DEFAULT_RACE_DAYS_TARGET,
  FIRST_SEASON_STAGE_RACE_QUOTA,
} from "./seasonRaceSelection.js";

// ── EJER-TUNBAR: race-klasser pr. tier ──────────────────────────────────────────
// Pyramide-logik: toppen kører de prestigefyldte WorldTour/Grand Tours; indgangs-
// og bund-tierene kører Continental Circuit (ProSeries/Class 1/Class 2). Managere
// starter i tier 3 (MANAGER_ENTRY_DIVISION=3) → de kører ProSeries + Class 1, og de
// nye Class 1/2-løb (launch-checklist #5) lander dermed i tier 3-4.
//
// ÅBEN EJER-BESLUTNING (bekræftes inden launch): den præcise klasse-mix pr. tier +
// om sæson 1 skal være helt WorldTour-fri (jf. selectFirstSeasonRaces' WT-exclude).
// Da tier 1-2 er ren-AI ved launch (managere i tier 3), påvirker WT-løb dér ikke
// menneske-oplevelsen i sæson 1 — men mixet kan overrides pr. kald.
export const DEFAULT_TIER_RACE_CLASSES = Object.freeze({
  1: ["TourFrance", "GiroVuelta", "Monuments", "OtherWorldTourA", "OtherWorldTourB", "OtherWorldTourC"],
  2: ["OtherWorldTourA", "OtherWorldTourB", "OtherWorldTourC", "ProSeries"],
  3: ["ProSeries", "Class1"],
  4: ["Class1", "Class2"],
});

// Spejler aiTeamGenerator: tier 1/2 altid live; tier 3/4 kun med >=1 ægte manager.
// (Holdt som lokal kopi for at undgå import af aiTeamGenerator's __testables; samme
//  prædikat — hold dem i sync hvis politikken ændres.)
export function poolHasCalendar(tier, realManagerCount = 0) {
  if (tier === 1 || tier === 2) return true;
  return (Number(realManagerCount) || 0) >= 1;
}

/**
 * Generér en kalender (udvalgte løb) pr. LIVE pulje.
 *
 * @param {object}   args
 * @param {Array}    args.pools            league_divisions-rækker beriget med
 *                                         realManagerCount: [{ id, tier, pool_index?, label?, realManagerCount }]
 * @param {Array}    args.catalog          race_pool-rækker: [{ id, name, race_class, race_type, stages }]
 * @param {object}   [args.tierRaceClasses] tier → includeClasses[] (default DEFAULT_TIER_RACE_CLASSES)
 * @param {number}   [args.raceDaysTarget]  løbsdage pr. division (default 60)
 * @param {number}   [args.stageRaceQuota]  garanterede etapeløb pr. division (default 8)
 * @param {number}   [args.baseSeed]        sæson-seed; pr-pulje-seed = baseSeed XOR pool.id
 * @returns {Array<{ leagueDivisionId, tier, label, races, totalRaceDays, candidateCount }>}
 */
export function generateDivisionCalendars({
  pools = [],
  catalog = [],
  tierRaceClasses = DEFAULT_TIER_RACE_CLASSES,
  raceDaysTarget = DEFAULT_RACE_DAYS_TARGET,
  stageRaceQuota = FIRST_SEASON_STAGE_RACE_QUOTA,
  baseSeed = 1,
} = {}) {
  const calendars = [];
  for (const pool of pools) {
    const realManagerCount = Number(pool.realManagerCount) || 0;
    if (!poolHasCalendar(pool.tier, realManagerCount)) continue;

    const includeClasses = tierRaceClasses[pool.tier] || null;
    const seed = (Number(baseSeed) ^ Number(pool.id)) >>> 0;

    const result = selectSeasonRaces({
      pool: catalog,
      includeClasses,
      raceDaysTarget,
      stageRaceQuota,
      seed,
    });

    calendars.push({
      leagueDivisionId: pool.id,
      tier: pool.tier,
      label: pool.label ?? null,
      races: result.selected,
      totalRaceDays: result.totalRaceDays,
      candidateCount: result.candidateCount,
    });
  }
  return calendars;
}
