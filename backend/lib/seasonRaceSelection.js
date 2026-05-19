// Slice 09 — Sæson-race-udvælgelse (pure-funktion)
//
// Givet en pool af tilgængelige løb og et sæt filtre, returnér en kalender
// der summerer til ~raceDaysTarget løbsdage. Primær brug: admin vælger klasser
// (fx kun ProSeries i sæson 1) + race-dage-mål (60), funktionen vælger løb
// indtil målet er nået.
//
// Strategi:
// 1. Filtrer pool til kun løb i includeClasses + ikke i excludeClasses
// 2. Phase 1 (quota): hvis stageRaceQuota > 0, vælg op til N stage races fra
//    STAGE_RACE_PRIORITY i rækkefølge (suppleret alfabetisk hvis quota ikke fyldt)
// 3. Phase 2 (boost): tilføj boost-singles fra SINGLE_RACE_BOOST hvis plads
// 4. Phase 3 (fill): resterende fyldes deterministisk (race_class → race_type → name)
// 5. STOP når tilføjelse af næste løb ville overskyde med mere end overshootTolerance
// 6. Returnér selected + omitted + totalRaceDays
//
// Determinisme er vigtig: samme pool + samme filtre → samme kalender.

import { WORLD_TOUR_CLASSES } from "./racePoolImport.js";

export const DEFAULT_RACE_DAYS_TARGET = 60;
export const DEFAULT_OVERSHOOT_TOLERANCE = 5;
export const DEFAULT_STAGE_RACE_QUOTA = 0;
export const FIRST_SEASON_STAGE_RACE_QUOTA = 8;

// Continental Circuit prestigious stage races, prioriteret rækkefølge.
// Bruges når stageRaceQuota > 0 til at sikre GC-action i sæson 1 hvor alle
// WT-løb (Tour de France, Vuelta, Giro, Monuments) er ekskluderet.
// Navne skal matche race_pool.name nøjagtigt (case-sensitive).
export const STAGE_RACE_PRIORITY = [
  "Volta Comunitat Valenciana",
  "Tour of Oman",
  "Volta ao Algarve em Bicicleta",
  "Vuelta a Andalucía Ruta Ciclista del Sol",
  "Tour of the Alps",
  "Tour de Hongrie",
  "Tour of Slovenia",
  "Vuelta a Burgos",
  "PostNord Tour of Denmark",
  "Lloyds Tour of Britain",
  "Tour of Norway",
  "Arctic Race of Norway",
  "CRO Race",
];

// Singles der typisk skipper i alfabetisk valg (italienske/asiatiske
// efterårsklassikere). Tilføjes som boost efter quota-fasen hvis plads.
export const SINGLE_RACE_BOOST = [
  "Tre Valli Varesine",
  "Trofeo Laigueglia",
  "Veneto Classic",
  "Utsunomiya Japan Cup Road Race",
];

function deterministicSort(a, b) {
  if (a.race_class !== b.race_class) return a.race_class.localeCompare(b.race_class);
  if (a.race_type !== b.race_type) return a.race_type.localeCompare(b.race_type);
  return (a.name || "").localeCompare(b.name || "");
}

export function selectSeasonRaces({
  pool = [],
  includeClasses = null,
  excludeClasses = [],
  raceDaysTarget = DEFAULT_RACE_DAYS_TARGET,
  overshootTolerance = DEFAULT_OVERSHOOT_TOLERANCE,
  stageRaceQuota = DEFAULT_STAGE_RACE_QUOTA,
  prioritizedStageRaces = STAGE_RACE_PRIORITY,
  boostSingleRaces = SINGLE_RACE_BOOST,
} = {}) {
  const includeSet = includeClasses ? new Set(includeClasses) : null;
  const excludeSet = new Set(excludeClasses);

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

  // Phase 1 — Stage race quota fra prioriteret whitelist
  if (stageRaceQuota > 0) {
    const stageCandidates = candidates.filter((r) => r.race_type === "stage_race");
    const byName = new Map(stageCandidates.map((r) => [r.name, r]));
    let quotaTaken = 0;

    for (const priorityName of prioritizedStageRaces) {
      if (quotaTaken >= stageRaceQuota) break;
      if (totalRaceDays >= raceDaysTarget) break;
      const race = byName.get(priorityName);
      if (!race || usedKeys.has(keyFor(race))) continue;
      const stages = Number(race.stages) || 1;
      if (!fitsAtRoom(stages)) continue;
      addRace(race);
      quotaTaken++;
    }

    // Supplér med remaining stage races (alfabetisk) hvis quota ikke fyldt
    if (quotaTaken < stageRaceQuota) {
      const remaining = stageCandidates
        .filter((r) => !usedKeys.has(keyFor(r)))
        .sort(deterministicSort);
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

  // Phase 2 — Boost singles (italienske/asiatiske efterårsklassikere)
  if (totalRaceDays < raceDaysTarget) {
    const singleByName = new Map(
      candidates.filter((r) => r.race_type === "single").map((r) => [r.name, r]),
    );
    for (const boostName of boostSingleRaces) {
      if (totalRaceDays >= raceDaysTarget) break;
      const race = singleByName.get(boostName);
      if (!race || usedKeys.has(keyFor(race))) continue;
      const stages = Number(race.stages) || 1;
      if (!fitsAtRoom(stages)) continue;
      addRace(race);
    }
  }

  // Phase 3 — Fyld resten deterministisk
  const remaining = candidates.filter((r) => !usedKeys.has(keyFor(r))).sort(deterministicSort);
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
export function selectFirstSeasonRaces(pool, options = {}) {
  return selectSeasonRaces({
    pool,
    excludeClasses: WORLD_TOUR_CLASSES,
    stageRaceQuota: FIRST_SEASON_STAGE_RACE_QUOTA,
    ...options,
  });
}
