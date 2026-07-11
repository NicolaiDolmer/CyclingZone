// Race Engine v3 (#2224), slice S1 — roller med pris: work-cost + kaptajn-
// beskyttelse. Fixer samme-hold-dominansen dér hvor den opstår: arbejde for
// holdet skal koste egen placering (spec §6, docs/superpowers/specs/
// 2026-07-11-race-engine-depth-credibility-design.md).
//
// Ren lib: ingen DB/fs, ingen rng. work_cost er en DETERMINISTISK lookup
// (rolle × profil × effort) — den konsumerer ALDRIG rng, så noise/breakaway-
// sekvenserne i raceSimulator.js er upåvirkede. ALT bag flag
// `race_engine_v3_scoring` (se raceEngineFlag.js) — flag-off = denne fil
// importeres slet ikke af den kolde sti (raceSimulator.js kalder kun ind når
// v3=true), så flag-off forbliver bit-identisk.
//
// ── Tunings-flade (ÉT sted, jf. spec §14 "kalibrerings-eksplosion") ───────────
// ALLE S1-balancekonstanter samles her. Kalibrering = redigér RACE_V3_TUNING,
// ingen andre filer rører tal.
export const RACE_V3_TUNING = Object.freeze({
  // Hjælper-arbejde på GC-relevante profiler (spec §6, ejer-beslutning §16.2
  // "A — MARKANT"): kandidat −0.045 (interval −0.03..−0.06 ≈ −6 til −11
  // ability-point ≈ −10 til −30 pladser i et tæt felt). Negativt = trækkes fra.
  WORK_COST_HELPER_GC: -0.045,
  // Flad etape: leadout-arbejde efter afsat spurt — mindre end GC-arbejdet
  // (kortere, mere lokaliseret indsats).
  WORK_COST_HELPER_FLAT: -0.04,
  // Hunter kører eget løb (udbruds-kandidat) men bruger stadig kræfter for
  // holdet — lille, profil-uafhængig pris.
  WORK_COST_HUNTER: -0.01,
  // Kaptajn/sprint_captain betaler ingen work-cost (de MODTAGER holdets arbejde).
  WORK_COST_CAPTAIN: 0,
  WORK_COST_SPRINT_CAPTAIN: 0,
  // free_role (NY rolle, S1): "kør dit eget løb" — 0 cost, 0 holdbidrag.
  WORK_COST_FREE_ROLE: 0,

  // Kaptajnens modydelse: TEAM_RACE_WEIGHT hæves fra v1's 0.024 (raceSimulator.js).
  // Spec §6 nævner "~0.05" som UDGANGSPUNKT ("kandidat") — empirisk kalibrering
  // mod anti-exploit-oraklet (raceRoleExploitOracle.test.js, spec §6: "kaptajn-
  // setup ≥ all-free_role på BÅDE sæsonpoint OG sejre") viste at 0.05 IKKE var
  // nok: et sæson-simuleret tophold (kaptajn+7 hjælpere, 48 løb, 8 terræner) tabte
  // på sæsonpoint til all-free_role (708 vs. 769) ved 0.05. 0.12 gav en solid
  // margin (806 vs. 769 point, 22 vs. 14 sejre). Se rapport til orkestrator —
  // dette ER forventet iterativ kalibrering (spec §6: "kalibreres til at holde"),
  // IKKE en færdig-kalibreret konstant; orkestratoren kan justere videre sammen
  // med S2's variansbudget.
  TEAM_RACE_WEIGHT_V3: 0.12,

  // Trætheds-kobling (spec §6 + §8): en hjælper der arbejder (protect-effort)
  // akkumulerer +20% race-fatigue den dag; save (spar kræfter) −30%. Dormant
  // seam i S1 (ingen per-etape effort-datamodel endnu — det er S3's
  // race_stage_roles-tabel) — raceRunner.js kalder ind med effort='normal'
  // (multiplikator 1.0) indtil S3 fylder rigtige værdier ind, PRÆCIS samme
  // mønster som form/fatigue-seams i raceSimulator.js ventede på #1306.
  FATIGUE_MULTIPLIER_PROTECT: 1.2,
  FATIGUE_MULTIPLIER_SAVE: 0.7,
  FATIGUE_MULTIPLIER_NORMAL: 1.0,

  // effort skalerer også selve work-cost'en/kaptajn-bidraget (spec §8):
  // protect = fuld pris, normal = fuld pris (baseline), save = halv pris.
  EFFORT_COST_MULTIPLIER_SAVE: 0.5,
  EFFORT_COST_MULTIPLIER_DEFAULT: 1.0,
});

