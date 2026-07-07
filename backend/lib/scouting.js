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
  // (niveau == maxLevel ⇒ smallest mulige rest-bånd — ALDRIG eksakt, #1543).
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
  // #1543 beslutning 3+4: INGEN når 100% præcision. Ved fuldt scout-niveau (og
  // for egne ryttere, som altid behandles som maxLevel) er der et REST-BÅND:
  residualHalfWidth: 0.5,   // stjerne-halvbredde ved fuld viden
  // PERSISTENT anker-bias (seeded pr. rytter+hold, uniform ±anchorBias): lægges
  // til centeret på ALLE levels, inkl. rest-båndet. Fordi den er KONSTANT på
  // tværs af levels kan ingen kombination af observationer (gennemsnit,
  // least-squares) fjerne den — det er det der gør rest-båndet ikke-inverterbart
  // (#1162; valideret empirisk i scripts/scoutingInversionHarness.js). Den
  // level-skalerede bias (biasFactor ovenfor) giver derudover VARIERENDE
  // skævhed der konvergerer mod 0 — ankeret konvergerer aldrig.
  // 0.6: kvantisering (0,5-trin) + clamping ved 1/6 trækker den effektive
  // fejl ned — 0.5 gav median-rekonstruktionsfejl 0.227 (< 0.25-gaten).
  anchorBias: 0.6,
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

  // Persistent per-(rytter, hold) anker-bias — konstant på tværs af levels.
  const anchor = (seededUnit(`scout-anchor:${riderId}:${teamId}`) * 2 - 1)
    * SCOUT_DISPLAY_CONFIG.anchorBias;

  // Fuldt scoutet (eller maxLevel==0) → REST-BÅND (#1543 beslutning 3+4): selv
  // fuld viden er et smalt interval om det ankrede center — aldrig eksakt.
  if (level >= maxLevel) {
    const half = SCOUT_DISPLAY_CONFIG.residualHalfWidth;
    const center = clamp(truth + anchor, 1, 6);
    return {
      lo: clamp(roundHalf(center - half), 1, 6),
      hi: clamp(roundHalf(center + half), 1, 6),
      exact: false,
      scoutLevel: level,
    };
  }

  const knowledge = level / maxLevel;            // 0..1, stiger med scouting
  const base = baseUncertainty(age);
  const halfWidth = base * (1 - knowledge);       // → residual ved fuld viden
  // Center = anker (persistent) + level-skaleret skævhed (konvergerer mod 0).
  const bias = (seededUnit(`scout:${riderId}:${teamId}`) * 2 - 1)
    * base * SCOUT_DISPLAY_CONFIG.biasFactor * (1 - knowledge);
  const center = clamp(truth + anchor + bias, 1, 6);

  const lo = clamp(roundHalf(center - halfWidth), 1, 6);
  const hi = clamp(roundHalf(center + halfWidth), 1, 6);
  return { lo, hi, exact: false, scoutLevel: level };
}

// Det maskerede estimat én viewer (team) må se for én rytter. Dette er det
// ENESTE potentiale-output der må forlade serveren til ikke-admin-klienter.
//   rider        : { id, potentiale, birthdate, team_id }
//   level        : viewerens scout-niveau på rytteren (0..maxLevel)
//   viewerTeamId : viewerens team-id
// Returnerer:
//   • null                       — rytter uden potentiale (intet at vise).
//   • { hidden: true, level: 0 } — ikke-egen, uscoutet rytter (#1543): potentialet
//                                  er SKJULT indtil det er scoutet. Hverken den rå
//                                  potentiale eller et lo–hi-spænd forlader serveren
//                                  før et scout-slot er brugt — intet gratis level-0
//                                  hint længere.
//   • { lo, hi, exact, level }   — egen rytter (smalleste rest-bånd, #1543
//                                  beslutning 4) eller scoutet (level > 0).
export function buildScoutEstimate(rider, level, viewerTeamId, cfg = SCOUTING_CONFIG, currentYear = new Date().getFullYear()) {
  if (!rider || rider.potentiale == null) return null;
  const isOwn = rider.team_id != null && viewerTeamId != null && rider.team_id === viewerTeamId;
  // #1543: en ikke-egen rytter som endnu ikke er scoutet (level 0) har INTET
  // synligt potentiale. Vi beregner ikke et lo–hi-interval og lækker dermed
  // ingen sandhed (heller ikke gennem clamping/bias) før et slot er brugt.
  if (!isOwn && (Number(level) || 0) <= 0) return { hidden: true, level: 0 };
  // Egne ryttere er fuldt kendte (samme regel som POST /scouting/:riderId håndhæver).
  const effectiveLevel = isOwn ? cfg.maxLevel : level;
  const age = rider.birthdate ? currentYear - new Date(rider.birthdate).getFullYear() : null;
  const range = estimatePotentialRange(rider.potentiale, effectiveLevel, age, rider.id, viewerTeamId, cfg.maxLevel);
  if (!range) return null;
  return { lo: range.lo, hi: range.hi, exact: range.exact, level: range.scoutLevel };
}
