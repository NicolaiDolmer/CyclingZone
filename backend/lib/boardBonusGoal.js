// #4856 · Hvor et ACCEPTERET bonustilbuds ekstra-mål lander.
//
// Rod-årsagen (fundet under #4844): accept-routen skrev ekstra-målet KUN til
// `board_profiles.current_goals` (den gamle tre-planers-model), mens
// Boardroom-siden (#4557/#4844) læser mål fra `board_mandates.goals`. Målet
// blev derfor aldrig vist for spilleren på den nye side — og det er ikke en
// kosmetisk mangel: det er den halvdel af handelen spilleren SKAL kunne se,
// nu hvor pengene allerede er krediteret.
//
// Valget: DOBBELT-SKRIVNING, ikke flytning.
//   * `board_profiles.current_goals` skrives UÆNDRET og ubetinget. Den gamle
//     model er stadig sandheden for penge og satisfaction (BOARD_RULES §6 —
//     mandat-modellen er `beta`), så en flytning ville stille fjerne bonus-
//     målets konsekvens fra sæson-evalueringen.
//   * `board_mandates.goals` skrives OVENI, gated af skrive-gaten
//     (`isBoardMandateModelEnabled(..., { engineWrite: true })`, #4839: `beta`
//     tæller som on for skrivninger, `off` er kill-switch for begge). Med
//     flaget `off` er adfærden dermed bit-for-bit som før; med `beta`/`on`
//     bærer mandatet målet, og Boardroom viser det med `Bonus`-mærkatet
//     (`boardRoom.js`: `isBonus: goal.source === "bonus_offer"`).
//
// Begge skrivninger er idempotente på `bonus_offer_id`: et dobbeltklik eller
// et retry efter net-fejl må ikke give holdet to ekstra-mål for ét tilbud.
// Feltet er ren metadata — `buildGoalKey` (boardGoals.js) er indholdsbaseret
// og ignorerer ekstra felter, og `addGoalMetadata` spreder dem videre.
//
// Baseline-mekanikken (#3574) er flyttet hertil ordret fra api.js: bonus-
// tilbuddets ekstra-mål er en BEHOLDNING (stjerne-ryttere i truppen nu,
// monument-podier i indeværende sæson), så uden en baseline ville et hold der
// allerede kvalificerer sig være "ahead" i samme sekund målet tilføjes.

import { BOARD_IDENTITY_RIDER_SELECT } from "./boardConstants.js";
import { countTeamStarRiders } from "./boardIdentity.js";
import { loadGoalContextForBoard } from "./boardGoalContext.js";
import { isBoardMandateModelEnabled } from "./boardMandateFlag.js";

function ensureSupabase(supabase) {
  if (!supabase) throw new Error("supabase client is required");
}

/**
 * Bygger selve mål-objektet. Samme form i BEGGE tabeller — mandatet og
 * profilen skal ikke drifte fra hinanden på feltnavne.
 */
export function buildBonusExtraGoal({ extraGoal, baseline = null, offerId = null }) {
  return {
    type: extraGoal?.type,
    target: extraGoal?.target,
    cumulative: false,
    source: "bonus_offer",
    label: extraGoal?.label,
    baseline,
    bonus_offer_id: offerId ?? null,
  };
}

/**
 * Har et mål-array allerede dette tilbuds ekstra-mål?
 * Ældre rækker (skrevet før #4856) bærer ikke `bonus_offer_id`; for dem falder
 * vi tilbage til type+target+source, så en reparation/retry på et gammelt
 * accepteret tilbud heller ikke dublerer.
 */
export function hasBonusGoalForOffer(goals, { offerId, extraGoal }) {
  if (!Array.isArray(goals)) return false;
  return goals.some((goal) => {
    if (goal?.source !== "bonus_offer") return false;
    if (offerId && goal?.bonus_offer_id) return goal.bonus_offer_id === offerId;
    return goal?.type === extraGoal?.type && goal?.target === extraGoal?.target;
  });
}

/**
 * #3574 · Beholdnings-baseline på accept-tidspunktet. `null` for måltyper der
 * ikke er beholdninger (DNA-tradition-mål bærer aldrig baseline).
 */
export async function computeBonusGoalBaseline({
  supabase,
  teamId,
  boardId,
  extraGoal,
  loadGoalContext = loadGoalContextForBoard,
} = {}) {
  ensureSupabase(supabase);
  if (extraGoal?.type === "signature_rider") {
    const { data: currentRiders, error } = await supabase
      .from("riders")
      // pagination-safe: ét holds trup er bounded af rostergrænsen (~30-40 ryttere)
      .select(BOARD_IDENTITY_RIDER_SELECT)
      .eq("team_id", teamId);
    if (error) throw new Error(`riders (bonus-offer baseline): ${error.message}`);
    return countTeamStarRiders(currentRiders || []);
  }

  if (extraGoal?.type === "monument_podium") {
    const { data: activeSeason, error } = await supabase
      .from("seasons").select("id").eq("status", "active").maybeSingle();
    if (error) throw new Error(`seasons (bonus-offer baseline): ${error.message}`);
    if (!activeSeason?.id) return 0;
    const context = await loadGoalContext({
      supabase,
      teamId,
      boardId,
      currentSeasonId: activeSeason.id,
    });
    return context.cumulativeMonumentPodiums ?? 0;
  }

  return null;
}

/**
 * Holdets `completed` 1yr-plan — den række den gamle sti skriver ekstra-målet
 * til, og hvis id monument_podium-baselinen måles imod.
 */
