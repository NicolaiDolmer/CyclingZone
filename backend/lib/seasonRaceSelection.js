// Slice 09 — Sæson-race-udvælgelse (pure-funktion)
//
// Givet en pool af tilgængelige løb, filtre og per-sæson whitelists,
// returnér en kalender der summerer til ~raceDaysTarget løbsdage.
//
// Strategi:
// 1. Filtrer pool til kun løb i includeClasses + ikke i excludeClasses
// 2. Phase 1 (quota): hvis stageRaceQuota > 0, vælg op til N stage races
//    fra prioritizedStageRaceIds i rækkefølge (suppleret alfabetisk hvis
//    quota ikke fyldt af whitelist-matches)
// 3. Phase 2 (boost): tilføj boost-singles fra boostSingleRaceIds hvis plads
// 4. Phase 3 (fill): resterende fyldes deterministisk (race_class → race_type → name)
// 5. STOP når tilføjelse af næste løb ville overskyde med mere end overshootTolerance
// 6. Returnér selected + omitted + totalRaceDays
//
// Whitelists er pr-sæson UUID-arrays (race_pool.id) lagret på seasons-tabellen.
// Tom array eller missing → ren alfabetisk fallback. Stale IDs ignoreres stille.

import { WORLD_TOUR_CLASSES } from "./racePoolImport.js";
import { makeRng } from "./fictionalRiderGenerator.js";

// #1856: hævet 60→140 for en VIRKELIGHEDSTRO fuld-sæsons-kalender (grand tours +
// etapeløb + endagsklassikere/monumenter). 60 var for lavt: Tier 1's 8 garanterede
// etapeløb (7-21 etaper) fyldte næsten hele budgettet alene → 0 endagsløb. Stadig
// override-bar pr. kald (raceDaysTarget-param). Matcher en hel cykelsæson i dage.
export const DEFAULT_RACE_DAYS_TARGET = 140;
export const DEFAULT_OVERSHOOT_TOLERANCE = 5;
export const DEFAULT_STAGE_RACE_QUOTA = 0;
export const FIRST_SEASON_STAGE_RACE_QUOTA = 8;
export const DEFAULT_SELECTION_SEED = 1;

