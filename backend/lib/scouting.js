// Scouting & skjult potentiale (#1138 / epic #1136) — RENE ledger- og estimat-funktioner.
//
// Ejer-besluttet 2026-06-07/08: scouting = BEGRÆNSET KAPACITET (slots/sæson),
// ingen penge (fair-premium), per-manager estimat, trinvis indsnævring.
//
// Backend ejer ledgeren (scout_actions): hver scout-handling = én row.
//   • scout-niveau pr. (hold, rytter) = antal rows  (capped på maxLevel)
//   • brugte slots pr. (hold, sæson)   = antal rows i den aktive sæson
//
// #1162: Backend ejer nu OGSÅ estimat-beregningen (flyttet fra
// frontend/src/lib/scouting.js display-lag v1). Den sande riders.potentiale
// forlader aldrig serveren for ikke-admin-klienter — kun det maskerede
// {lo, hi, exact, level}-resultat sendes (POST /api/scouting/estimates).
// Denne fil er ren JS uden DB/Math.random, så den kan unit-testes isoleret
// og genbruges deterministisk.

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

// ─── Estimat-beregning (#1162 — flyttet fra frontend display-lag v1) ───────────

// FNV-1a → [0,1). Samme familie som riderProgression.seededUnit.
export function seededUnit(key) {
  const s = String(key ?? "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // murmur3-finalizer: FNV-1a alene klynger for nøgler der kun afviger i sidste
  // tegn (fx team-id'er) → svag per-manager-spredning. Avalanche-mixet sikrer
  // jævn fordeling uanset nøgle-lighed.
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const roundHalf = (n) => Math.round(n * 2) / 2; // til nærmeste 0,5 (stjerne-trin)

// Ejer-justerbare display-konstanter (#1138). Bredderne er bevidst MODERATE:
// et level-0-estimat skal være usikkert, men stadig informativt (~3-stjerners
// spænd for de yngste), ellers er "1–6" = ingen viden og per-manager-biasen
// drukner i clamping.
export const SCOUT_DISPLAY_CONFIG = Object.freeze({
  // Usikkerheds-halvbredde (stjerne-enheder) ved level 0, efter alder.
  // Kholkine-peak ~27 → ≥28 = etableret, smallere usikkerhed.
  baseHalfWidthByAge: Object.freeze([
    { maxAge: 20, half: 1.5 },
    { maxAge: 23, half: 1.2 },
    { maxAge: 27, half: 0.8 },
    { maxAge: 99, half: 0.5 },
  ]),
  // Andel af halvbredden som center-biasen (per-manager skævhed) kan udgøre.
  biasFactor: 0.7,
});

function baseUncertainty(age, cfg = SCOUT_DISPLAY_CONFIG) {
  const a = age == null ? 22 : age;
  for (const row of cfg.baseHalfWidthByAge) if (a <= row.maxAge) return row.half;
  return cfg.baseHalfWidthByAge[cfg.baseHalfWidthByAge.length - 1].half;
}

// Estimat-interval for én rytter set fra ét hold.
//   truePotentiale : riders.potentiale (1.0–6.0) — forlader ALDRIG serveren rå
//   scoutLevel     : 0..maxLevel  (0 = uscoutet)
//   age            : rytterens alder (bredde-input)
//   riderId,teamId : seed for per-manager bias
//   maxLevel       : SCOUTING_CONFIG.maxLevel
// Returnerer { lo, hi, exact, scoutLevel } i potentiale/stjerne-enheder.
export function estimatePotentialRange(truePotentiale, scoutLevel, age, riderId, teamId, maxLevel = SCOUTING_CONFIG.maxLevel) {
  if (truePotentiale == null) return null;
  const truth = Number(truePotentiale);
  if (!Number.isFinite(truth)) return null;
  const level = clamp(Number(scoutLevel) || 0, 0, maxLevel);

  // Fuldt scoutet (eller maxLevel==0) → eksakt sandhed (0,5-trin = stjerne-visning).
  if (level >= maxLevel) {
    const v = roundHalf(truth);
    return { lo: v, hi: v, exact: true, scoutLevel: level };
  }

  const knowledge = level / maxLevel;            // 0..1, stiger med scouting
  const base = baseUncertainty(age);
  const halfWidth = base * (1 - knowledge);       // → 0 ved fuld viden
  // Center kan ligge skævt (per-manager), men skævheden konvergerer mod 0.
  const bias = (seededUnit(`scout:${riderId}:${teamId}`) * 2 - 1)
    * base * SCOUT_DISPLAY_CONFIG.biasFactor * (1 - knowledge);
  const center = clamp(truth + bias, 1, 6);

  const lo = clamp(roundHalf(center - halfWidth), 1, 6);
  const hi = clamp(roundHalf(center + halfWidth), 1, 6);
  return { lo, hi, exact: false, scoutLevel: level };
}

// Det maskerede estimat én viewer (team) må se for én rytter. Dette er det
// ENESTE potentiale-output der må forlade serveren til ikke-admin-klienter.
//   rider        : { id, potentiale, birthdate, team_id }
//   level        : viewerens scout-niveau på rytteren (0..maxLevel)
//   viewerTeamId : viewerens team-id
// Returnerer { lo, hi, exact, level } eller null (rytter uden potentiale).
export function buildScoutEstimate(rider, level, viewerTeamId, cfg = SCOUTING_CONFIG, currentYear = new Date().getFullYear()) {
  if (!rider || rider.potentiale == null) return null;
  const isOwn = rider.team_id != null && viewerTeamId != null && rider.team_id === viewerTeamId;
  // Egne ryttere er fuldt kendte (samme regel som POST /scouting/:riderId håndhæver).
  const effectiveLevel = isOwn ? cfg.maxLevel : level;
  const age = rider.birthdate ? currentYear - new Date(rider.birthdate).getFullYear() : null;
  const range = estimatePotentialRange(rider.potentiale, effectiveLevel, age, rider.id, viewerTeamId, cfg.maxLevel);
  if (!range) return null;
  return { lo: range.lo, hi: range.hi, exact: range.exact, level: range.scoutLevel };
}
