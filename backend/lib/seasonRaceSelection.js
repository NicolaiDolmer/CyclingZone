// Slice 09 — Sæson-race-udvælgelse (pure-funktion)
//
// Givet en pool af tilgængelige løb og et sæt filtre, returnér en kalender
// der summerer til ~raceDaysTarget løbsdage. Primær brug: admin vælger klasser
// (fx kun ProSeries i sæson 1) + race-dage-mål (60), funktionen vælger løb
// indtil målet er nået.
//
// Strategi:
// 1. Filtrer pool til kun løb i includeClasses + ikke i excludeClasses
// 2. Sortér deterministisk: race_class → race_type → name (stabil mellem runs)
// 3. Akkumulér løb indtil sum(stages) ≥ raceDaysTarget — STOP når tilføjelse
//    af næste løb ville overskyde med mere end overshootTolerance dage
// 4. Returnér selected + omitted + totalRaceDays
//
// Determinisme er vigtig: samme pool + samme filtre → samme kalender. Det
// gør funktionen testbar uden race conditions og lader admin gen-generere
// forslag uden overraskelser.

import { WORLD_TOUR_CLASSES } from "./racePoolImport.js";

export const DEFAULT_RACE_DAYS_TARGET = 60;
export const DEFAULT_OVERSHOOT_TOLERANCE = 5;

export function selectSeasonRaces({
  pool = [],
  includeClasses = null,
  excludeClasses = [],
  raceDaysTarget = DEFAULT_RACE_DAYS_TARGET,
  overshootTolerance = DEFAULT_OVERSHOOT_TOLERANCE,
} = {}) {
  const includeSet = includeClasses ? new Set(includeClasses) : null;
  const excludeSet = new Set(excludeClasses);

  const candidates = pool.filter((r) => {
    if (includeSet && !includeSet.has(r.race_class)) return false;
    if (excludeSet.has(r.race_class)) return false;
    return true;
  });

  candidates.sort((a, b) => {
    if (a.race_class !== b.race_class) return a.race_class.localeCompare(b.race_class);
    if (a.race_type !== b.race_type) return a.race_type.localeCompare(b.race_type);
    return (a.name || "").localeCompare(b.name || "");
  });

  const selected = [];
  const omitted = [];
  let totalRaceDays = 0;
  for (const race of candidates) {
    const stages = Number(race.stages) || 1;
    const projected = totalRaceDays + stages;
    if (totalRaceDays >= raceDaysTarget) {
      omitted.push({ ...race, reason: "target_reached" });
      continue;
    }
    if (projected > raceDaysTarget + overshootTolerance) {
      omitted.push({ ...race, reason: "would_overshoot" });
      continue;
    }
    selected.push(race);
    totalRaceDays = projected;
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
// brugerens beslutning 2026-05-09 ("vi kører ingen WT-løb i første sæson").
export function selectFirstSeasonRaces(pool, options = {}) {
  return selectSeasonRaces({
    pool,
    excludeClasses: WORLD_TOUR_CLASSES,
    ...options,
  });
}
