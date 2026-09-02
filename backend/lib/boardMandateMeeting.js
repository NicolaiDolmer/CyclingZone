/**
 * #4557 S-M2c · Årsmødet — API-facing aggregering + skrive-logik for
 * `GET /board/meeting`, `POST /board/meeting/focus` og
 * `POST /board/meeting/sign` (spec §4.2-§4.8, addendum "stemme-kontrakten").
 * ==========================================================================
 * Routen (routes/api.js) holdes tynd (flag-tjek + auth/team-scoping + fejl-
 * mapping), resten af aggregering/skrivning sker her, samme mønster som
 * `boardRoom.js::buildBoardRoomPayload`. Kaldere: routes/api.js (manager-
 * flowet) og boardMandateAutoAccept.js (cron-fallback, samme `signMandate`).
 *
 * KENDTE, DOKUMENTEREDE FORTOLKNINGER (spec siger ikke alt eksplicit):
 *
 *  1. §4.3 "afslag pakkes som counter" — de eksisterende gates i
 *     `resolveBoardRequest` (satisfaction/overallScore-tærskler) er
 *     BALANCE, ikke tekst, og omgås ALDRIG for kunstigt at tvinge et
 *     "approved" frem. `resolveMeetingRequestOutcome` pakker i stedet SAMME
 *     afslagsårsag som et modtilbud: `counter_kind: "tradeoff"` når
 *     `TRADEOFF_PAYLOADS_BY_REQUEST` kender typen (2 af 4 typer i dag), ellers
 *     `counter_kind: "deferred"` ("bestyrelsen genovervejer næste sæson").
 *     Der findes ALDRIG et rent `outcome: "rejected"` ud af denne funktion.
 *  2. Vision-slot-forslaget (A7, §4.4) regenereres DETERMINISTISK ved både
 *     GET og sign (samme `generateBoardGoals`-kald på samme input) i stedet
 *     for at blive persisteret mellem de to kald — matcher hvordan
 *     `/board/proposal` → `/board/sign` allerede fungerer i dag (forslaget
 *     er ikke skrevet før underskrift). Et hold hvis roster ændrer sig midt i
 *     mødesessionen kan derfor se et let ændret forslag ved sign — samme
 *     afgrænsning som resten af forhandlings-flowet.
 *  3. Fokus-skift ved sign (§9 spørgsmål 4: frit) regenererer mandatets mål
 *     for det NYE fokus server-side, hvis `sign.focus` afviger fra det
 *     foreslåede — en manager der skifter fokus direkte i sign-kaldet uden at
 *     kalde `/board/meeting/focus` først får stadig et korrekt mandat.
 */

import { buildGoalKey, generateBoardGoals, getPlanDuration } from "./boardGoals.js";
import {
  buildMandateGoalOptions,
  buildMilestoneKey,
  finalizeMandateGoals,
  MandateAdjustmentBudgetError,
} from "./boardMandate.js";
import {
  buildBoardRequestOptions,
  isValidBoardRequestType,
  resolveBoardRequest,
  TRADEOFF_PAYLOADS_BY_REQUEST,
} from "./boardRequests.js";
import { sampleVoiceLine, BoardVoiceEmptyBucketError } from "./boardVoice.js";
import { resolveGoalOwnerArchetypeKey } from "./boardMembers.js";
import { generateBoardMemberNames } from "./boardMandateNames.js";
import { isBoardMandateModelEnabled } from "./boardMandateFlag.js";
import { buildBoardRoomPayload } from "./boardRoom.js";

export class MandateSignConflictError extends Error {
  constructor(message, { errorCode = "board_mandate_sign_conflict" } = {}) {
    super(message);
    this.name = "MandateSignConflictError";
    this.status = 409;
    this.errorCode = errorCode;
  }
}

function ensureSupabase(supabase) {
  if (!supabase?.from) throw new Error("Supabase client is required");
}