export async function loadCompletedOneYearBoard({ supabase, teamId } = {}) {
  ensureSupabase(supabase);
  const { data, error } = await supabase
    .from("board_profiles")
    .select("id, current_goals, plan_type")
    .eq("team_id", teamId)
    .eq("plan_type", "1yr")
    .eq("negotiation_status", "completed")
    .maybeSingle();
  if (error) throw new Error(`board_profiles lookup failed: ${error.message}`);
  return data ?? null;
}

/**
 * Den gamle sti (uændret adfærd): ekstra-målet på holdets `completed` 1yr-plan.
 * `current_goals` er en JSON-STRENG i `board_profiles` — ikke jsonb som
 * mandatets `goals`.
 */
export async function appendBonusGoalToBoardProfile({ supabase, teamId, goal, offerId, board = undefined } = {}) {
  ensureSupabase(supabase);
  const oneYrBoard = board === undefined
    ? await loadCompletedOneYearBoard({ supabase, teamId })
    : board;
  if (!oneYrBoard) return { written: false, reason: "no_board_profile" };

  const existingGoals = typeof oneYrBoard.current_goals === "string"
    ? JSON.parse(oneYrBoard.current_goals)
    : (oneYrBoard.current_goals || []);

  if (hasBonusGoalForOffer(existingGoals, { offerId, extraGoal: goal })) {
    return { written: false, reason: "already_present", boardId: oneYrBoard.id };
  }

  const { error: updateError } = await supabase.from("board_profiles")
    .update({
      current_goals: JSON.stringify([...existingGoals, goal]),
      updated_at: new Date().toISOString(),
    })
    .eq("id", oneYrBoard.id);
  if (updateError) throw new Error(`board_profiles goal update failed: ${updateError.message}`);

  return { written: true, boardId: oneYrBoard.id };
}

/**
 * #4856 · Den nye sti: samme ekstra-mål ind i holdets AKTIVE mandat, som er
 * det Boardroom-siden læser. Rækken vælges med præcis samme filter+sortering
 * som `boardRoom.js` bruger (status='active', nyeste `signed_at`), så vi
 * skriver til den række spilleren faktisk får vist.
 */
export async function appendBonusGoalToActiveMandate({ supabase, teamId, goal, offerId } = {}) {
  ensureSupabase(supabase);
  const { data: mandate, error } = await supabase
    .from("board_mandates")
    .select("id, goals")
    .eq("team_id", teamId)
    .eq("status", "active")
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`board_mandates lookup failed: ${error.message}`);
  if (!mandate) return { written: false, reason: "no_active_mandate" };

  // jsonb i skemaet, men vær tolerant: en streng må ikke koste ekstra-målet.
  const existingGoals = Array.isArray(mandate.goals)
    ? mandate.goals
    : (typeof mandate.goals === "string" && mandate.goals.trim() ? JSON.parse(mandate.goals) : []);

  if (hasBonusGoalForOffer(existingGoals, { offerId, extraGoal: goal })) {
    return { written: false, reason: "already_present", mandateId: mandate.id };
  }

  const { error: updateError } = await supabase
    .from("board_mandates")
    .update({ goals: [...existingGoals, goal], updated_at: new Date().toISOString() })
    .eq("id", mandate.id)
    .eq("status", "active");
  if (updateError) throw new Error(`board_mandates goal update failed: ${updateError.message}`);

  return { written: true, mandateId: mandate.id };
}

/**
 * Én indgang for accept-routen: beregn baseline én gang, skriv målet begge
 * steder. Kaster videre — kalderen (api.js) beholder sin best-effort-ramme
 * (#3578: pengene + status er den atomiske kerne, et fejlet mål-skriv må ikke
 * gøre en allerede-krediteret bonus umulig at gennemføre).
 */
export async function applyAcceptedBonusGoal({
  supabase,
  teamId,
  offerId,
  extraGoal,
  loadGoalContext = loadGoalContextForBoard,
  isMandateModelEnabled = isBoardMandateModelEnabled,
} = {}) {
  ensureSupabase(supabase);
  if (!teamId) throw new Error("teamId is required");
  if (!extraGoal?.type) {
    return {
      goal: null,
      profile: { written: false, reason: "no_extra_goal" },
      mandate: { written: false, reason: "no_extra_goal" },
    };
  }

  // Ét opslag: samme række bærer BÅDE skrivemålet for den gamle sti og det
  // board_id monument_podium-baselinen måles imod (uændret fra api.js).
  const oneYrBoard = await loadCompletedOneYearBoard({ supabase, teamId });

  const baseline = await computeBonusGoalBaseline({
    supabase,
    teamId,
    boardId: oneYrBoard?.id ?? null,
    extraGoal,
    loadGoalContext,
  });

  const goal = buildBonusExtraGoal({ extraGoal, baseline, offerId });

  const profile = await appendBonusGoalToBoardProfile({ supabase, teamId, goal, offerId, board: oneYrBoard });

  // Skrive-gaten (#4839): `beta` tæller som on, `off` slår mandat-skrivningen
  // helt fra — så er adfærden bit-for-bit som før #4856.
  let mandate = { written: false, reason: "flag_off" };
  if (await isMandateModelEnabled(supabase, { engineWrite: true })) {
    mandate = await appendBonusGoalToActiveMandate({ supabase, teamId, goal, offerId });
  }

  return { goal, profile, mandate };
}
