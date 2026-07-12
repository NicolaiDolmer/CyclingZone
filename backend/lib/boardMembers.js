// S-02c · Board-medlems-tildeling, sample-reaction, replacement-trigger.
// Master roadmap: docs/slices/02-board-redesign-MASTER.md
//
// Q-bekræftelser (2026-05-05 session):
//   A1: 5 medlemmer fast pr. team
//   A2: 3 identity-matched + 2 non-conflicting wildcards (debt_aversion/youth_focus/results_pressure)
//   A3/v4.39: tildeles efter Club DNA er valgt, via dna-choose/auto-accept
//   A6: kategori-match med fallback til chairman ved tvivl
//   A7: udskift KUN formanden (=højeste alignment_score) ved replacement-trigger
//   A8: per-team counter på teams.consecutive_low_satisfaction_expirations
//
// Skalerings-præmis (CLAUDE.md): operationen er constant time pr. team uanset antal managers.
// Ingen kode-loops over fast manager-antal — vi henter kun teams der mangler members.

import {
  BOARD_ARCHETYPE_KEYS,
  BOARD_ARCHETYPES,
  archetypesConflict,
  computeArchetypeAlignmentScore,
  getArchetypeByKey,
} from "./boardArchetypes.js";
import { getDnaArchetypeAlignmentBonus } from "./boardClubDna.js";
import { captureException } from "./sentry.js";

export const TEAM_BOARD_MEMBERS_COUNT = 5;
export const IDENTITY_PICKS = 3;
export const WILDCARD_PICKS = 2;
export const REPLACEMENT_TRIGGER_THRESHOLD = 2; // 2× plan-udløb i træk under 30% sat
export const LOW_SATISFACTION_THRESHOLD = 30;

function throwIfSupabaseError(error, message) {
  if (!error) return;
  throw new Error(`${message}: ${error.message}`);
}

// Deterministisk seed-baseret pseudo-random fra string.
// Bruges til at vælge wildcards stabilt fra (team_id + season_observed)-hash,
// så replay af DNA-valg/repair returnerer samme members.
function seededShuffle(items, seed) {
  const numericSeed = Array.from(String(seed)).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const indexed = items.map((item, idx) => ({ item, sortKey: ((idx + 1) * numericSeed) % 9999 }));
  indexed.sort((a, b) => a.sortKey - b.sortKey);
  return indexed.map((entry) => entry.item);
}

/**
 * Vælger 5 board-medlemmer for et team baseret på identity_basis.
 *
 * Algoritme:
 *  1. Compute alignment_score for alle 9 arketyper mod identity_basis.
 *  2. Tag top-3 identity-matched (selection_kind='identity').
 *  3. Tilføj 2 wildcards FRA RESTERENDE 6, valgt så der ikke opstår conflict
 *     på friction-akser (debt_aversion / youth_focus / results_pressure)
 *     med de 3 identity-medlemmer ELLER med hinanden.
 *  4. Hvis ingen non-conflicting wildcards findes (sjældent edge-case),
 *     fyld op fra resterende uden conflict-rule. Stadig deterministisk.
 *  5. Marker medlemmet med højeste alignment_score som chairman.
 *
 * @param {{ identityBasis: object, teamId?: string, seedExtra?: string, dnaKey?: string|null }} args
 * @returns {Array<{ archetype_key, selection_kind, alignment_score, is_chairman }>}
 */
