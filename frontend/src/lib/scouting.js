// Scouting & skjult potentiale (#1138 / epic #1136) — frontend display-lag v1.
//
// Den sande potentiale (riders.potentiale, 1.0–6.0) er stadig i payloaden i v1
// (ægte server-skjuling = separat senere slice). Her oversætter vi den til et
// USIKKERT, PER-MANAGER estimat-interval der indsnævres mod sandheden jo mere
// holdet har scoutet rytteren.
//
// Determinisme: estimatets bias seedes per (rytter, hold) via FNV-1a, så to
// managere ser stabilt forskellige intervaller — uændret mellem page-loads.
// Ren funktion (ingen Math.random/Date) → unit-testbar.

// FNV-1a → [0,1). Samme familie som backend/lib/riderProgression.seededUnit,
// re-implementeret her (frontend deler ikke backend/lib).
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
// drukner i clamping. Tunes visuelt før låsning.
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
//   truePotentiale : riders.potentiale (1.0–6.0)
//   scoutLevel     : 0..maxLevel  (0 = uscoutet)
//   age            : rytterens alder (bredde-input)
//   riderId,teamId : seed for per-manager bias
//   maxLevel       : fra backend (/scouting/me)
// Returnerer { lo, hi, exact, scoutLevel } i potentiale/stjerne-enheder.
export function estimatePotentialRange(truePotentiale, scoutLevel, age, riderId, teamId, maxLevel = 3) {
  if (truePotentiale == null) return null;
  const truth = Number(truePotentiale);
  if (!Number.isFinite(truth)) return null;
  const level = clamp(Number(scoutLevel) || 0, 0, maxLevel);

  // Fuldt scoutet (eller maxLevel==0) → eksakt sandhed.
  if (level >= maxLevel) {
    return { lo: truth, hi: truth, exact: true, scoutLevel: level };
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

// Kvalitativ label-NØGLE fra estimatets midtpunkt (oversættes via i18n
// rider:scouting.label_*). Bevidst grov (5 bånd) — flavor, ikke præcision.
export function potentialLabelKey(range) {
  if (!range) return null;
  const mid = (range.lo + range.hi) / 2;
  if (mid >= 5.25) return "worldclass";
  if (mid >= 4.25) return "high";
  if (mid >= 3.25) return "solid";
  if (mid >= 2.25) return "rotation";
  return "limited";
}
