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

  // ── S2 (#2353): dagsform + jour sans + form-vægt (spec §7) ──────────────────
  // Dagsform: per (rytter, etape-seed) seeded normal-komponent — NAVNGIVET
  // varians (optræder i why-rapporten som "stærk/tung dag"), IKKE en skrue på
  // NOISE_SD_SCALE (gate-kalibreret, røres ikke). Spec-interval 0.012-0.018;
  // start-kandidat 0.015; S2-grid-sweep-værdi
  // (docs/audits/2026-07-12-race-v3-s2-calibration.md).
  // RE-KALIBRERING 17/7 (#2557, variant C, ejer-go): population-drift siden
  // S2 (favoriteWinRate 43-44 % mod 17/7-populationen, uden for 25-40 %-bånd)
  // — 0.015→0.018 sammen med TOP_COMPRESSION_TAU 0.5→0.40 bringer favWin i
  // bånd (38,1-38,9 % på 3 seeds) med mindst mulig kollateralskade på ITT
  // sammenlignet med τ-only-varianten B. Fuldt scorecard:
  // docs/audits/2026-07-17-race-v3-recalibration-scorecard.md.
  DAYFORM_SD: envNum("RACE_V3_DAYFORM_SD", 0.018),

  // Jour sans (kollapsdagen): Bernoulli pr. (rytter, etape). BASE-raten er
  // grid-knappen (spec-interval 2-5%); form-koblingen skalerer den lineært
  // mellem FORM_LOW og FORM_HIGH: form ≤ 40 → base × 5/3, form ≥ 70 →
  // base × 2/3 (ved base 3% = spec §7's "5% ved form<40, 2% ved form>70"
  // ordret). Manglende form-data → base (neutral, ikke worst-case — samme
  // princip som formComponent's NaN-guard). Udfald: uniform i [MIN, MAX],
  // trækkes fra scoren. Asymmetrien er pointen: favoritter der KNÆKKER.
  JOUR_SANS_P_BASE: envNum("RACE_V3_JOUR_SANS_P", 0.03),
  JOUR_SANS_FORM_LOW: 40,
  JOUR_SANS_FORM_HIGH: 70,
  JOUR_SANS_P_MULT_LOWFORM: 5 / 3,
  JOUR_SANS_P_MULT_HIGHFORM: 2 / 3,
  JOUR_SANS_MAGNITUDE_MIN: 0.05,
  JOUR_SANS_MAGNITUDE_MAX: 0.10,

  // Form-vægt i race-scoren (spec §7: v1's 0.012 gør form-kanalen "reelt
  // usynlig"). v3 hæver den så formstyring bliver spillerens våben; v1-
  // konstanten FORM_RACE_WEIGHT i raceSimulator.js er UÆNDRET (flag-off
  // bit-identisk). Spec-interval 0.025-0.045; start-kandidat 0.035.
  FORM_RACE_WEIGHT_V3: envNum("RACE_V3_FORM_WEIGHT", 0.035),

  // ── Top-kompression (EJER-BESLUTNING 12/7: option 2 valgt, τ=0.5) ───────────
  // Pr. etape over det fremmødte felt komprimeres terrain-scores OVER feltets
  // p90 mod p90: s' = p90 + τ·(s − p90); s ≤ p90 urørt. Deterministisk,
  // percentil-baseret, monotont ordens-bevarende, ingen rng; rører IKKE
  // parcours-/udbruds-/team-mekanikken (de kører på RÅ terrain).
  // Adresserer S2's rod-årsag DIREKTE: målt felt-gab #1→#5 var 0.060 (2× spec
  // §7's antagelse 0.032); τ=0.5 bringer det til 0.030, hvorefter spec-
  // variansen (DAYFORM_SD 0.015) leverer favWin 37,5-38,8 % I BÅND på alle 3
  // seeds (podium/ITT/type-integritet/S1-gates grønne; oracle +17,6 %).
  // Probe-grids (A: ren varians når ALDRIG båndet) + option-sammenligning +
  // endelige 3-seeds-tal: docs/audits/2026-07-12-race-v3-s2-calibration.md
  // ("Eksplorative prober" + "Beslutning (ejer 12/7)").
  // RE-KALIBRERING 17/7 (#2557, variant C, ejer-go): 0.5→0.40 — se
  // DAYFORM_SD-kommentar ovenfor for begrundelse + scorecard-link.
  TOP_COMPRESSION_TAU: envNum("RACE_V3_TOP_COMPRESSION_TAU", 0.40),

  // ── S5 (#2224): form-peaks som spillerens våben (spec §10 + addendum §2) ─────
  // peak = spillervalgt formtop i et 5-dages vindue om et mål-løb. Lægges på
  // finalScore som en NAVNGIVET, forklarlig komponent (why-rapporten: "toppede
  // for dette løb"). REALISERET top = PEAK_MAX × traeningskvalitet i optakten
  // (racePeaks.computeTrainingQuality) — koblingen der gør formen tjent, ikke en
  // gratis kalender-bonus (ejer 13/7: "koblingen er hele pointen"). Payback
  // betales FULDT uanset træning (taper er et lån). Start-kandidater fra spec
  // §10 (+0.02 / −0.01); endelige tal via S5-harness-sweep mod peak-neutralitets-
  // oraklet + koblings-scorecardet FØR ship. Env-override = samme mønster som
  // S1/S2/S4. Flag-off (race_engine_v3_scoring off) → racePeaks kaldes aldrig →
  // peak=0 → bit-identisk.
  PEAK_MAX: envNum("RACE_V3_PEAK_MAX", 0.02),
  PEAK_PAYBACK: envNum("RACE_V3_PEAK_PAYBACK", 0.01),
  // Payback-vinduets længde i DAGE efter peak-vinduet (formhul). Samme enhed som
  // racePeaks' dag-sammenligning (dags-indeks). Kandidat = vindueslængden + lidt.
  PEAK_PAYBACK_DAYS: envNum("RACE_V3_PEAK_PAYBACK_DAYS", 7),
  // Gulv for realiseret peak-fraktion: selv med elendig optakt giver en peak et
  // lille løft (man MØDER stadig op udhvilet). Under dette bliver "sæt en peak"
  // meningsløst; over 0 straffer dårlig træning mærkbart. Tunes i harnesset.
  PEAK_TQ_FLOOR: envNum("RACE_V3_PEAK_TQ_FLOOR", 0.2),
  // Optakts-vinduets længde i DAGE FØR peak-vinduets start (addendum §2: build→
  // taper-blokken hvorover traeningskvalitet måles). Samme dag-enhed som racePeaks'
  // ordinal-sammenligning. Kandidat = ~2 ugers periodisering; endelig værdi via
  // S5-harness-sweep (peak-neutralitet + koblings-scorecard). Env-override som S1/S2/S4.
  PEAK_LEADUP_DAYS: envNum("RACE_V3_PEAK_LEADUP_DAYS", 14),
  // Vægte for traeningskvalitet ∈ [0,1] (addendum §2): konsistens (trænede dage),
  // fokus-match (relevante evner for profilen), sundhed (ingen skade), trætheds-
  // styring (ramte taper udhvilet). Strukturelle (ikke env); summen normaliseres.
  PEAK_TQ_WEIGHTS: Object.freeze({ consistency: 0.35, focusMatch: 0.25, health: 0.25, fatigue: 0.15 }),

  // ── S4 (#1176): styrt/mekaniske uheld + DNF ─────────────────────────────────
  // Pr.-etape hit-sandsynlighed pr. rytter, FØR positioning-reduktion/descent-
  // multiplikator (raceIncidents.incidentProbability). Grid-kalibreret 2026-07-12
  // mod harnessets DNF-bånd (evaluateIncidentBoundsOracle, raceDryRunOracles.js;
  // scorecard-log i simulateSeasonDryRun.js) — se den log for den fulde sweep.
  // Env-override pr. profil (samme mønster som S1/S2's RACE_V3_*-envs) muliggør
  // fremtidige re-kalibreringer uden kode-ændring. cobbles/classic højest
  // (pavé/teknisk); itt/ttt lavest (soloindsats, ingen felt-dynamik). _default
  // dækker ukendte profiler.
  INCIDENT_BASE_BY_PROFILE: Object.freeze({
    flat: envNum("RACE_V3_INCIDENT_BASE_FLAT", 0.017),
    rolling: envNum("RACE_V3_INCIDENT_BASE_ROLLING", 0.017),
    hilly: envNum("RACE_V3_INCIDENT_BASE_HILLY", 0.015),
    mountain: envNum("RACE_V3_INCIDENT_BASE_MOUNTAIN", 0.013),
    high_mountain: envNum("RACE_V3_INCIDENT_BASE_HIGH_MOUNTAIN", 0.013),
    itt: envNum("RACE_V3_INCIDENT_BASE_ITT", 0.003),
    ttt: envNum("RACE_V3_INCIDENT_BASE_TTT", 0.003),
    cobbles: envNum("RACE_V3_INCIDENT_BASE_COBBLES", 0.040),
    classic: envNum("RACE_V3_INCIDENT_BASE_CLASSIC", 0.024),
    _default: envNum("RACE_V3_INCIDENT_BASE_DEFAULT", 0.017),
  }),
  // Descent-finale (finale_type='descent') skalerer basissandsynligheden op —
  // nedkørsler er hvor de fleste alvorlige styrt sker i virkeligheden.
  INCIDENT_DESCENT_FINALE_MULT: envNum("RACE_V3_INCIDENT_DESCENT_MULT", 1.5),
  // Positioning (0-99) dæmper p lineært: p *= 1 − reduction·(positioning/99).
  // Manglende positioning → 0 (ingen dæmpning, fuld eksponering).
  INCIDENT_POSITIONING_MAX_REDUCTION: envNum("RACE_V3_INCIDENT_POSITIONING_MAX_REDUCTION", 0.4),
  // Hård determinstisk cap: højst ⌈MAX_FIELD_SHARE × felt⌉ uheld pr. etape —
  // beskytter mod et urealistisk masse-styrt-felt på uheldige seeds.
  INCIDENT_MAX_FIELD_SHARE: envNum("RACE_V3_INCIDENT_MAX_FIELD_SHARE", 0.05),
  // Udfald givet et hit: ABANDON_SHARE = andelen der udgår (DNF); resten = time_loss.
  INCIDENT_ABANDON_SHARE: envNum("RACE_V3_INCIDENT_ABANDON_SHARE", 0.25),
  // Art givet et hit: MECHANICAL_SHARE = andelen mekaniske defekter; resten = styrt.
  INCIDENT_MECHANICAL_SHARE: envNum("RACE_V3_INCIDENT_MECHANICAL_SHARE", 0.3),
  // time_loss-magnitude: uniform i [MIN, MAX] sekunder, lagt til rytterens stageGap.
  INCIDENT_TIME_LOSS_MIN_S: envNum("RACE_V3_INCIDENT_TIME_LOSS_MIN_S", 30),
  INCIDENT_TIME_LOSS_MAX_S: envNum("RACE_V3_INCIDENT_TIME_LOSS_MAX_S", 300),
  // abandon-magnitude: uniform i [MIN, MAX] skadedage → rider_condition.injured_until.
  INCIDENT_INJURY_MIN_DAYS: envNum("RACE_V3_INCIDENT_INJURY_MIN_DAYS", 1),
  INCIDENT_INJURY_MAX_DAYS: envNum("RACE_V3_INCIDENT_INJURY_MAX_DAYS", 5),
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