export function selectBoardMembers({ identityBasis, teamId = "", seedExtra = "", dnaKey = null } = {}) {
  if (!identityBasis) {
    throw new Error("identity_basis is required to select board members");
  }

  const seed = `${teamId}:${seedExtra}:${identityBasis.season_number_observed ?? 1}`;

  // 1. Score alle 9 arketyper, sorter desc.
  // S-02f · DNA-bias: hvis manageren har valgt en klub-DNA, tilføjes
  // member_alignment_bonus[archetypeKey] til alignment_score så DNA påvirker
  // hvilke 5 medlemmer der vælges. Første tildeling sker efter DNA-valg, så
  // bias slår ind fra første board-plan.
  const scored = BOARD_ARCHETYPE_KEYS.map((key) => {
    const archetype = BOARD_ARCHETYPES[key];
    const baseScore = computeArchetypeAlignmentScore(archetype, identityBasis);
    const dnaBonus = dnaKey ? getDnaArchetypeAlignmentBonus(dnaKey, key) : 0;
    return {
      archetype,
      key,
      score: baseScore + dnaBonus,
    };
  }).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tie-break deterministisk på key for stabilitet
    return a.key.localeCompare(b.key);
  });

  // 2. Top-3 identity-matches
  const identityPicks = scored.slice(0, IDENTITY_PICKS);

  // 3. Wildcards: vælg blandt de 6 resterende, undgå conflict med identityPicks + valgte wildcards.
  const remaining = scored.slice(IDENTITY_PICKS);
  const shuffledRemaining = seededShuffle(remaining, seed);
  const wildcardPicks = [];

  for (const candidate of shuffledRemaining) {
    if (wildcardPicks.length >= WILDCARD_PICKS) break;

    const allCurrent = [...identityPicks, ...wildcardPicks];
    const hasConflict = allCurrent.some((existing) =>
      archetypesConflict(existing.archetype, candidate.archetype)
    );

    if (!hasConflict) wildcardPicks.push(candidate);
  }

  // 4. Fallback hvis vi ikke fik 2 non-conflicting — fyld op uden conflict-rule.
  if (wildcardPicks.length < WILDCARD_PICKS) {
    for (const candidate of shuffledRemaining) {
      if (wildcardPicks.length >= WILDCARD_PICKS) break;
      if (wildcardPicks.find((p) => p.key === candidate.key)) continue;
      wildcardPicks.push(candidate);
    }
  }

  // 5. Markér chairman = højeste alignment_score (typisk identityPicks[0]).
  const allMembers = [
    ...identityPicks.map((p) => ({ ...p, selection_kind: "identity" })),
    ...wildcardPicks.map((p) => ({ ...p, selection_kind: "wildcard" })),
  ];
  const chairmanKey = allMembers.reduce((best, current) =>
    !best || current.score > best.score ? current : best
  , null)?.key;

  return allMembers.map((member) => ({
    archetype_key: member.key,
    selection_kind: member.selection_kind,
    alignment_score: member.score,
    is_chairman: member.key === chairmanKey,
  }));
}

/**
 * Persistér selected members til DB. Idempotent — skipper hvis team allerede
 * har TEAM_BOARD_MEMBERS_COUNT medlemmer (matcher idempotency-pattern fra
 * boardSequentialNegotiation S-02b for identity_basis).
 *
 * @param {{ supabase: object, teamId: string, identityBasis: object, dnaKey?: string|null }} args
 * @returns {Promise<{ assigned: number, skipped: boolean, members: Array }>}
 */
export async function assignBoardMembersForTeam({ supabase, teamId, identityBasis, dnaKey = null } = {}) {
  if (!supabase?.from) throw new Error("Supabase client is required");
  if (!teamId) throw new Error("teamId is required");
  if (!identityBasis) {
    return { assigned: 0, skipped: true, reason: "missing_identity_basis", members: [] };
  }

  // Idempotency: skip hvis vi allerede har 5 medlemmer for dette team.
  const { data: existing, error: existingError } = await supabase
    .from("team_board_members")
    .select("archetype_key")
    .eq("team_id", teamId);
  throwIfSupabaseError(existingError, "Could not read existing team board members");

  if ((existing || []).length >= TEAM_BOARD_MEMBERS_COUNT) {
    return { assigned: 0, skipped: true, reason: "already_assigned", members: existing };
  }

  const selection = selectBoardMembers({ identityBasis, teamId, dnaKey });

  const rows = selection.map((member) => ({
    team_id: teamId,
    archetype_key: member.archetype_key,
    selection_kind: member.selection_kind,
    alignment_score: member.alignment_score,
    is_chairman: member.is_chairman,
  }));

  const { error: insertError } = await supabase
    .from("team_board_members")
    .insert(rows);
  throwIfSupabaseError(insertError, "Could not insert team board members");

  return { assigned: rows.length, skipped: false, members: selection };
}

