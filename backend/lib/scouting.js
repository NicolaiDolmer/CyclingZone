// Scouting & skjult potentiale (#1138 / epic #1136) — RENE ledger-funktioner.
//
// Ejer-besluttet 2026-06-07/08: scouting = BEGRÆNSET KAPACITET (slots/sæson),
// ingen penge (fair-premium), per-manager estimat, trinvis indsnævring.
//
// Backend ejer KUN ledgeren (scout_actions): hver scout-handling = én row.
//   • scout-niveau pr. (hold, rytter) = antal rows  (capped på maxLevel)
//   • brugte slots pr. (hold, sæson)   = antal rows i den aktive sæson
//
// Selve estimat-bredden (display) beregnes i frontend (frontend/src/lib/scouting.js)
// ud fra (sand potentiale + niveau + seed) — display-lag v1. Denne fil er ren
// JS uden DB/Date/Math.random, så den kan unit-testes isoleret og genbruges
// deterministisk.

export const SCOUTING_CONFIG = Object.freeze({
  // Antal aktive scout-handlinger en manager har pr. sæson. Genopfyldes implicit
  // ved sæson-skifte (slots udledes pr. aktiv sæson — ingen reset-hook nødvendig).
  slotsPerSeason: 3,
  // Hvor mange gange samme rytter kan scoutes før estimatet er fuldt afdækket
  // (niveau == maxLevel ⇒ eksakt potentiale vises).
  maxLevel: 3,
});

// Udled scout-state for ÉT hold ud fra dets scout_actions-rows.
//   rows           : [{ rider_id, season_id }, ...]  (kun dette holds rows)
//   activeSeasonId : den aktive sæsons id (slots tælles kun her)
// Returnerer { slots:{total,used,remaining}, maxLevel, levels:{<rider_id>:level} }.
export function deriveScoutState(rows, activeSeasonId, cfg = SCOUTING_CONFIG) {
  const levels = {};
  let used = 0;
  for (const row of rows ?? []) {
    const rid = row.rider_id;
    levels[rid] = Math.min((levels[rid] ?? 0) + 1, cfg.maxLevel);
    if (activeSeasonId != null && row.season_id === activeSeasonId) used++;
  }
  const total = cfg.slotsPerSeason;
  return {
    slots: { total, used, remaining: Math.max(0, total - used) },
    maxLevel: cfg.maxLevel,
    levels,
  };
}

// Kan dette hold scoute denne rytter lige nu? Ren guard (samme regler backend
// håndhæver + frontend kan vise inaktiv knap).
//   currentLevel   : holdets nuværende niveau på rytteren (0..maxLevel)
//   slotsRemaining : tilbageværende slots i sæsonen
// Returnerer { ok, reason } hvor reason ∈ "no_slots" | "max_level" | null.
export function canScout(currentLevel, slotsRemaining, cfg = SCOUTING_CONFIG) {
  if ((currentLevel ?? 0) >= cfg.maxLevel) return { ok: false, reason: "max_level" };
  if ((slotsRemaining ?? 0) <= 0) return { ok: false, reason: "no_slots" };
  return { ok: true, reason: null };
}
