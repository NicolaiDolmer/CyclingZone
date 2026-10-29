// #5319 · Træningskatalog v3 (S12) bag stadie-flaget `training_catalog_v3`.
//
// Spec: docs/superpowers/specs/2026-10-29-training-catalog-v3-design.md (§2 + §5).
// Ejer-valg 29/10: 1A (de nye enkeltstart- og brostenssessioner har hovedevnen
// på 1,5, ikke 2), 2A (gemte threshold-planer for enkeltstarts- og
// klassementsryttere flyttes til itt_long af scripts/5319-migrate-threshold-plans.mjs),
// 3A (ingen variationsbonus).
//
// ═══ HVORFOR ET EGET MODUL OG IKKE NYE RÆKKER I training.js ════════════════
// Flaget off SKAL være bit-identisk med i dag. TRAINING_FOCUSES, FOCUS_ABILITY_WEIGHT,
// TRAINING_SESSIONS_BY_LEVEL og SESSION_INTENSITY læses direkte af motoren,
// diagnostik (trainingSlotHealth), anbefalinger (riderPeakPlans) og balance-
// scripts. En ny nøgle dér ville ændre dem alle, også med flaget off. Derfor
// bor v3 her, og dagens tabeller er urørte (bevist i trainingCatalogV3.test.js).
//
// ═══ HVOR FLAGET VIRKER (vægttabellen vælges ét sted) ═════════════════════
//   · Motoren: applyTrainingCatalog(program, { v3 }) lægger v3-sessionens evner
//     og vægte på programmet (focusAbilities + focusWeights), som abilityMult,
//     trainingScore og developmentScore allerede læser. Off = programmet urørt.
//   · Skrivestien: programForChoice/sessionsForDayType (trainingDayTypes.js)
//     tager `catalogV3`; routes afviser en v3-session når flaget er off for viewer.
//   · Fladen: frontend/src/lib/trainingCatalogV3.js spejler tabellerne.

import { TRAINING_FOCUSES, FOCUS_ABILITY_WEIGHT } from "./training.js";
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const TRAINING_CATALOG_V3_FLAG_KEY = "training_catalog_v3";

// De fem nye hårde sessioner, i præsentations-rækkefølge. De står EFTER
// attack_repeats, så dagens rækkefølge (og alt der sammenligner med den) er uændret.
export const V3_NEW_HARD_SESSIONS = Object.freeze([
  "long_climbs", "lead_out", "itt_short", "itt_long", "cobbled_classic",
]);

// Sessioner hvis evner eller vægte er anderledes i v3 end i dag. Navneskift
// (vo2max_climb, vo2max_punch) er kun i18n og står derfor ikke her.
export const V3_CHANGED_SESSIONS = Object.freeze(["threshold", "sprint"]);

// Alle sessioner v3 lægger evner/vægte på i motoren.
export const V3_OVERRIDDEN_SESSIONS = Object.freeze([...V3_CHANGED_SESSIONS, ...V3_NEW_HARD_SESSIONS]);

const V3_FOCUS_DELTA = Object.freeze({
  // Tærskel træner ikke længere enkeltstart (S12: aldrig enkeltstart + tempo i én session).
  threshold:       Object.freeze(["tempo", "endurance"]),
  sprint:          Object.freeze(["sprint", "acceleration"]),
  long_climbs:     Object.freeze(["climbing", "tempo", "endurance"]),
  lead_out:        Object.freeze(["acceleration", "flat", "positioning"]),
  itt_short:       Object.freeze(["time_trial", "flat"]),
  itt_long:        Object.freeze(["time_trial", "endurance"]),
  cobbled_classic: Object.freeze(["cobblestone", "endurance"]),
});

const V3_WEIGHT_DELTA = Object.freeze({
  threshold:       Object.freeze({ tempo: 2, endurance: 1 }),
  sprint:          Object.freeze({ sprint: 2, acceleration: 1 }),
  long_climbs:     Object.freeze({ climbing: 1, tempo: 1, endurance: 1 }),
  lead_out:        Object.freeze({ acceleration: 1, flat: 1, positioning: 1 }),
  // Ejer-valg 1A: hovedevnen 1,5, ikke 2.
  itt_short:       Object.freeze({ time_trial: 1.5, flat: 1.5 }),
  itt_long:        Object.freeze({ time_trial: 1.5, endurance: 1.5 }),
  cobbled_classic: Object.freeze({ cobblestone: 1.5, endurance: 1.5 }),
});