export async function regenerateBoardMembersForTeam({ supabase, teamId, identityBasis, dnaKey = null } = {}) {
  if (!supabase?.from) throw new Error("Supabase client is required");
  if (!teamId) throw new Error("teamId is required");
  if (!identityBasis) {
    return { assigned: 0, deleted: 0, skipped: true, reason: "missing_identity_basis", members: [] };
  }
  if (!dnaKey) {
    return { assigned: 0, deleted: 0, skipped: true, reason: "missing_dna", members: [] };
  }

  const { data: deleted, error: deleteError } = await supabase
    .from("team_board_members")
    .delete()
    .eq("team_id", teamId)
    .select("id");
  throwIfSupabaseError(deleteError, "Could not delete existing team board members");

  const result = await assignBoardMembersForTeam({ supabase, teamId, identityBasis, dnaKey });
  return {
    ...result,
    deleted: (deleted || []).length,
  };
}

/**
 * Atomisk + idempotent valg af Klub-DNA (#878).
 *
 * Tidligere skrev route'en `team_dna_key` til teams-rækken FØR member-regenereringen.
 * Hvis regenereringen fejlede midt i, stod teamet med DNA sat men nul board-members —
 * og 409-guarden ("allerede valgt") låste manageren ude uden vej frem.
 *
 * Denne funktion lukker hullet på to måder:
 *  1. Atomisk: ved første valg rulles `team_dna_key` tilbage hvis regenereringen kaster.
 *  2. Idempotent recovery: er DNA allerede sat men board-listen tom (et team der allerede
 *     nåede at blive låst før dette fix), kør regenereringen igen med den ALLEREDE valgte
 *     nøgle — aldrig den ønskede — så stien ikke kan misbruges til at skifte DNA.
 *
 * Kaster fejl med `.status` (+ valgfri `.code`) som route'en kan mappe til HTTP.
 */
/**
 * #2022 fase 2 · Er holdet stadig i sin FØRSTE sæson (DNA om-vælgeligt)?
 *
 * Per-hold-signal: et boards `seasons_completed` inkrementeres ved hver sæson-
 * overgang (economyEngine.processTeamSeasonEnd). Et nyt hold har board-rows med
 * seasons_completed=0 indtil dets første sæson-overgang. Vi kræver mindst én row
 * (ægte hold har altid et formations-board) OG at alle står på 0 — så et hold
 * uden board-rows (degenereret/test-tilstand) defensivt behandles som låst.
 *
 * @returns {Promise<boolean>}
 */
export async function isWithinFirstSeasonForTeam({ supabase, teamId } = {}) {
  if (!supabase?.from) throw new Error("Supabase client is required");
  if (!teamId) throw new Error("teamId is required");

  const { data, error } = await supabase
    .from("board_profiles")
    .select("seasons_completed")
    .eq("team_id", teamId);
  throwIfSupabaseError(error, "Could not read board seasons for DNA re-choose");

  const rows = data || [];
  return rows.length > 0 && rows.every((row) => Number(row.seasons_completed || 0) === 0);
}