// #1124: tidligere udfyldte vi quota-supplement + fill ALFABETISK (race_class →
// race_type → name), så kalenderen blev forudsigelig og biased mod tidlige navne.
// Nu shuffler vi seedet i stedet: output afhænger kun af (indhold, seed), så hver
// sæson får en varieret men reproducerbar sammensætning. Whitelist-rækkefølgen
// (prioriterede etapeløb + boost-singles) shuffles IKKE — den er ejer-valgt.
export function makeStableShuffler(seed) {
  const rng = makeRng(seed);
  const keyOf = (r) => r.id ?? `${r.name}|${r.race_class}`;
  return (arr) => {
    const a = arr.slice().sort((x, y) => {
      const kx = keyOf(x); const ky = keyOf(y);
      return kx < ky ? -1 : kx > ky ? 1 : 0;
    });
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
}

export function selectSeasonRaces({
  pool = [],
  includeClasses = null,
  excludeClasses = [],
  raceDaysTarget = DEFAULT_RACE_DAYS_TARGET,
  overshootTolerance = DEFAULT_OVERSHOOT_TOLERANCE,
  stageRaceQuota = DEFAULT_STAGE_RACE_QUOTA,
  prioritizedStageRaceIds = [],
  boostSingleRaceIds = [],
  seed = DEFAULT_SELECTION_SEED,
} = {}) {
  const includeSet = includeClasses ? new Set(includeClasses) : null;
  const excludeSet = new Set(excludeClasses);
  const shuffle = makeStableShuffler(seed);

  const candidates = pool.filter((r) => {
    if (includeSet && !includeSet.has(r.race_class)) return false;
    if (excludeSet.has(r.race_class)) return false;
    return true;
  });

  const selected = [];
  const usedKeys = new Set();
  let totalRaceDays = 0;

  const keyFor = (race) => race.id ?? `${race.name}|${race.race_class}`;
  const fitsAtRoom = (stages) => totalRaceDays + stages <= raceDaysTarget + overshootTolerance;
  const addRace = (race) => {
    selected.push(race);
    usedKeys.add(keyFor(race));
    totalRaceDays += Number(race.stages) || 1;
  };

  // Phase 1 — Stage race quota fra prioriteret whitelist (race_pool.id uuids)
  if (stageRaceQuota > 0) {
    const stageCandidates = candidates.filter((r) => r.race_type === "stage_race");
    const byId = new Map(stageCandidates.map((r) => [r.id, r]));
    let quotaTaken = 0;

    for (const priorityId of prioritizedStageRaceIds) {
      if (quotaTaken >= stageRaceQuota) break;
      if (totalRaceDays >= raceDaysTarget) break;
      const race = byId.get(priorityId);
      if (!race || usedKeys.has(keyFor(race))) continue;
      const stages = Number(race.stages) || 1;
      if (!fitsAtRoom(stages)) continue;
      addRace(race);
      quotaTaken++;
    }

    // Supplér med remaining stage races (alfabetisk) hvis quota ikke fyldt
    if (quotaTaken < stageRaceQuota) {
      const remaining = shuffle(
        stageCandidates.filter((r) => !usedKeys.has(keyFor(r))),
      );
      for (const race of remaining) {
        if (quotaTaken >= stageRaceQuota) break;
        if (totalRaceDays >= raceDaysTarget) break;
        const stages = Number(race.stages) || 1;
        if (!fitsAtRoom(stages)) continue;
        addRace(race);
        quotaTaken++;
      }
    }
  }

  // Phase 2 — Boost singles fra whitelist (race_pool.id uuids)
  if (totalRaceDays < raceDaysTarget && boostSingleRaceIds.length > 0) {
    const singleById = new Map(
      candidates.filter((r) => r.race_type === "single").map((r) => [r.id, r]),
    );
    for (const boostId of boostSingleRaceIds) {
      if (totalRaceDays >= raceDaysTarget) break;
      const race = singleById.get(boostId);
      if (!race || usedKeys.has(keyFor(race))) continue;
      const stages = Number(race.stages) || 1;
      if (!fitsAtRoom(stages)) continue;
      addRace(race);
    }
  }

  // Phase 3 — Fyld resten seedet-shuffled (varieret, ikke alfabetisk)
  const remaining = shuffle(candidates.filter((r) => !usedKeys.has(keyFor(r))));
  const omitted = [];
  for (const race of remaining) {
    const stages = Number(race.stages) || 1;
    if (totalRaceDays >= raceDaysTarget) {
      omitted.push({ ...race, reason: "target_reached" });
      continue;
    }
    if (!fitsAtRoom(stages)) {
      omitted.push({ ...race, reason: "would_overshoot" });
      continue;
    }
    addRace(race);
  }

  return {
    selected,
    omitted,
    totalRaceDays,
    raceDaysTarget,
    selectedCount: selected.length,
    candidateCount: candidates.length,
  };
}

// Hjælper til sæson 1: ekskluder alle WorldTour-klasser by-default per
// brugerens beslutning 2026-05-09 ("vi kører ingen WT-løb i første sæson") +
// stageRaceQuota=8 fra 2026-05-19 (Continental Circuit GC-action garanti).
// Whitelists kommer fra seasons-tabellen via caller — ingen hardcoded default.
export function selectFirstSeasonRaces(pool, options = {}) {
  return selectSeasonRaces({
    pool,
    excludeClasses: WORLD_TOUR_CLASSES,
    stageRaceQuota: FIRST_SEASON_STAGE_RACE_QUOTA,
    ...options,
  });
}
