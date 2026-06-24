// backend/lib/raceDistribution.js
// Race Hub Fase 1: ren læse-logik for trup-fordeling-board'et. Kolonne-sæt
// (dagens egne-pulje overlap-løb), binding-map (hvilke kolonne-løb en rytter
// allerede er bundet i) og season-dag-projektion til tidslinjen. Pure — ingen DB.
import { windowsOverlap, teamInRacePool } from "./raceBinding.js";

// Løb der bliver kolonner: status scheduled, holdets egen pulje (eller pulje-løs),
// og tidsvindue overlapper den valgte dag. `races` = [{id, league_division_id, status, window}].
export function buildColumnSet({ races = [], teamDivisionId, dayWindow }) {
  if (!dayWindow) return [];
  return races.filter(
    (r) =>
      r.status === "scheduled" &&
      r.window &&
      teamInRacePool({ teamDivisionId, racePoolId: r.league_division_id }) &&
      windowsOverlap(r.window, dayWindow)
  );
}

// For hver rytter: de kolonne-løb han er udtaget i, der overlapper MINDST ét andet
// kolonne-løb (dvs. binder ham væk fra det andet). `columns` = [{id, window, riderIds}].
export function buildBindingMap({ columns = [] }) {
  const map = {};
  for (const col of columns) {
    const overlapsAnother = columns.some((o) => o.id !== col.id && windowsOverlap(col.window, o.window));
    if (!overlapsAnother) continue;
    for (const rid of col.riderIds || []) {
      if (!map[rid]) map[rid] = [];
      if (!map[rid].includes(col.id)) map[rid].push(col.id);
    }
  }
  return map;
}

// Tidslinje-projektion: 60 dage med dato-tekst + terræn-glyf-nøgle + om holdet har et løb.
// `dayProfiles` = Map<day, { dateText, terrain, hasMyRace }>. Manglende dag → tom standard.
export function seasonDayProjection({ totalDays = 60, currentDay, dayProfiles = new Map() }) {
  const days = [];
  for (let day = 1; day <= totalDays; day++) {
    const p = dayProfiles.get(day) || {};
    days.push({ day, dateText: p.dateText ?? null, terrain: p.terrain ?? null, hasMyRace: !!p.hasMyRace });
  }
  return { totalDays, currentDay: currentDay ?? null, days };
}

// Terræn-glyf for en dag: flertals-profil blandt dagens etaper; lige fordeling → "mixed".
export function dominantTerrain(profileTypes = []) {
  if (!profileTypes.length) return null;
  const counts = new Map();
  for (const t of profileTypes) counts.set(t, (counts.get(t) || 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) return "mixed";
  return sorted[0][0];
}

// Manuelle entries (is_auto_filled=false) i ANDRE løb end de synlige → lockedWindows til
// assignTeamAcrossRaces, så regenerering af de synlige løb ikke dobbeltbooker en rytter
// holdet bevidst har forpligtet et overlappende sted. `excludeRaceIds` = de løb der regenereres.
export function lockedWindowsFromManualEntries({ entries = [], windowByRace, excludeRaceIds = new Set() }) {
  const ridersByRace = new Map();
  for (const e of entries) {
    if (e.is_auto_filled !== false) continue;
    if (excludeRaceIds.has(e.race_id)) continue;
    if (!ridersByRace.has(e.race_id)) ridersByRace.set(e.race_id, []);
    ridersByRace.get(e.race_id).push(e.rider_id);
  }
  const locks = [];
  for (const [raceId, riderIds] of ridersByRace) {
    const window = windowByRace.get(raceId);
    if (window) locks.push({ window, riderIds });
  }
  return locks;
}