export async function chooseDnaForTeam({ supabase, teamId, dnaKey } = {}) {
  if (!supabase?.from) throw new Error("Supabase client is required");
  if (!teamId) throw new Error("teamId is required");

  const { data: existing, error: existingError } = await supabase
    .from("teams")
    .select("id, team_dna_key, season_1_identity_basis")
    .eq("id", teamId)
    .single();
  if (existingError) {
    const err = new Error(existingError.message);
    err.status = 500;
    throw err;
  }
  if (!existing) {
    const err = new Error("No team");
    err.status = 404;
    throw err;
  }

  if (!existing.season_1_identity_basis) {
    // #2022: sæson-agnostisk. Grundlaget sættes ved holddannelse (uanset global
    // sæson) — så denne sti er en sjælden "endnu ikke klar"-tilstand, ikke en
    // sæson-1-gate. Tidligere kode-/copy lød "Du skal afslutte sæson 1", hvilket
    // var forkert for en sæson-2+-nykommer.
    // #2174 · EN-first fallback (ingen rå dansk i backend); frontend viser
    // altid den locale-korrekte tekst via errorCode → api.dna_requires_identity_basis.
    const err = new Error("Your club identity isn't ready yet. Try again in a moment.");
    err.status = 409;
    err.errorCode = "dna_requires_identity_basis"; // #678 Track 3 — EN-resolve via resolveApiError
    throw err;
  }

  // DNA er allerede sat: idempotent gen-generering (samme nøgle), re-valg (sæson 1)
  // eller afvisning (låst efter første sæson) / recovery (board tomt).
  if (existing.team_dna_key) {
    const { data: members, error: membersError } = await supabase
      .from("team_board_members")
      .select("id")
      .eq("team_id", teamId);
    if (membersError) {
      const err = new Error(membersError.message);
      err.status = 500;
      throw err;
    }

    if ((members || []).length > 0) {
      // Samme DNA valgt igen → idempotent: gen-generér deterministisk på den
      // valgte nøgle (samme members) i stedet for at fejle eller skifte.
      if (existing.team_dna_key === dnaKey) {
        const sameResult = await regenerateBoardMembersForTeam({
          supabase,
          teamId,
          identityBasis: existing.season_1_identity_basis,
          dnaKey: existing.team_dna_key,
        });
        return { recovered: true, dnaKey: existing.team_dna_key, members: sameResult.members || [] };
      }

      // #2022 fase 2: DNA er om-vælgeligt indtil holdet har afsluttet sin FØRSTE
      // sæson (ejer-valg 2026-06-29). Efter da er det låst (drift = senere slice).
      // Gaten er per-hold (seasons_completed på board-rows), ikke en global sæson-
      // tæller — så reglen holder for en nykommer i en levende liga.
      const canRechoose = await isWithinFirstSeasonForTeam({ supabase, teamId });
      if (!canRechoose) {
        const err = new Error("Klub-DNA er allerede valgt og kan ikke skiftes (drift kommer i senere slice)");
        err.status = 409;
        err.code = "DNA_ALREADY_CHOSEN";
        err.errorCode = "dna_already_chosen"; // #678 Track 3 — EN-resolve via resolveApiError
        throw err;
      }

      // Re-valg: skift nøgle + regenerér board-medlemmer på den NYE nøgle.
      // Goal_weighting læses live fra team_dna_key ved evaluering → ingen migration.
      // Rul tilbage til forrige nøgle (+ regenerér på den) hvis regenereringen
      // kaster, så holdet aldrig efterlades med ny nøgle men board fra den gamle.
      const previousKey = existing.team_dna_key;
      const { error: switchError } = await supabase
        .from("teams")
        .update({ team_dna_key: dnaKey, team_dna_chosen_at: new Date().toISOString() })
        .eq("id", teamId);
      if (switchError) {
        const err = new Error(switchError.message);
        err.status = 500;
        throw err;
      }

      let switchedMembers;
      try {
        switchedMembers = await regenerateBoardMembersForTeam({
          supabase,
          teamId,
          identityBasis: existing.season_1_identity_basis,
          dnaKey,
        });
      } catch (regenError) {
        await supabase
          .from("teams")
          .update({ team_dna_key: previousKey })
          .eq("id", teamId);
        await regenerateBoardMembersForTeam({
          supabase,
          teamId,
          identityBasis: existing.season_1_identity_basis,
          dnaKey: previousKey,
        }).catch((rollbackError) => {
          // #2389 A2: dobbelt-fejl i kompenserende transaktion — fejler selve
          // rollback'en, står holdet med inkonsistent DNA-nøgle vs. board. Var
          // før HELT stille (tom catch) → capture.
          captureException(rollbackError, { tags: { flow: "board-dna", stage: "rollback" }, teamId });
        });
        throw regenError;
      }
      return { rechosen: true, dnaKey, members: switchedMembers.members || [] };
    }

    // Recovery: DNA sat men board tomt → kør regenerering på den allerede valgte nøgle.
    const membersResult = await regenerateBoardMembersForTeam({
      supabase,
      teamId,
      identityBasis: existing.season_1_identity_basis,
      dnaKey: existing.team_dna_key,
    });
    return { recovered: true, dnaKey: existing.team_dna_key, members: membersResult.members || [] };
  }

  // Førstegangsvalg: skriv DNA, gen-generér, rul tilbage ved fejl.
  const { error: updateError } = await supabase
    .from("teams")
    .update({
      team_dna_key: dnaKey,
      team_dna_chosen_at: new Date().toISOString(),
    })
    .eq("id", teamId);
  if (updateError) {
    const err = new Error(updateError.message);
    err.status = 500;
    throw err;
  }

  let membersResult;
  try {
    membersResult = await regenerateBoardMembersForTeam({
      supabase,
      teamId,
      identityBasis: existing.season_1_identity_basis,
      dnaKey,
    });
  } catch (regenError) {
    // Best-effort rollback så teamet ikke efterlades dna-sat-men-boardless (og dermed låst).
    await supabase
      .from("teams")
      .update({ team_dna_key: null, team_dna_chosen_at: null })
      .eq("id", teamId);
    throw regenError;
  }

  return { recovered: false, dnaKey, members: membersResult.members || [] };
}