async function loadMeetingContext(supabase, teamId) {
  const [teamRes, ridersRes, standingRes, membersRes, relationRes] = await Promise.all([
    supabase.from("teams")
      .select("id, balance, sponsor_income, team_dna_key, season_1_identity_basis")
      .eq("id", teamId).maybeSingle(),
    supabase.from("riders").select("*").eq("team_id", teamId),
    supabase.from("season_standings").select("*").eq("team_id", teamId)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("team_board_members")
      .select("archetype_key, selection_kind, alignment_score, is_chairman")
      .eq("team_id", teamId),
    supabase.from("board_relations").select("*").eq("team_id", teamId).maybeSingle(),
  ]);
  if (teamRes.error) throw new Error(`teams lookup failed: ${teamRes.error.message}`);
  if (relationRes.error) throw new Error(`board_relations lookup failed: ${relationRes.error.message}`);

  return {
    team: teamRes.data ?? null,
    riders: ridersRes.error ? [] : (ridersRes.data ?? []),
    standing: standingRes.error ? null : (standingRes.data ?? null),
    assignedMembers: membersRes.error ? [] : (membersRes.data ?? []),
    relation: relationRes.data ?? null,
  };
}

async function loadProposedMandate(supabase, teamId) {
  const { data, error } = await supabase
    .from("board_mandates")
    .select("*")
    .eq("team_id", teamId)
    .eq("status", "proposed")
    .order("proposed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`board_mandates lookup failed: ${error.message}`);
  return data ?? null;
}

async function loadOpenVisionSlot(supabase, teamId) {
  const { data, error } = await supabase
    .from("board_vision_milestones")
    .select("*")
    .eq("team_id", teamId)
    .eq("slot_open", true)
    .order("evaluated_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`board_vision_milestones lookup failed: ${error.message}`);
  return data ?? null;
}

/**
 * Deterministisk erstatnings-forslag for et tomt vision-slot (A7, §4.4):
 * ÉT mål fra `generateBoardGoals` for slottets `origin`-plantype, mål-sæson =
 * slottets oprindelige sæson hvis den stadig ligger i fremtiden, ellers næste
 * ledige (nuværende sæson + plan-varigheden). SAMME funktion kaldes af både
 * GET (visning) og sign (accept-skrivning) — se modul-headerens fortolkning 2.
 */
export function buildVisionSlotProposal({ openSlot, focus, team, riders, standing, currentSeasonNumber } = {}) {
  if (!openSlot) return null;
  const origin = openSlot.origin === "5yr" ? "5yr" : "3yr";
  const candidateGoal = generateBoardGoals({ focus, planType: origin, team, riders, standing })[0] || null;
  if (!candidateGoal) return null;

  const targetSeasonNumber = Number(openSlot.target_season_number) > Number(currentSeasonNumber)
    ? Number(openSlot.target_season_number)
    : Number(currentSeasonNumber) + getPlanDuration(origin);

  return {
    replaces_milestone_id: openSlot.id,
    origin,
    goal: candidateGoal,
    target_season_number: targetSeasonNumber,
    milestone_key: buildMilestoneKey({ origin, goal: candidateGoal, targetSeasonNumber, index: 0 }),
  };
}

/**
 * Spec §4.3: et afslag pakkes ALTID som et modtilbud — se modul-headerens
 * fortolkning 1.
 */
export function resolveMeetingRequestOutcome({
  mandate, relation, requestType, team, standing, context = {},
} = {}) {
  const boardShaped = {
    current_goals: mandate.goals,
    satisfaction: relation?.confidence ?? 50,
    plan_type: "1yr",
    focus: mandate.focus,
    negotiation_status: "completed",
    major_pivot_used_at: null,
  };

  const outcome = resolveBoardRequest({ board: boardShaped, requestType, team, standing, context });
  if (outcome.outcome !== "rejected") {
    return { ...outcome, meeting_outcome: outcome.outcome };
  }

  const tradeoffPayload = TRADEOFF_PAYLOADS_BY_REQUEST[requestType] || null;
  return {
    ...outcome,
    meeting_outcome: "counter",
    counter_kind: tradeoffPayload ? "tradeoff" : "deferred",
    counter_tradeoff_payload: tradeoffPayload,
  };
}

function buildGoalReactions({ mandateId, goal, options, ownerArchetypeKey, teamId, dnaKey, assignedMembers }) {
  if (!ownerArchetypeKey) return { easier: null, stretch: null };
  const goalKey = buildGoalKey(goal);
  const voiceContext = { teamId, dnaKey, members: assignedMembers };

  const reactionFor = (beat, available) => {
    if (!available) return null;
    try {
      const line = sampleVoiceLine({
        beat,
        archetypeKey: ownerArchetypeKey,
        // #4557 · seedet pr. (mandate, mål, valg) — SAMME linje uanset hvor
        // mange gange GET /board/meeting kaldes for dette mandat (addendum
        // "stemme-kontrakten" punkt 3: seed pr. hændelse, ikke pr. visning).
        seed: `${mandateId}:${goalKey}:${beat}`,
        context: voiceContext,
      });
      return { textKey: line.quote_key, textFallback: line.quote_fallback_da, memberName: line.member.navn };
    } catch (err) {
      // Tom bucket for denne (arketype, beat) — degradér til ingen reaktion
      // i stedet for at vælte hele mødet (samme mønster som
      // boardRoom.js::sampleVoiceLineOrNull).
      if (err instanceof BoardVoiceEmptyBucketError) return null;
      throw err;
    }
  };

  return {
    easier: reactionFor("meeting_easier", Boolean(options.easier)),
    stretch: reactionFor("meeting_stretch", Boolean(options.stretch)),
  };
}

/**
 * `GET /board/meeting` (spec §4.8). Returnerer `{ available: false }` (uden
 * yderligere læsning) når holdet ikke har et mandat i status `proposed`.
 */
export async function buildBoardMeetingPayload({ supabase, teamId } = {}) {
  ensureSupabase(supabase);
  if (!teamId) throw new Error("teamId is required");

  const mandate = await loadProposedMandate(supabase, teamId);
  if (!mandate) return { available: false };

  const { team, riders, standing, assignedMembers, relation } = await loadMeetingContext(supabase, teamId);
  const dnaKey = team?.team_dna_key ?? null;
  const fallbackChairmanKey = assignedMembers.find((m) => m.is_chairman)?.archetype_key
    ?? assignedMembers[0]?.archetype_key
    ?? null;
  const namedMembers = generateBoardMemberNames({
    teamId,
    members: assignedMembers.length ? assignedMembers : (fallbackChairmanKey ? [fallbackChairmanKey] : []),
    dnaKey,
  });
  const namesByArchetype = new Map(namedMembers.map((m) => [m.archetype_key, m]));

  const generosity = mandate.source?.negotiation_power?.counteroffer_generosity ?? 1.0;
  const trustTier = mandate.source?.negotiation_power?.trust_tier ?? null;
  const mandateGoals = Array.isArray(mandate.goals) ? mandate.goals : [];

  const goals = mandateGoals.map((goal) => {
    const ownerArchetypeKey = resolveGoalOwnerArchetypeKey({ goal, assignedMembers, fallbackChairmanKey });
    const owner = ownerArchetypeKey ? namesByArchetype.get(ownerArchetypeKey) : null;
    const options = buildMandateGoalOptions(goal, { generosity });
    return {
      goalKey: buildGoalKey(goal),
      ...goal,
      owner: owner ? { archetypeKey: ownerArchetypeKey, name: owner.full_name, initials: owner.initials } : null,
      options,
      reactions: buildGoalReactions({
        mandateId: mandate.id, goal, options, ownerArchetypeKey, teamId, dnaKey, assignedMembers,
      }),
    };
  });

  const requestBoardShaped = {
    current_goals: mandate.goals,
    satisfaction: relation?.confidence ?? 50,
    plan_type: "1yr",
    focus: mandate.focus,
    negotiation_status: "completed",
    major_pivot_used_at: null,
  };
  const requestOptions = mandate.request_used
    ? []
    : buildBoardRequestOptions({ board: requestBoardShaped, context: { requestUsedThisSeason: false, team, standing } });

  const openSlot = await loadOpenVisionSlot(supabase, teamId);
  const visionSlot = openSlot
    ? buildVisionSlotProposal({
      openSlot, focus: mandate.focus, team, riders, standing, currentSeasonNumber: mandate.season_number,
    })
    : null;

  return {
    available: true,
    mandate: {
      id: mandate.id,
      seasonNumber: mandate.season_number,
      focus: mandate.focus,
      deadlineAt: mandate.auto_accept_deadline,
      adjustments: { allowed: mandate.adjustments_allowed, used: mandate.adjustments_used },
      trustTier,
      goals,
    },
    request: { options: requestOptions },
    visionSlot,
  };
}

/**
 * `POST /board/meeting/focus` (spec §4.8): regenererer forslaget for et NYT
 * fokus og nulstiller mandatets valg (nye mål = 0 justeringer brugt endnu).
 * Skriver DIREKTE til den `proposed`-mandate-række (før underskrift er
 * mandatet stadig et forslag, ikke en aftale).
 */
export async function regenerateMandateFocus(supabase, { teamId, focus, isBetaTester = false } = {}) {
  ensureSupabase(supabase);
  if (!await isBoardMandateModelEnabled(supabase, { isBetaTester })) return null;

  const mandate = await loadProposedMandate(supabase, teamId);
  if (!mandate) return { available: false };

  const { team, riders, standing, assignedMembers } = await loadMeetingContext(supabase, teamId);
  const goals = generateBoardGoals({ focus, planType: "1yr", team, riders, standing, assignedMembers });

  const { error } = await supabase
    .from("board_mandates")
    .update({ focus, goals, adjustments_used: 0, updated_at: new Date().toISOString() })
    .eq("id", mandate.id)
    .eq("status", "proposed");
  if (error) throw new Error(`board_mandates focus-update failed: ${error.message}`);

  return buildBoardMeetingPayload({ supabase, teamId });
}

/**
 * Dual-write til legacy `board_profiles` 1yr-rækken (spec §4.6) — samme
 * upsert-form som `POST /board/sign` (routes/api.js), så
 * weekend-/sæson-slut-/konsekvens-motoren (som stadig evaluerer
 * `board_profiles`) og #4578-kvitteringerne fortsætter uændret, indtil
 * `BoardPage.jsx` pensioneres (S-M2d).
 */
export async function writeLegacyOneYearBoard(supabase, {
  teamId, seasonId, seasonNumber, focus, goals, team = null,
} = {}) {
  ensureSupabase(supabase);
  const { data: existingBoard, error: existingError } = await supabase
    .from("board_profiles")
    .select("id, satisfaction, budget_modifier")
    .eq("team_id", teamId)
    .eq("plan_type", "1yr")
    .maybeSingle();
  if (existingError) throw new Error(`board_profiles lookup failed: ${existingError.message}`);

  const upsertData = {
    team_id: teamId,
    focus,
    plan_type: "1yr",
    current_goals: goals,
    satisfaction: existingBoard?.satisfaction ?? 50,
    budget_modifier: existingBoard?.budget_modifier ?? 1.0,
    negotiation_status: "completed",
    plan_start_season_number: seasonNumber,
    plan_end_season_number: seasonNumber,
    plan_start_balance: team?.balance ?? 0,
    plan_start_sponsor_income: team?.sponsor_income ?? 100,
    seasons_completed: 0,
    cumulative_stage_wins: 0,
    cumulative_gc_wins: 0,
    season_id: seasonId ?? null,
    tradeoff_active_until_season_id: null,
    tradeoff_payload: null,
    major_pivot_used_at: null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase.from("board_profiles")
    .upsert(upsertData, { onConflict: "team_id,plan_type" }).select("id").single();
  if (error) throw new Error(`board_profiles dual-write failed: ${error.message}`);
  return data;
}

/**
 * `POST /board/meeting/sign` (spec §4.5) OG auto-accept-cronen
 * (boardMandateAutoAccept.js — Keep på alt, ingen anmodning). Idempotent på
 * `mandate.id` + status `proposed`: er mandatet allerede `active`, skrives
 * INTET igen — funktionen returnerer bare den friske Boardroom-payload
 * (retry-sikkert). Alt andet end `proposed`/`active` er en konflikt.
 */
export async function signMandate(supabase, {
  teamId,
  mandateId,
  focus = null,
  adjustments = [],
  request = null,
  visionSlot = null,
  now = new Date(),
  isBetaTester = false,
  signedVia = "manager",
} = {}) {
  ensureSupabase(supabase);
  if (!await isBoardMandateModelEnabled(supabase, { isBetaTester })) return null;
  if (!mandateId) throw new Error("mandateId is required");

  const { data: mandate, error: mandateError } = await supabase
    .from("board_mandates")
    .select("*")
    .eq("id", mandateId)
    .eq("team_id", teamId)
    .maybeSingle();
  if (mandateError) throw new Error(`board_mandates lookup failed: ${mandateError.message}`);
  if (!mandate) throw new MandateSignConflictError("Mandat ikke fundet.", { errorCode: "board_mandate_not_found" });

  // Idempotens (spec §4.5): allerede underskrevet → no-op, returnér frisk payload.
  if (mandate.status === "active") {
    return buildBoardRoomPayload({ supabase, teamId });
  }
  if (mandate.status !== "proposed") {
    throw new MandateSignConflictError(
      `Mandatet kan ikke underskrives fra status "${mandate.status}".`,
      { errorCode: "board_mandate_not_proposed" }
    );
  }

  const { team, riders, standing, assignedMembers, relation } = await loadMeetingContext(supabase, teamId);

  // #4557 §9 spørgsmål 4 (frit fokus-skift): et sign med et andet fokus end
  // det foreslåede regenererer mandatets mål server-side, så en manager der
  // ikke kaldte /board/meeting/focus først stadig får et korrekt mandat.
  const finalFocus = focus || mandate.focus;
  const baseGoals = finalFocus !== mandate.focus
    ? generateBoardGoals({ focus: finalFocus, planType: "1yr", team, riders, standing, assignedMembers })
    : (Array.isArray(mandate.goals) ? mandate.goals : []);

  const generosity = mandate.source?.negotiation_power?.counteroffer_generosity ?? 1.0;

  let finalizedGoals;
  let adjustmentsUsed;
  try {
    const finalized = finalizeMandateGoals({
      goals: baseGoals,
      adjustments,
      generosity,
      adjustmentsAllowed: mandate.adjustments_allowed,
    });
    finalizedGoals = finalized.goals;
    adjustmentsUsed = finalized.adjustments_used;
  } catch (err) {
    if (err instanceof MandateAdjustmentBudgetError) throw err;
    throw err;
  }

  let requestOutcome = null;
  let goalsAfterRequest = finalizedGoals;
  if (request?.type) {
    if (mandate.request_used) {
      throw new MandateSignConflictError(
        "Mandatets årsmøde-anmodning er allerede brugt.",
        { errorCode: "board_mandate_request_already_used" }
      );
    }
    if (!isValidBoardRequestType(request.type)) {
      throw new Error("Invalid request type");
    }
    requestOutcome = resolveMeetingRequestOutcome({
      mandate: { ...mandate, goals: finalizedGoals, focus: finalFocus },
      relation,
      requestType: request.type,
      team,
      standing,
      context: { team, standing, requestUsedThisSeason: false },
    });
    if (requestOutcome?.updated_board?.current_goals) {
      goalsAfterRequest = requestOutcome.updated_board.current_goals;
    }
  }

  // A7 vision-slot (§4.4): accept opretter milepælen + lukker slottet,
  // decline lukker kun slottet. Regenereret deterministisk — se modul-
  // headerens fortolkning 2.
  let visionSlotOutcome = null;
  if (visionSlot != null) {
    const openSlot = await loadOpenVisionSlot(supabase, teamId);
    if (openSlot) {
      const proposal = buildVisionSlotProposal({
        openSlot, focus: finalFocus, team, riders, standing, currentSeasonNumber: mandate.season_number,
      });
      if (proposal && visionSlot.accept) {
        const { error: insertError } = await supabase.from("board_vision_milestones").insert({
          team_id: teamId,
          milestone_key: proposal.milestone_key,
          goal: proposal.goal,
          target_season_number: proposal.target_season_number,
          origin: proposal.origin,
          weight: 1.0,
          is_headline: true,
          status: "pending",
        });
        if (insertError) throw new Error(`board_vision_milestones insert failed: ${insertError.message}`);
        visionSlotOutcome = { accepted: true, milestone_key: proposal.milestone_key };
      } else {
        visionSlotOutcome = { accepted: false };
      }
      const { error: closeError } = await supabase
        .from("board_vision_milestones")
        .update({ slot_open: false, updated_at: new Date().toISOString() })
        .eq("id", openSlot.id);
      if (closeError) throw new Error(`board_vision_milestones close-slot failed: ${closeError.message}`);
    }
  }

  const nowIso = now.toISOString();
  const { error: updateError } = await supabase
    .from("board_mandates")
    .update({
      status: "active",
      focus: finalFocus,
      goals: goalsAfterRequest,
      adjustments_used: adjustmentsUsed,
      request_used: Boolean(request?.type),
      signed_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", mandateId)
    .eq("status", "proposed");
  if (updateError) throw new Error(`board_mandates sign-update failed: ${updateError.message}`);

  // Kvitteringer (spec §4.5 + addendum "stemme-kontrakten"): formandens
  // meeting_keep-linje som beat for selve underskriften, + evt.
  // request.*-kvittering. satisfaction_delta=0 — underskrift flytter ikke
  // confidence i sig selv, kun den efterfølgende sæson gør.
  // #4557 · Kvitteringen bærer KUN kendte board_satisfaction_events-kolonner
  // (samme disciplin som boardMandateEngine.js::persistConfidenceChange) —
  // ingen ny "hvem sagde det"-kolonne. `reason_category: "mandate.signed"`/
  // `"mandate.auto_signed"` er registreret i boardRoom.js's
  // `CHAIRMAN_BEAT_BY_REASON` → beat `meeting_keep`, så Boardroom-payloaden
  // denne funktion returnerer NEDENFOR selv genfinder formandens linje
  // (samme mønster som milepæls-kvitteringerne, #4578) — ingen dobbelt-kilde.
  const chairmanKey = assignedMembers.find((m) => m.is_chairman)?.archetype_key
    ?? assignedMembers[0]?.archetype_key
    ?? null;
  const confidenceNow = relation?.confidence ?? 50;
  if (chairmanKey && relation) {
    await supabase.from("board_satisfaction_events").insert({
      team_id: teamId,
      mandate_id: mandateId,
      satisfaction_before: confidenceNow,
      satisfaction_after: confidenceNow,
      satisfaction_delta: 0,
      goals_met: 0,
      goals_total: goalsAfterRequest.length,
      reason_category: signedVia === "auto_accept" ? "mandate.auto_signed" : "mandate.signed",
    });
  }
  if (requestOutcome && relation) {
    await supabase.from("board_satisfaction_events").insert({
      team_id: teamId,
      mandate_id: mandateId,
      satisfaction_before: confidenceNow,
      satisfaction_after: confidenceNow,
      satisfaction_delta: 0,
      goals_met: 0,
      goals_total: 0,
      reason_category: `request.${requestOutcome.meeting_outcome}`,
    });
  }

  // Dual-write (§4.6): legacy-motoren må aldrig stå uden en 1yr-plan at evaluere.
  await writeLegacyOneYearBoard(supabase, {
    teamId,
    seasonId: mandate.season_id ?? null,
    seasonNumber: mandate.season_number,
    focus: finalFocus,
    goals: goalsAfterRequest,
    team,
  });

  const payload = await buildBoardRoomPayload({ supabase, teamId });
  return { ...payload, request_outcome: requestOutcome, vision_slot_outcome: visionSlotOutcome };
}
