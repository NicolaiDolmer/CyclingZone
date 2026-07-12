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
//
// SWEEP-OVERRIDES (kalibrerings-harness-only): de tre kalibrérbare konstanter
// kan overstyres via env (RACE_V3_WORK_COST_HELPER_GC / RACE_V3_WORK_COST_HELPER_FLAT
// / RACE_V3_TEAM_RACE_WEIGHT) så scripts/sweepS1WorkCost.mjs kan køre et
// joint grid i child-processer UDEN at redigere denne fil pr. celle. Prod/CI
// sætter ALDRIG disse envs → tallene nedenfor er de gældende. Ingen secrets.
const envNum = (name, def) => {
  const raw = process.env[name];
  if (raw == null || raw === "") return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
};

export const RACE_V3_TUNING = Object.freeze({
  // Hjælper-arbejde på GC-relevante profiler (spec §6, ejer-beslutning §16.2
  // "A — MARKANT"): spec-interval −0.03..−0.06. Negativt = trækkes fra.
  // VINDER af joint grid-sweep 2026-07-12 (3×4-grid + kant-udvidelse til −0.06;
  // fuld tabel: docs/audits/2026-07-12-race-v3-s1-calibration.md): −0.03.
  // NØGLEFUND: counterfactual hjælper-tab-medianen (top-terrain-linsen) er
  // næsten UELASTISK i work-cost (median 3→5 over HELE spec-intervallet
  // −0.03..−0.06) — score-gabene i toppen af pulje-felterne er ~0.01/plads, så
  // −0.03..−0.06 flytter en top-hjælper 3-13 pladser, aldrig 10-30 som median.
  // Derfor vælges den LAVESTE cost der (sammen med w=0.10) består oraklet —
  // den minimerer favorit-win-forværringen og efterlader mest varians-budget
  // til S2. p75 = 8-9 tabte pladser: mærkbart for de bedste hjælpere.
  WORK_COST_HELPER_GC: envNum("RACE_V3_WORK_COST_HELPER_GC", -0.03),
  // Flad etape: leadout-arbejde efter afsat spurt — skaleret proportionalt
  // med GC-costen (8/9-forhold, jf. spec-kandidaterne −0.04/−0.045).
  WORK_COST_HELPER_FLAT: envNum("RACE_V3_WORK_COST_HELPER_FLAT", -0.0267),
  // Hunter kører eget løb (udbruds-kandidat) men bruger stadig kræfter for
  // holdet — lille, profil-uafhængig pris.
  WORK_COST_HUNTER: -0.01,
  // Kaptajn/sprint_captain betaler ingen work-cost (de MODTAGER holdets arbejde).
  WORK_COST_CAPTAIN: 0,
  WORK_COST_SPRINT_CAPTAIN: 0,
  // free_role (NY rolle, S1): "kør dit eget løb" — 0 cost, 0 holdbidrag.
  WORK_COST_FREE_ROLE: 0,

  // Kaptajnens modydelse: TEAM_RACE_WEIGHT hæves fra v1's 0.024 (raceSimulator.js).
  // Spec §6's kandidat "~0.05" holdt IKKE mod anti-exploit-oraklet (tophold
  // tabte på sæsonpoint til all-free_role, 708 vs. 769 ved 0.05). VINDER af
  // joint grid-sweep 2026-07-12 (scripts/sweepS1WorkCost.mjs; kriterier i
  // prioriteret rækkefølge: oracle grøn m. ≥+1% point-margin OG sejre ≥ →
  // hold-koncentration i bånd → counterfactual hjælper-tab → LAVEST favorit-
  // win-forværring): 0.10 = den MINDSTE grid-vægt der består oraklet med
  // margin (+2.3% point, 20 vs. 14 sejre ved gc=−0.03). Bevidst ikke 0.12:
  // boostet er weight×helperSupport, og hver 0.02 ekstra vægt æder direkte af
  // §7-regnestykkets udfordrer-vindue (favorit-gab 0.032) — S2's varians-
  // budget. Fuld tabel: docs/audits/2026-07-12-race-v3-s1-calibration.md.
  TEAM_RACE_WEIGHT_V3: envNum("RACE_V3_TEAM_RACE_WEIGHT", 0.10),

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
