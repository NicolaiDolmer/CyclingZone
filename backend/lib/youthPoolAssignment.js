// #5646 (Y3, del af #2492/#4620) · Hvilket hold i hvilken ungdomsgruppe.
//
// Ejer-valg 24/9 (spec docs/drafts/spec-ungdomslob-2026-09-24.md "Ejer-valg" 1+2):
//   - S4: én række ungdomsgrupper à 24 pr. trup (u23 og junior), alle på tier 1.
//     Ingen starter i en ungdoms-division; divisioner kommer først fra S5.
//   - ALLE ikke-parkerede managers er med, fordelt SNAKE efter seniorholdets
//     Global Rank, så grupperne er lige stærke.
//   - AI-hold fylder op til 24 pr. gruppe.
//   - En ny manager / et comeback i løbet af S4 overtager en AI-plads
//     (pickYouthGroupForNewTeam; wiringen i teamProfileEngine/comeback er et
//     followup, ikke dette modul).
//
// Modulet er RENT (ingen I/O). Al læsning/skrivning bor i
// backend/scripts/seedYouthPools.js. Rangeringen og snake-fordelingen GENBRUGES
// fra pyramidCompression.js (rankTeamsByGlobalRank + snakeAssign), ikke kopieret.

import { rankTeamsByGlobalRank, snakeAssign } from "./pyramidCompression.js";
import { isYouthSquad } from "./squads.js";
import { MIN_RACE_ENTRIES } from "./raceAutopick.js";

/** Ejer 24/9: grupper à 24 hold. */
export const YOUTH_GROUP_SIZE = 24;

/** Grupperne i S4 ligger alle på tier 1 (divisioner først fra S5). */
export const YOUTH_GROUP_TIER = 1;