export async function repairBoardMembersAfterDna({ supabase } = {}) {
  if (!supabase?.from) throw new Error("Supabase client is required");

  const { data: teams, error } = await supabase
    .from("teams")
    .select("id, season_1_identity_basis, team_dna_key")
    .eq("is_ai", false)
    .eq("is_bank", false)
    .eq("is_frozen", false);
  throwIfSupabaseError(error, "Could not load teams for board-member DNA repair");

  const summary = {
    teams_checked: 0,
    teams_repaired: 0,
    members_deleted: 0,
    members_assigned: 0,
    skipped: 0,
  };

  for (const team of teams || []) {
    summary.teams_checked += 1;
    if (!team.season_1_identity_basis || !team.team_dna_key) {
      summary.skipped += 1;
      continue;
    }

    const result = await regenerateBoardMembersForTeam({
      supabase,
      teamId: team.id,
      identityBasis: team.season_1_identity_basis,
      dnaKey: team.team_dna_key,
    });

    if (result.skipped) {
      summary.skipped += 1;
      continue;
    }

    summary.teams_repaired += 1;
    summary.members_deleted += result.deleted || 0;
    summary.members_assigned += result.assigned || 0;
  }

  return summary;
}

/**
 * Vælger den dominerende reagerende-arketype baseret på feedback-kategori (A6).
 * Match-strategi:
 *  1. Filtrér til arketyper aktivt assigned til teamet (5 stk.).
 *  2. For den targetede kategori (strongest eller weakest), vælg arketypen med
 *     højeste category_alignment[kategori].
 *  3. Ved tvivl (ingen klar vinder, eller targeted kategori er null):
 *     fallback til chairman.
 *
 * @param {{ assignedMembers: Array, category: string, fallbackChairmanKey?: string }} args
 * @returns {object|null} arketype-objekt
 */
