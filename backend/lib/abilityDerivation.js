// Evne-system v2 (#1122 / #1101-kæden) — udled 0-99 game-abilities fra de legacy
// PCM-stats. Designet: docs/decisions/rider-ability-system-v2.md (source of truth).
//
// KALIBRERINGS-MODEL (ejer-besluttet 2026-06-07, i tuning-løkken):
//   Hver disciplin-evne afledes DIREKTE af sin primære PCM-stat, lineært remappet
//   fra PCM-skalaen [50,85] → spil [1,99]. PCM 50 → 1, PCM 85 → 99.
//   Konsekvenser (alle ønskede, verificeret mod prod 2026-06-07):
//   • §1.1 Specialisering er GRATIS: PCM-stats er allerede skæve pr. rytter (en
//     sprinter har lav stat_bj, høj stat_sp), så climbing≪sprint falder ud af sig
//     selv — ingen kunstig kontrast-mekanik.
//   • §1.2 Top-tung af konstruktion: kun ~0-3 ryttere har en stat ≥85 (→ 99), snit-
//     statten ~60 → evne ~29. Toppen er sjælden uden en separat kurve.
//   • §1.3 Døde evner væk: hver evne spredes over hele 1-99 fordi stat-spredningen
//     remappes lineært (ikke klumpet om 60).
//   • acceleration ≠ flad sprint: stat_acc (kan accelerere/angribe, også opad) er en
//     ANDEN stat end stat_sp (flad spurt) — en klatrer beholder ok acceleration.
//
// Ren + deterministisk. physiology-parametren beholdes i signaturen (rider_id +
// race-engine-kompat) men driver IKKE længere evnerne — abilities ← stats.

export const FORMULA_VERSION = 2;

// ── Kalibrerings-ankre (§6) — ejer tuner her ──────────────────────────────────
export const CALIBRATION = Object.freeze({
  pcmFloor: 50,   // PCM-stat der mapper til spil-1
  pcmCeil: 85,    // PCM-stat der mapper til spil-99 (stats >85 clampes til 99)
  asOfYear: 2026, // alder = asOfYear − fødselsår (til aggression/tactics/hidden)
});

// 16 synlige evner i 4 kategorier (§3). Rækkefølge = visnings-/lagrings-orden.
export const VISIBLE_ABILITIES = Object.freeze([
  // Fysiske (11)
  "climbing", "time_trial", "prolog", "flat", "tempo", "sprint", "acceleration",
  "punch", "endurance", "recovery", "durability",
  // Tekniske (3)
  "descending", "cobblestone", "positioning",
  // Taktisk/mentale (2)
  "aggression", "tactics",
]);

// Skjulte evner (§3). potentiale forbliver en eksisterende riders-kolonne; her
// udleder vi kun hidden_potential.
export const HIDDEN_ABILITIES = Object.freeze(["hidden_potential"]);

export const ALL_ABILITY_KEYS = Object.freeze([...VISIBLE_ABILITIES, ...HIDDEN_ABILITIES]);

// Disciplin-evne → primær PCM-stat (§3 "Kilde"). Ren 50-85 → 1-99-mapping, så
// specialisering er indbygget (skæve PCM-stats pr. rytter). aggression er IKKE her:
// den har et ungdoms-tilt og beregnes separat. positioning/tactics/hidden er afledte.
export const PRIMARY_STAT = Object.freeze({
  climbing: "stat_bj", time_trial: "stat_tt", prolog: "stat_prl", flat: "stat_fl",
  tempo: "stat_kb", sprint: "stat_sp", acceleration: "stat_acc", punch: "stat_bk",
  endurance: "stat_udh", recovery: "stat_res", durability: "stat_mod",
  descending: "stat_ned", cobblestone: "stat_bro",
});

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// PCM-stat → fraktion ∈ [0,1] på ankrene [pcmFloor, pcmCeil]. Ugyldig stat → 0.
function pcmFrac(stat) {
  const v = Number(stat);
  if (!Number.isFinite(v)) return 0;
  return clamp((v - CALIBRATION.pcmFloor) / (CALIBRATION.pcmCeil - CALIBRATION.pcmFloor), 0, 1);
}

// Fraktion ∈ [0,1] → spil-score ∈ [1,99] (frac 0 → 1, frac 1 → 99).
const scoreFrac = (f) => clamp(Math.round(1 + clamp(f, 0, 1) * 98), 1, 99);

// Deterministisk støj ∈ [0,1) fra rider_id (FNV-1a). Kun til skjult potentiale.
function hashNoise(id) {
  const s = String(id ?? "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

function ageFrom(birthdate, asOfYear) {
  if (!birthdate) return 25; // snit-alder fallback
  const year = new Date(birthdate).getFullYear();
  if (!Number.isFinite(year)) return 25;
  return clamp(asOfYear - year, 16, 45);
}

// physiology: rider_physiology_profiles-række (kun til rider_id-fallback).
// riderRow:   legacy stat_*-felter + birthdate + potentiale + id.
// opts.pool:   accepteres for bagudkompat (v1) men ignoreres — v2 bruger ingen pool.
export function deriveAbilities(physiology = {}, riderRow = {}, { asOfYear = CALIBRATION.asOfYear } = {}) {
  // Alders-/potentiale-afledte komponenter (til afledte evner).
  const age = ageFrom(riderRow.birthdate, asOfYear);
  const youth = clamp((32 - age) / (32 - 21), 0, 1);       // 21→1, 32→0
  const experience = clamp((age - 20) / (31 - 20), 0, 1);  // 20→0, 31+→1
  const potRaw = Number(riderRow.potentiale);
  const potential = Number.isFinite(potRaw) ? clamp((potRaw - 1) / 5, 0, 1) : 0.4; // 1-6 → 0..1

  const out = { rider_id: physiology.rider_id ?? riderRow.id, formula_version: FORMULA_VERSION };

  // ── Direkte disciplin-evner: primær PCM-stat, 50-85 → 1-99 ────────────────────
  for (const [ability, stat] of Object.entries(PRIMARY_STAT)) {
    out[ability] = scoreFrac(pcmFrac(riderRow[stat]));
  }

  // aggression får et let ungdoms-tilt (unge ryttere angriber oftere) oven på ftr.
  const aggressionFrac = 0.85 * pcmFrac(riderRow.stat_ftr) + 0.15 * youth;
  out.aggression = scoreFrac(aggressionFrac);

  // ── Afledte evner (ingen egen disciplin-stat) ─────────────────────────────────
  // positioning: flad-placering + nedkørsel + offensiv vej-fornemmelse (§3).
  out.positioning = scoreFrac(0.50 * pcmFrac(riderRow.stat_fl) + 0.30 * pcmFrac(riderRow.stat_ned) + 0.20 * pcmFrac(riderRow.stat_ftr));
  // tactics: erfaring (alder) + angrebsiver (§3 — Mod bruges IKKE, nu durability).
  out.tactics = scoreFrac(0.55 * experience + 0.45 * aggressionFrac);
  // hidden_potential: potentiale + ungdom + seeded støj (delvist ukendt per design).
  out.hidden_potential = scoreFrac(0.60 * potential + 0.25 * youth + 0.15 * hashNoise(riderRow.id ?? physiology.rider_id));

  return out;
}