/** De to ungdomstrupper der får grupper. */
export const YOUTH_POOL_SQUADS = Object.freeze(["u23", "junior"]);

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** "A".."Z", derefter "AA", "AB", ... (samme bogstav-mønster som seniorpuljerne). */
export function groupLetter(poolIndex) {
  let n = Number(poolIndex);
  if (!Number.isInteger(n) || n < 0) throw new Error(`groupLetter: ugyldigt pool_index ${poolIndex}`);
  let out = "";
  do {
    out = LETTERS[n % 26] + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** EN-label, uden tankestreg (tone-reglen), fx "U23 Group A". */
export function youthGroupLabel(squad, poolIndex) {
  assertYouthSquad(squad);
  const name = squad === "u23" ? "U23" : "Junior";
  return `${name} Group ${groupLetter(poolIndex)}`;
}

function assertYouthSquad(squad) {
  if (!isYouthSquad(squad)) throw new Error(`youthPoolAssignment: ukendt ungdomstrup '${squad}'`);
}

/**
 * Menneske-diskriminatoren fra D4-sammenlægningen (compressPyramidS3.js) +
 * parkering: kun aktive, ikke-parkerede managerhold får en ungdomsgruppe.
 * Pensionerede hold (retired_at) er ude af spillet og tæller heller ikke med.
 */
export function isEligibleManagerTeam(t) {
  return !!t
    && t.is_ai !== true
    && t.is_bank !== true
    && t.is_frozen !== true
    && t.is_test_account !== true
    && t.parked_at == null
    && t.retired_at == null;
}

/**
 * AI-hold: samme filter som A6-generatoren (generateYouthSquadsS4.js
 * loadActiveAiTeams), så gruppernes AI-hold er præcis dem der får en ungdomstrup.
 */
export function isEligibleAiTeam(t) {
  return !!t
    && t.is_ai === true
    && t.is_bank !== true
    && t.is_frozen !== true
    && t.is_test_account !== true
    && t.parked_at == null
    && t.retired_at == null
    && t.pending_removal_at == null;
}

/** Et hold kan stille til start når det har mindst MIN_RACE_ENTRIES ryttere i truppen. */
export function canStart(team) {
  return Number(team?.youthRiders) >= MIN_RACE_ENTRIES;
}

/** Antal grupper: så få som muligt, men ingen gruppe over groupSize. Mindst 1. */
export function youthGroupCount(totalTeams, groupSize = YOUTH_GROUP_SIZE) {
  if (!Number.isInteger(groupSize) || groupSize < 1) throw new Error(`youthGroupCount: ugyldig groupSize ${groupSize}`);
  return Math.max(1, Math.ceil(Math.max(0, Number(totalTeams) || 0) / groupSize));
}

const byId = (a, b) => String(a.id).localeCompare(String(b.id), "en");

/**
 * Seniorholdets Global Rank-rækkefølge, med hold UDEN synlig Global Rank
 * (ingen global_rank_mv-række eller global_rank NULL) SIDST.
 * rankTeamsByGlobalRank rangerer et hold uden række som 0 point, som kan
 * blande det ind blandt rigtige 0-point-hold; her lægges de eksplicit bagerst
 * (stabil opdeling, intern rækkefølge bevaret), og rank tælles op igen.
 */
export function rankManagersForYouth({ teams, globalRanks, countback } = {}) {
  const ranked = rankTeamsByGlobalRank({ teams: teams || [], globalRankRows: globalRanks || [], countback });
  const withRank = ranked.filter((r) => r.visibleGlobalRank != null);
  const withoutRank = ranked.filter((r) => r.visibleGlobalRank == null);
  return [...withRank, ...withoutRank].map((r, i) => ({ ...r, rank: i + 1 }));
}

function emptyGroup(squad, poolIndex) {
  return {
    squad,
    tier: YOUTH_GROUP_TIER,
    poolIndex,
    label: youthGroupLabel(squad, poolIndex),
    managerTeamIds: [],
    aiTeamIds: [],
    size: 0,
    starters: 0,
  };
}

function addToGroup(group, team, kind) {
  (kind === "ai" ? group.aiTeamIds : group.managerTeamIds).push(team.id);
  group.size += 1;
  if (canStart(team)) group.starters += 1;
}

/**
 * Fordel AI-hold i grupperne, op til groupSize pr. gruppe. Startklare AI-hold
 * (canStart) placeres FØRST og altid i gruppen med færrest startklare hold, så
 * ingen gruppe ender med et tyndt felt fordi AI-holdene klumpede sig; resten går
 * til gruppen med færrest hold. Tie → laveste pool_index. Deterministisk
 * (AI-holdene sorteres på id). Returnerer de AI-hold der ikke var plads til.
 */
function fillWithAi(groups, aiTeams, groupSize) {
  const sorted = [...aiTeams].sort(byId);
  const ready = sorted.filter(canStart);
  const rest = sorted.filter((t) => !canStart(t));
  const overflow = [];
  const place = (team, key) => {
    const open = groups.filter((g) => g.size < groupSize);
    if (!open.length) { overflow.push(team.id); return; }
    open.sort((a, b) => key(a, b) || (a.size - b.size) || (a.poolIndex - b.poolIndex));
    addToGroup(open[0], team, "ai");
  };
  for (const t of ready) place(t, (a, b) => a.starters - b.starters);
  for (const t of rest) place(t, () => 0);
  return overflow;
}

function summarizeGroups(groups) {
  const sizes = groups.map((g) => g.size);
  return {
    groupCount: groups.length,
    largestGroup: sizes.length ? Math.max(...sizes) : 0,
    smallestGroup: sizes.length ? Math.min(...sizes) : 0,
    groupsBelowMinStarters: groups.filter((g) => g.starters < MIN_RACE_ENTRIES).map((g) => g.poolIndex),
  };
}

/**
 * Plan for en trups ungdomsgrupper fra bunden (ingen grupper findes endnu).
 *
 * @param {object} p
 * @param {Array} p.teams  teams-rækker (alle eller kun managers; filtreres med
 *        isEligibleManagerTeam). Valgfrit felt youthRiders = antal ryttere i
 *        truppen (bruges kun til startklar-tællingen).
 * @param {Array} p.globalRanks  global_rank_mv-rækker ({ team_id, global_points, global_rank, ... }).
 * @param {Array} p.aiTeams  AI-hold (filtreres med isEligibleAiTeam).
 * @param {"u23"|"junior"} p.squad
 * @param {number} [p.groupSize=24]
 * @param {Map|Object} [p.countback]  valgfri #3036-countback til tiebreak (se pyramidCompression).
 * @returns {{ squad, groupSize, groups, managers, aiOverflow, excluded, summary }}
 */
export function planYouthGroups({ teams, globalRanks, aiTeams, squad, groupSize = YOUTH_GROUP_SIZE, countback } = {}) {
  assertYouthSquad(squad);
  const managers = (teams || []).filter(isEligibleManagerTeam);
  const ai = (aiTeams || []).filter(isEligibleAiTeam);
  const excluded = {
    managers: (teams || []).filter((t) => t && t.is_ai !== true && !isEligibleManagerTeam(t)).map((t) => t.id),
    ai: (aiTeams || []).filter((t) => t && !isEligibleAiTeam(t)).map((t) => t.id),
  };

  const count = youthGroupCount(managers.length + ai.length, groupSize);
  const groups = Array.from({ length: count }, (_, i) => emptyGroup(squad, i));

  const teamById = new Map(managers.map((t) => [t.id, t]));
  const ranked = rankManagersForYouth({ teams: managers, globalRanks, countback });
  const snaked = snakeAssign(ranked, groups);
  const managerPlan = [];
  for (const { item, pool } of snaked) {
    addToGroup(pool, teamById.get(item.teamId), "manager");
    managerPlan.push({
      teamId: item.teamId,
      rank: item.rank,
      globalPoints: item.globalPoints,
      missingGlobalRank: item.visibleGlobalRank == null,
      poolIndex: pool.poolIndex,
    });
  }

  const aiOverflow = fillWithAi(groups, ai, groupSize);

  return {
    squad,
    groupSize,
    groups,
    managers: managerPlan,
    aiOverflow,
    excluded,
    summary: {
      managers: managers.length,
      aiTeams: ai.length,
      ...summarizeGroups(groups),
    },
  };
}

/**
 * Gruppen en NY manager (eller et comeback) skal i: den med flest AI-hold
 * (så holdet overtager en AI-plads), tie → laveste pool_index. null hvis trup
 * ingen grupper har. Grupper kan give aiTeamIds (array) eller aiCount (tal).
 */
export function pickYouthGroupForNewTeam({ groups, squad } = {}) {
  assertYouthSquad(squad);
  const aiCount = (g) => (Array.isArray(g.aiTeamIds) ? g.aiTeamIds.length : Number(g.aiCount) || 0);
  const candidates = (groups || []).filter((g) => g && (g.squad == null || g.squad === squad));
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => (aiCount(b) - aiCount(a)) || (a.poolIndex - b.poolIndex))[0];
}

/**
 * Genkørsel når grupperne allerede findes (fx efter A6, eller når nye managers
 * er kommet til). Rører ALDRIG et hold der allerede har en gruppe:
 *   - nye managers (uden gruppe) placeres i rangorden via pickYouthGroupForNewTeam;
 *     er gruppen fuld, viger ét AI-hold (sidste på id) og placeres igen som AI.
 *   - AI-hold uden gruppe fylder op som i planYouthGroups (startklare først).
 *   - hold der har en gruppe men ikke længere er berettigede (parkeret o.l.)
 *     RAPPORTERES kun (stale); nulstillingen hører til parkerings-wiringen.
 *
 * @param {object} p
 * @param {Array<{poolIndex, managerTeamIds, aiTeamIds}>} p.groups  nuværende grupper
 * @param {Array} p.teams  managerhold (alle; filtreres)
 * @param {Array} p.aiTeams  AI-hold (alle; filtreres)
 * @param {Array} p.globalRanks
 * @param {"u23"|"junior"} p.squad
 * @param {number} [p.groupSize=24]
 * @returns {{ squad, groups, moves, displacedAi, managerOverflow, aiOverflow, stale, summary }}
 *   moves = [{ teamId, kind: 'manager'|'ai', poolIndex }] (kun NYE placeringer).
 */
export function planYouthTopUp({ groups, teams, aiTeams, globalRanks, squad, groupSize = YOUTH_GROUP_SIZE, countback } = {}) {
  assertYouthSquad(squad);
  const allTeams = [...(teams || []), ...(aiTeams || [])];
  const teamById = new Map(allTeams.filter(Boolean).map((t) => [t.id, t]));
  const eligible = (t) => (t?.is_ai === true ? isEligibleAiTeam(t) : isEligibleManagerTeam(t));

  const state = [...(groups || [])]
    .sort((a, b) => a.poolIndex - b.poolIndex)
    .map((g) => {
      const next = emptyGroup(squad, g.poolIndex);
      for (const id of g.managerTeamIds || []) addToGroup(next, teamById.get(id) || { id }, "manager");
      for (const id of g.aiTeamIds || []) addToGroup(next, teamById.get(id) || { id }, "ai");
      return next;
    });
  if (!state.length) throw new Error("planYouthTopUp: ingen grupper; brug planYouthGroups");

  const assigned = new Set(state.flatMap((g) => [...g.managerTeamIds, ...g.aiTeamIds]));
  const stale = [...assigned].filter((id) => !eligible(teamById.get(id)));

  const newManagers = (teams || []).filter((t) => isEligibleManagerTeam(t) && !assigned.has(t.id));
  const ranked = rankManagersForYouth({ teams: newManagers, globalRanks, countback });
  const moves = [];
  const displacedAi = [];
  const managerOverflow = [];

  for (const r of ranked) {
    const team = teamById.get(r.teamId);
    const open = state.filter((g) => g.size < groupSize || g.aiTeamIds.length > 0);
    const target = pickYouthGroupForNewTeam({ groups: open, squad });
    if (!target) { managerOverflow.push(team.id); continue; }
    if (target.size >= groupSize) {
      const outId = [...target.aiTeamIds].sort().pop();
      target.aiTeamIds = target.aiTeamIds.filter((id) => id !== outId);
      target.size -= 1;
      if (canStart(teamById.get(outId))) target.starters -= 1;
      displacedAi.push({ teamId: outId, fromPoolIndex: target.poolIndex });
    }
    addToGroup(target, team, "manager");
    moves.push({ teamId: team.id, kind: "manager", poolIndex: target.poolIndex });
  }

  const displacedIds = new Set(displacedAi.map((d) => d.teamId));
  const newAi = (aiTeams || []).filter((t) => isEligibleAiTeam(t) && (!assigned.has(t.id) || displacedIds.has(t.id)));
  const before = new Map(state.map((g) => [g.poolIndex, new Set(g.aiTeamIds)]));
  const aiOverflow = fillWithAi(state, newAi, groupSize);
  for (const g of state) {
    for (const id of g.aiTeamIds) if (!before.get(g.poolIndex).has(id)) moves.push({ teamId: id, kind: "ai", poolIndex: g.poolIndex });
  }

  return {
    squad,
    groupSize,
    groups: state,
    moves,
    displacedAi,
    managerOverflow,
    aiOverflow,
    stale,
    summary: {
      managers: state.reduce((n, g) => n + g.managerTeamIds.length, 0),
      aiTeams: state.reduce((n, g) => n + g.aiTeamIds.length, 0),
      ...summarizeGroups(state),
    },
  };
}
