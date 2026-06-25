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
export function buildBindingMap({ columns = [], withdrawnIds } = {}) {
  // Rod A (#1823): afmeldte kolonne-løb binder ikke — deres ryttere er frie til de
  // overlappende løb. Filtrér dem ud før overlap-beregningen.
  const withdrawn = withdrawnIds instanceof Set ? withdrawnIds : new Set(withdrawnIds || []);
  const active = columns.filter((c) => !withdrawn.has(c.id));
  const map = {};
  for (const col of active) {
    const overlapsAnother = active.some((o) => o.id !== col.id && windowsOverlap(col.window, o.window));
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

// ALLE committede entries (manuelle OG auto-filled) i ANDRE løb end de der regenereres
// → lockedWindows til assignTeamAcrossRaces, så regenerering ikke dobbeltbooker en rytter
// holdet allerede er forpligtet med et overlappende sted. `excludeRaceIds` = de løb der
// regenereres (deres ryttere skal jo netop gen-tildeles, så de udelades).
//
// #1823 1b: tidligere låste vi KUN manuelle entries (`is_auto_filled === false`). Det
// efterlod et hul: en auto-filled rytter i et ikke-regenereret men tidsoverlappende løb
// (typisk et multi-dag-etapeløb der rækker ind i nabodagen) blev ikke låst → dobbeltbooking.
// Vi låser nu alle committede entries. Genbruges også til dual-mode "missing": de manuelt-
// udtagne kolonner holdes ude af regenererings-target og låses dermed her.
// Vælg hvilke af dagens kolonne-løb der skal regenereres (#1823 dual-mode + #1825 frys).
// `target` = de løb assistenten genudfylder; `skipped` = antal sprunget over af frys/manuel.
// Afmeldte løb tæller IKKE som skipped (de er bevidst ude). Igangværende (stages_completed>0)
// fryses ALTID; manuelt-udtagne springes kun over i mode=missing (og låses andetsteds).
// Pure + deterministisk.
export function partitionRegenTargets({ cols = [], withdrawnIds, manualRaceIds, mode = "missing" }) {
  const withdrawn = withdrawnIds instanceof Set ? withdrawnIds : new Set(withdrawnIds || []);
  const manual = manualRaceIds instanceof Set ? manualRaceIds : new Set(manualRaceIds || []);
  const target = [];
  let skipped = 0;
  for (const r of cols) {
    if (withdrawn.has(r.id)) continue;
    if ((r.stages_completed ?? 0) > 0) { skipped += 1; continue; } // frys (#1825)
    if (mode === "missing" && manual.has(r.id)) { skipped += 1; continue; }
    target.push(r);
  }
  return { target, skipped };
}

export function lockedWindowsFromEntries({ entries = [], windowByRace, excludeRaceIds = new Set() }) {
  const ridersByRace = new Map();
  for (const e of entries) {
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