// GC-relevante profiler (spec §6): helper-arbejde her koster WORK_COST_HELPER_GC.
// Delt med simulateSeasonDryRun.js's Section F (samme sæt som helperDeltasAll-
// filteret) — ét sted at definere "GC-relevant".
export const GC_RELEVANT_PROFILES = Object.freeze(
  new Set(["rolling", "hilly", "mountain", "high_mountain", "classic"])
);
export const FLAT_LEADOUT_PROFILES = Object.freeze(new Set(["flat"]));

export const VALID_RACE_ROLES = Object.freeze([
  "captain", "sprint_captain", "helper", "hunter", "free_role",
]);
export const VALID_EFFORTS = Object.freeze(["protect", "normal", "save"]);

/**
 * Basis-prisen (før effort-skalering) for en rolle på en given etapeprofil.
 * Ukendt profil (itt/ttt/cobbles m.fl. — ikke opregnet i spec §6) → 0 for
 * helper (ingen defineret domestique-mekanik der endnu; hunter/captain er
 * profil-uafhængige og upåvirkede).
 *
 * @param {string} role
 * @param {string} profileType
 * @returns {number} negativ eller 0
 */
function baseWorkCost(role, profileType) {
  switch (role) {
    case "helper":
      if (GC_RELEVANT_PROFILES.has(profileType)) return RACE_V3_TUNING.WORK_COST_HELPER_GC;
      if (FLAT_LEADOUT_PROFILES.has(profileType)) return RACE_V3_TUNING.WORK_COST_HELPER_FLAT;
      return 0;
    case "hunter":
      return RACE_V3_TUNING.WORK_COST_HUNTER;
    case "captain":
      return RACE_V3_TUNING.WORK_COST_CAPTAIN;
    case "sprint_captain":
      return RACE_V3_TUNING.WORK_COST_SPRINT_CAPTAIN;
    case "free_role":
      return RACE_V3_TUNING.WORK_COST_FREE_ROLE;
    default:
      return 0; // ukendt/manglende rolle → ingen straf (defensivt, som v1)
  }
}

/**
 * work_cost(rolle, etapeprofil, effort) — spec §6, `backend/lib/raceRoles.js`.
 * Returnerer den NEGATIVE (eller 0) score-delta der trækkes fra en rytters
 * finalScore for at have arbejdet for holdet. Ren, deterministisk, ingen rng.
 *
 * @param {string} role          race_role (captain/sprint_captain/helper/hunter/free_role)
 * @param {string} profileType   stageProfile.profile_type
 * @param {'protect'|'normal'|'save'} [effort='normal']  S3-seam; default 'normal' (fuld pris, som i dag før S3 fylder værdier ind)
 * @returns {number}
 */
export function workCost(role, profileType, effort = "normal") {
  const base = baseWorkCost(role, profileType);
  if (base === 0) return 0;
  const mult = effort === "save"
    ? RACE_V3_TUNING.EFFORT_COST_MULTIPLIER_SAVE
    : RACE_V3_TUNING.EFFORT_COST_MULTIPLIER_DEFAULT; // protect + normal = fuld pris (spec §8)
  return base * mult;
}

/**
 * Trætheds-multiplikator for en rytters dags-belastning givet effort (spec §6
 * + §8: protect +20%, save −30%, normal uændret). Dormant i S1 (se
 * FATIGUE_MULTIPLIER_*-kommentar ovenfor) — raceFatigue.js's
 * stageEnteringFatigues() ganger raceFatigueLoad(profil) med dette tal.
 *
 * @param {'protect'|'normal'|'save'} [effort='normal']
 * @returns {number}
 */
export function effortFatigueMultiplier(effort = "normal") {
  if (effort === "protect") return RACE_V3_TUNING.FATIGUE_MULTIPLIER_PROTECT;
  if (effort === "save") return RACE_V3_TUNING.FATIGUE_MULTIPLIER_SAVE;
  return RACE_V3_TUNING.FATIGUE_MULTIPLIER_NORMAL;
}

/**
 * TEAM_RACE_WEIGHT der skal bruges givet v3-tilstand — ÉT sted at vælge mellem
 * v1's frosne konstant og v3's kalibrerede boost. raceSimulator.js importerer
 * v1's TEAM_RACE_WEIGHT direkte (uændret export, bit-identisk flag-off);
 * denne funktion bruges KUN når v3=true.
 *
 * @returns {number}
 */
export function teamRaceWeightV3() {
  return RACE_V3_TUNING.TEAM_RACE_WEIGHT_V3;
}