export function selectDominantMember({
  assignedMembers = [],
  category = null,
  fallbackChairmanKey = null,
} = {}) {
  if (!assignedMembers.length) return null;

  if (category) {
    const ranked = assignedMembers
      .map((member) => {
        const archetype = getArchetypeByKey(member.archetype_key);
        if (!archetype) return null;
        return {
          archetype,
          alignment: archetype.category_alignment?.[category] ?? 0,
          isChairman: member.is_chairman,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (b.alignment !== a.alignment) return b.alignment - a.alignment;
        // Tie-break: chairman vinder
        if (a.isChairman && !b.isChairman) return -1;
        if (b.isChairman && !a.isChairman) return 1;
        return 0;
      });

    const top = ranked[0];
    if (top?.alignment > 0) return top.archetype;
  }

  // Fallback: chairman
  const chairmanKey = fallbackChairmanKey
    ?? assignedMembers.find((m) => m.is_chairman)?.archetype_key;
  return chairmanKey ? getArchetypeByKey(chairmanKey) : null;
}

/**
 * Sample en reaktion fra den dominerende arketype, baseret på feedback-tone.
 * Brugt af buildBoardOutlook til at attache 'dominant_member' til feedback.
 *
 * Tone-mapping: positive → feedback_positive, steady/neutral → feedback_warning (subtilt push),
 * warning → feedback_warning, negative → feedback_negative.
 *
 * @param {{ archetype: object, tone: string, seed: string }} args
 * @returns {{ archetype_key: string, label: string, emoji: string, quote: string }|null}
 */
export function sampleReactionForFeedback({ archetype, tone = "neutral", seed = "" } = {}) {
  if (!archetype?.reactions) return null;
  const bucket = tone === "positive" ? "feedback_positive"
    : tone === "negative" ? "feedback_negative"
    : "feedback_warning";

  const templates = archetype.reactions[bucket] || [];
  if (!templates.length) return null;

  const numericSeed = Array.from(String(seed || archetype.key)).reduce(
    (acc, ch) => acc + ch.charCodeAt(0), 0
  );
  const idx = numericSeed % templates.length;

  return {
    archetype_key: archetype.key,
    label: archetype.label,
    // #917/#694 · i18n-koder (frontend resolver via board.json; DA = fallback).
    label_key: `archetypes.${archetype.key}.label`,
    emoji: archetype.emoji,
    short_description: archetype.short_description,
    short_description_key: `archetypes.${archetype.key}.shortDescription`,
    quote: templates[idx],
    quote_key: `archetypes.${archetype.key}.reactions.${bucket}.${idx}`,
    bucket,
  };
}

/**
 * Sample reaktion til et specifikt mål (mini-dialog ved goal-klik).
 * Bruges af frontend GoalCard expand for at vise medlem-portræt + citat.
 *
 * @param {{ archetype: object, goalContext: object, seed: string }} args
 * @returns {{ archetype_key, label, emoji, quote, bucket }|null}
 */
export function sampleReactionForGoal({ archetype, goalContext = {}, seed = "" } = {}) {
  if (!archetype?.reactions) return null;
  const status = goalContext.status; // 'achieved' | 'failed' | 'pending' | 'on_track'
  const bucket = status === "achieved" || status === "complete" ? "goal_achievement"
    : status === "failed" || status === "behind" ? "goal_failure"
    : "goal_proposal";

  const templates = archetype.reactions[bucket] || archetype.reactions.goal_proposal || [];
  if (!templates.length) return null;

  const seedString = String(seed || archetype.key + (goalContext.type || ""));
  const numericSeed = Array.from(seedString).reduce(
    (acc, ch) => acc + ch.charCodeAt(0), 0
  );
  const idx = numericSeed % templates.length;

  return {
    archetype_key: archetype.key,
    label: archetype.label,
    // #917/#694 · i18n-koder (frontend resolver via board.json; DA = fallback).
    label_key: `archetypes.${archetype.key}.label`,
    emoji: archetype.emoji,
    short_description: archetype.short_description,
    short_description_key: `archetypes.${archetype.key}.shortDescription`,
    quote: templates[idx],
    quote_key: `archetypes.${archetype.key}.reactions.${bucket}.${idx}`,
    bucket,
  };
}

/**
 * Replacement-trigger: kaldes fra economyEngine.processSeasonEnd's planIsComplete-branch.
 *
 * Logik:
 *  - Plan-udløb m. satisfaction < LOW_SATISFACTION_THRESHOLD → counter++
 *  - Plan-udløb m. satisfaction >= LOW_SATISFACTION_THRESHOLD → counter = 0
 *  - Når counter == REPLACEMENT_TRIGGER_THRESHOLD (2):
 *      → udskift formanden (slet row, indsæt ny fra ikke-assignede arketyper)
 *      → reset counter til 0
 *      → returnér replacement-info så caller kan sende notification
 *
 * Skalerer for variabelt manager-antal: én læsning + én write pr. team-trigger.
 *
 * @param {{ supabase: object, teamId: string, satisfaction: number, identityBasis: object }} args
 * @returns {Promise<{ counter: number, replaced: boolean, old_chairman_key?, new_chairman_key? }>}
 */
export async function processReplacementTrigger({
  supabase,
  teamId,
  satisfaction,
  identityBasis,
  dnaKey = null,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client is required");
  if (!teamId) throw new Error("teamId is required");

  const { data: team, error: teamError } = await supabase
    .from("teams")
    .select("id, consecutive_low_satisfaction_expirations, season_1_identity_basis, team_dna_key, is_ai, is_bank, is_frozen")
    .eq("id", teamId)
    .maybeSingle();
  throwIfSupabaseError(teamError, "Could not load team for replacement trigger");

  // Skip AI/bank/frozen — manager-only (Q-batch 1A Q8)
  if (!team || team.is_ai || team.is_bank || team.is_frozen) {
    return { counter: 0, replaced: false, skipped: true };
  }

  const currentCounter = Number(team.consecutive_low_satisfaction_expirations || 0);
  const isLowSat = Number(satisfaction) < LOW_SATISFACTION_THRESHOLD;

  if (!isLowSat) {
    // Reset counter — gode tider, formanden bliver
    if (currentCounter > 0) {
      const { error } = await supabase
        .from("teams")
        .update({ consecutive_low_satisfaction_expirations: 0 })
        .eq("id", teamId);
      throwIfSupabaseError(error, "Could not reset replacement counter");
    }
    return { counter: 0, replaced: false };
  }

  const newCounter = currentCounter + 1;

  if (newCounter < REPLACEMENT_TRIGGER_THRESHOLD) {
    // Increment, ingen replacement endnu
    const { error } = await supabase
      .from("teams")
      .update({ consecutive_low_satisfaction_expirations: newCounter })
      .eq("id", teamId);
    throwIfSupabaseError(error, "Could not increment replacement counter");
    return { counter: newCounter, replaced: false };
  }

  // Trigger replacement — udskift formanden.
  const basis = identityBasis ?? team.season_1_identity_basis ?? null;
  const effectiveDnaKey = dnaKey ?? team.team_dna_key ?? null;
  const replacement = await replaceChairman({ supabase, teamId, identityBasis: basis, dnaKey: effectiveDnaKey });

  // Reset counter
  const { error: resetError } = await supabase
    .from("teams")
    .update({ consecutive_low_satisfaction_expirations: 0 })
    .eq("id", teamId);
  throwIfSupabaseError(resetError, "Could not reset counter after replacement");

  return {
    counter: 0,
    replaced: true,
    old_chairman_key: replacement.old_chairman_key,
    new_chairman_key: replacement.new_chairman_key,
    new_chairman_label: replacement.new_chairman_label,
  };
}

async function replaceChairman({ supabase, teamId, identityBasis, dnaKey = null }) {
  const { data: members, error: membersError } = await supabase
    .from("team_board_members")
    .select("id, archetype_key, alignment_score, is_chairman")
    .eq("team_id", teamId);
  throwIfSupabaseError(membersError, "Could not load team board members for replacement");

  if (!members?.length) {
    return { old_chairman_key: null, new_chairman_key: null, new_chairman_label: null };
  }

  const oldChairman = members.find((m) => m.is_chairman) || members[0];
  const remainingMembers = members.filter((m) => m.id !== oldChairman.id);
  const remainingKeys = new Set(remainingMembers.map((m) => m.archetype_key));

  // Pick ny formand fra de 4 ikke-assignede arketyper.
  // Vælg højest alignment, men non-conflicting med tilbageværende 4.
  // S-02f · DNA-bias slår ind ved chairman-replacement: en manager der har valgt
  // 'italiensk_klassiker' tipper formandsvalget mod klassiker_purist/traditionalisten.
  const remainingArchetypes = remainingMembers
    .map((m) => getArchetypeByKey(m.archetype_key))
    .filter(Boolean);

  const candidates = BOARD_ARCHETYPE_KEYS
    .filter((key) => !remainingKeys.has(key) && key !== oldChairman.archetype_key)
    .map((key) => {
      const archetype = getArchetypeByKey(key);
      const baseScore = computeArchetypeAlignmentScore(archetype, identityBasis);
      const dnaBonus = dnaKey ? getDnaArchetypeAlignmentBonus(dnaKey, key) : 0;
      return {
        key,
        archetype,
        score: baseScore + dnaBonus,
        hasConflict: remainingArchetypes.some((existing) =>
          archetypesConflict(existing, archetype)
        ),
      };
    })
    .filter(Boolean);

  // Foretrækker non-conflicting, ellers fallback til højest score
  const nonConflicting = candidates.filter((c) => !c.hasConflict);
  const pool = nonConflicting.length > 0 ? nonConflicting : candidates;
  const newChairmanCandidate = pool.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.key.localeCompare(b.key);
  })[0];

  if (!newChairmanCandidate) {
    return {
      old_chairman_key: oldChairman.archetype_key,
      new_chairman_key: null,
      new_chairman_label: null,
    };
  }

  // DELETE old chairman row, derefter INSERT ny chairman.
  // Invariant beskyttet af selectBoardMembers: kun én is_chairman=true pr. team.
  const { error: deleteError } = await supabase
    .from("team_board_members")
    .delete()
    .eq("id", oldChairman.id);
  throwIfSupabaseError(deleteError, "Could not remove old chairman");

  const { error: insertError } = await supabase
    .from("team_board_members")
    .insert({
      team_id: teamId,
      archetype_key: newChairmanCandidate.key,
      selection_kind: "identity",
      alignment_score: newChairmanCandidate.score,
      is_chairman: true,
    });
  throwIfSupabaseError(insertError, "Could not insert new chairman");

  return {
    old_chairman_key: oldChairman.archetype_key,
    new_chairman_key: newChairmanCandidate.key,
    new_chairman_label: newChairmanCandidate.archetype.label,
  };
}