export const V3_TRAINING_FOCUSES = Object.freeze({ ...TRAINING_FOCUSES, ...V3_FOCUS_DELTA });
export const V3_FOCUS_ABILITY_WEIGHT = Object.freeze({ ...FOCUS_ABILITY_WEIGHT, ...V3_WEIGHT_DELTA });

export function v3FocusAbilityWeight(focus, ability) {
  const w = V3_FOCUS_ABILITY_WEIGHT[focus]?.[ability];
  return Number.isFinite(w) ? w : 1;
}

export function v3FocusWeightSum(focus) {
  return (V3_TRAINING_FOCUSES[focus] ?? []).reduce((sum, a) => sum + v3FocusAbilityWeight(focus, a), 0);
}

// "Par for": hver rytter-type har præcis to hårde sessioner (spec §2). Data,
// ikke motor-input: det bruges af invariant-testen og af Hjælp/fladen. vo2max
// er hybriden og står bevidst ikke som par for nogen.
export const V3_RIDER_TYPE_HARD_PAIRS = Object.freeze({
  sprinter:       Object.freeze(["sprint", "lead_out"]),
  tt:             Object.freeze(["itt_short", "itt_long"]),
  climber:        Object.freeze(["vo2max_climb", "long_climbs"]),
  puncheur:       Object.freeze(["vo2max_punch", "threshold"]),
  brostensrytter: Object.freeze(["cobbled_sectors", "cobbled_classic"]),
  baroudeur:      Object.freeze(["vo2max_punch", "attack_repeats"]),
  rouleur:        Object.freeze(["echelon_drills", "itt_short"]),
  gc:             Object.freeze(["vo2max_climb", "itt_long"]),
});

export function isV3OnlySession(session) {
  return typeof session === "string" && V3_NEW_HARD_SESSIONS.includes(session);
}

// Motorens ene kobling. Off = programmet returneres URØRT (samme objekt), så
// flag-off er bit-identisk. On = for de sessioner v3 ændrer eller tilføjer,
// får programmet v3-evnerne og -vægtene. Et program der allerede bærer sin
// egen evne-liste (løbsdagens pas, raceDayYield.js) røres aldrig.
export function applyTrainingCatalog(program, { v3 = false } = {}) {
  if (!v3 || !program || program.focusAbilities) return program;
  const focus = program.focus;
  if (!V3_OVERRIDDEN_SESSIONS.includes(focus)) return program;
  program.focusAbilities = V3_TRAINING_FOCUSES[focus];
  program.focusWeights = V3_FOCUS_ABILITY_WEIGHT[focus];
  return program;
}

// ── Flag-læsere (samme to former som trainingWeekPlanCellsFlag.js) ─────────
// API'et: viewerens beta-status, fail-safe (fejl = off).
export async function isTrainingCatalogV3Enabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, TRAINING_CATALOG_V3_FLAG_KEY), opts);
}

// Motoren: holdets ejer afgør beta. KASTER ved et fejlet opslag, så et tick
// aldrig afregnes med det forkerte katalog. ASCII-only beskeder (#i18n-leak-guard).
export async function isTrainingCatalogV3EnabledForTeam(supabase, teamId) {
  const { data: flagRow, error } = await supabase
    .from("app_config").select("value").eq("key", TRAINING_CATALOG_V3_FLAG_KEY).maybeSingle();
  if (error) throw new Error(`training_catalog_v3 flag load: ${error.message ?? error}`);
  const stage = flagRow?.value ?? null;
  if (stage === true || stage === "on") return true;
  if (stage !== "beta") return false;
  const { data: team, error: teamError } = await supabase
    .from("teams").select("user_id").eq("id", teamId).maybeSingle();
  if (teamError) throw new Error(`training_catalog_v3 owner load (team ${teamId}): ${teamError.message ?? teamError}`);
  if (!team?.user_id) return false;
  const { data: user, error: userError } = await supabase
    .from("users").select("role, is_beta_tester").eq("id", team.user_id).maybeSingle();
  if (userError) throw new Error(`training_catalog_v3 owner beta load (team ${teamId}): ${userError.message ?? userError}`);
  return user?.role === "admin" || user?.is_beta_tester === true;
}