/**
 * FORM_RACE_WEIGHT der skal bruges givet v3-tilstand (S2, #2353) — samme
 * mønster som teamRaceWeightV3(): v1's frosne konstant bor i raceSimulator.js
 * og røres ikke; denne bruges KUN når v3=true.
 *
 * @returns {number}
 */
export function formRaceWeightV3() {
  return RACE_V3_TUNING.FORM_RACE_WEIGHT_V3;
}

/**
 * τ for top-kompressionen (probe B, EKSPLORATIV — default 1.0 = ingen effekt).
 * Se TOP_COMPRESSION_TAU-kommentaren i RACE_V3_TUNING.
 *
 * @returns {number}
 */
export function topCompressionTau() {
  return RACE_V3_TUNING.TOP_COMPRESSION_TAU;
}

/**
 * Basis-hit-sandsynlighed (S4, #1176) for en given etapeprofil, FØR positioning-
 * reduktion/descent-multiplikator (raceIncidents.incidentProbability lægger dem
 * oven på). Ukendt profil → INCIDENT_BASE_BY_PROFILE._default. Samme
 * lookup-mønster som breakawayMaxBonus i raceSimulator.js.
 *
 * @param {string} profileType
 * @returns {number}
 */
export function incidentBaseProbability(profileType) {
  const map = RACE_V3_TUNING.INCIDENT_BASE_BY_PROFILE;
  const v = map[profileType];
  return Number.isFinite(v) ? v : map._default;
}
