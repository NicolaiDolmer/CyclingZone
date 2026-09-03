// backend/lib/engine/v4/ai/aiTactics.ts
// Race Engine v4 F3, M14 — adaptiv, forklarlig AI-holdtaktik (#2478, #4030).
// SSOT: docs/superpowers/specs/2026-08-20-race-engine-v4-intra-stage-design.md
// §8b beslutning 22 ("AI bruger PRAECIS samme ordre-API som spillere; harness-
// gate: mere trovaerdig, ikke staerkere") + T1-T4 i
// docs/superpowers/specs/2026-08-21-race-tactics-orders-v1-design.md.
//
// REN — ingen import fra oevrigt backend, ingen IO/Date/Math.random. Kun
// AbilityKey/FinaleType/ProfileType/RiderRole laeses fra types.ts (stabile,
// frosne unions) — TeamOrder-kontrakten selv importeres fra den lokale
// teamOrderContract.ts (se den fils kommentar for hvorfor).
//
// DESIGN-PRINCIP ("mere trovaerdig, ikke staerkere"): reglerne herunder
// vaelger den taktik en fornuftig sportsdirektoer ville have valgt ud fra
// ROLLE (allerede sat i lineuppet, ikke AI'ens beslutning) + EVNER + DAGENS
// TERRAEN — ALDRIG ud fra hvad der maksimerer AI-holdets vinderchance eller
// modstanderens svagheder. Ingen skjult tilstand, ingen rng: samme roster +
// samme rute giver ALTID samme ordre (determinisme = efterprøvelighed,
// samme krav som resten af v4).
//
// FORKLARLIGHED (opgave-krav): hver ordre — bade holdets breakaway_stance og
// hver rytters effort/try_break — faar en kort reason-streng. Reasons ligger
// i et SEPARAT returfelt (AiTacticsDecision.reasons), IKKE puttet ind i
// TeamOrder selv: det ville vaere netop den slags AI-only-sidekanal-felt
// taktik-specen forbyder (spillernes egne ordrer har ingen "hvorfor"-felt).

import type { AbilityKey, FinaleType, ProfileType, RiderRole } from "../types.ts";
import type { BreakawayStance, EffortLevel, TeamOrder, TeamOrderRider } from "./teamOrderContract.ts";
import { validateTeamOrder } from "./teamOrderContract.ts";

export type AiRosterEntrant = {
  rider_id: string;
  role: RiderRole;
  abilities: Record<AbilityKey, number>;
};

export type AiTacticsRoute = {
  profile_type: ProfileType;
  finale_type: FinaleType | null;
};

export type AiTacticsInput = {
  team_id: string;
  route: AiTacticsRoute;
  roster: AiRosterEntrant[];
};

export type AiTacticsReasons = {
  breakaway_stance: string;
  riders: Record<string, string>; // rider_id -> kort reason-streng
};

export type AiTacticsDecision = {
  order: TeamOrder;
  reasons: AiTacticsReasons;
};

type TerrainDemand = "climb" | "punch" | "sprint" | "cobbles" | "time_trial" | "rolling";

const PRIMARY_ABILITY_BY_DEMAND: Record<TerrainDemand, AbilityKey> = {
  climb: "climbing",
  punch: "punch",
  sprint: "sprint",
  cobbles: "cobblestone",
  time_trial: "time_trial",
  rolling: "tempo",
};

const TERRAIN_DEMAND_LABEL: Record<TerrainDemand, string> = {
  climb: "bjergetapen",
  punch: "punch-finalen",
  sprint: "den flade spurtetape",
  cobbles: "brostens-etapen",
  time_trial: "enkeltstarten",
  rolling: "den kuperede etape",
};

// 0-99-skala (abilityRegistry). Startkandidat-graenser, kalibreres i head-
// to-head-harnesset naar M14 kobles paa (f2-core-design.md §7-moenstret).
// Egne konstanter frem for tuning.ts: dette modul roerer aldrig
// tuning.ts/EngineTuning (delt/arkitekt-ejet fil paa tvaers af F3-workers).
export const AI_TACTICS_TUNING = Object.freeze({
  STRONG_LEADER_ABILITY: 70,
  WEAK_LEADER_ABILITY: 55,
  BREAK_CANDIDATE_SCORE: 60,
  AGGRESSIVE_NEUTRAL_THRESHOLD: 65,
  MAX_BREAK_CANDIDATES: 2,
});

/** Klassificerer dagens terraen-krav ud fra rute-typen (samme felter som RouteV2). */
export function classifyTerrainDemand(route: AiTacticsRoute): TerrainDemand {
  if (route.finale_type === "punch") return "punch";
  if (route.profile_type === "mountain" || route.profile_type === "high_mountain" || route.finale_type === "long_climb") {
    return "climb";
  }
  // #4105: grus laeses som brosten af AI-taktikken — samme primaere evne (cobblestone),
  // samme ledertype. Det ER pointen med "naesten samme type der er god til den slags loeb".
  if (route.profile_type === "cobbles" || route.profile_type === "gravel") return "cobbles";
  if (route.profile_type === "itt" || route.profile_type === "itt_hilly" || route.profile_type === "ttt") return "time_trial";
  if (route.finale_type === "bunch_sprint" || route.profile_type === "flat") return "sprint";
  return "rolling";
}

function leaderRoleForDemand(demand: TerrainDemand): RiderRole {
  return demand === "sprint" ? "sprint_captain" : "captain";
}

function clampAbility(v: number): number {
  return Math.max(0, Math.min(99, Number(v) || 0));
}

function abilityOf(entrant: AiRosterEntrant, key: AbilityKey): number {
  return clampAbility(entrant.abilities[key]);
}

function leaderRoleLabel(role: RiderRole): string {
  return role === "sprint_captain" ? "sprint-kaptajnens" : "kaptajnens";
}

function roleLabel(role: RiderRole): string {
  switch (role) {
    case "hunter":
      return "hunter";
    case "free_role":
      return "fri rolle";
    case "captain":
      return "kaptajn";
    case "sprint_captain":
      return "sprint-kaptajn";
    case "helper":
      return "hjaelper";
    default:
      return role;
  }
}

type BreakScoreEntry = { riderId: string; score: number };

/** Udbrudskandidat-score: aggression + terraen-relevant evne, ligevaegtet (0-99). */
function breakScore(entrant: AiRosterEntrant, primaryAbility: AbilityKey): number {
  return Math.round((abilityOf(entrant, "aggression") + abilityOf(entrant, primaryAbility)) / 2);
}

/** Deterministisk sortering: score faldende, rider_id som taerskel (ingen rng). */
function sortByScoreDesc(items: BreakScoreEntry[]): BreakScoreEntry[] {
  return [...items].sort((a, b) => b.score - a.score || a.riderId.localeCompare(b.riderId));
}

/**
 * M14: genererer ét holds TeamOrder for én etape, plus en forklaring pr.
 * ordre. Ren funktion — deterministisk i (team_id, route, roster).
 *
 * Beslutningsgang (T1-T4-bevidst, mor-spec §4 M5/M14):
 * 1. Find holdets terraen-relevante kaptajn (captain for alt undtagen rene
 *    spurtetaper, sprint_captain for dem — samme rollemodel som lineuppet).
 * 2. Staerk kaptajn til dagens terraen -> "chase" + kaptajnen beskyttes
 *    (eksempel fra opgaven: "beskyt kaptajnen paa bjergetaper").
 * 3. Svag/manglende kaptajn -> "let_go" + op til to hunter/free_role-ryttere
 *    med hoej aggression+terraen-evne forsoeger udbrud (eksempel: "udbruds-
 *    forsoeg fra svage hold") — bounded via try_break (oeger sandsynlighed,
 *    garanterer aldrig, T3).
 * 4. Midt-imellem -> "neutral" (T4-defaultens aand: intet klart signal).
 * 5. Den ANDEN kaptajn-rolle (fx sprint_captain paa en bjergetape) spares —
 *    ikke dagens etape, kraefter gemmes.
 */
export function generateAiTeamOrder(input: AiTacticsInput): AiTacticsDecision {
  const demand = classifyTerrainDemand(input.route);
  const primaryAbility = PRIMARY_ABILITY_BY_DEMAND[demand];
  const terrainLabel = TERRAIN_DEMAND_LABEL[demand];
  const leaderRole = leaderRoleForDemand(demand);
  const otherCaptainRole: RiderRole = leaderRole === "captain" ? "sprint_captain" : "captain";

  const leader = input.roster.find((r) => r.role === leaderRole) ?? null;
  const leaderAbility = leader ? abilityOf(leader, primaryAbility) : 0;

  let stance: BreakawayStance;
  let stanceReason: string;

  if (leader !== null && leaderAbility >= AI_TACTICS_TUNING.STRONG_LEADER_ABILITY) {
    stance = "chase";
    stanceReason = `Staerk ${leaderRoleLabel(leaderRole)} ${primaryAbility}-vaerdi (${leaderAbility}) til ${terrainLabel} — jager udbrud ned for at holde loebet aabent.`;
  } else if (leader === null || leaderAbility < AI_TACTICS_TUNING.WEAK_LEADER_ABILITY) {
    stance = "let_go";
    stanceReason = leader
      ? `${leaderRoleLabel(leaderRole)} ${primaryAbility}-vaerdi (${leaderAbility}) er under holdets taerskel til ${terrainLabel} — intet at forsvare, sparer kraefter.`
      : `Ingen ${leaderRole === "sprint_captain" ? "sprint-kaptajn" : "kaptajn"} paa holdlisten til ${terrainLabel} — intet at forsvare, sparer kraefter.`;
  } else {
    stance = "neutral";
    stanceReason = `${leaderRoleLabel(leaderRole)} ${primaryAbility}-vaerdi (${leaderAbility}) er middel til ${terrainLabel} — hverken tydelig fordel ved at jage eller ved at spare.`;
  }

  // Break-kandidater kun relevante naar holdet ikke selv kontrollerer loebet
  // (chase ville modarbejde egen ordre — splittet indsats).
  const breakSlots = stance === "chase" ? 0 : AI_TACTICS_TUNING.MAX_BREAK_CANDIDATES;
  const breakThreshold =
    stance === "neutral" ? AI_TACTICS_TUNING.AGGRESSIVE_NEUTRAL_THRESHOLD : AI_TACTICS_TUNING.BREAK_CANDIDATE_SCORE;

  const breakCandidates: BreakScoreEntry[] =
    breakSlots > 0
      ? sortByScoreDesc(
          input.roster
            .filter((r) => r.role === "hunter" || r.role === "free_role")
            .map((r) => ({ riderId: r.rider_id, score: breakScore(r, primaryAbility) }))
            .filter((c) => c.score >= breakThreshold),
        ).slice(0, breakSlots)
      : [];
  const breakScoreById = new Map(breakCandidates.map((c) => [c.riderId, c.score]));

  const riders: TeamOrderRider[] = [];
  const riderReasons: Record<string, string> = {};

  for (const entrant of input.roster) {
    const isLeader = leader !== null && entrant.rider_id === leader.rider_id;
    const isOtherCaptain = entrant.role === otherCaptainRole;

    let effort: EffortLevel;
    let reason: string;

    if (isLeader) {
      if (stance === "chase") {
        effort = "protect";
        reason = `Beskyttes: holdets ${terrainLabel.replace(/^den |^det /, "")}-kaptajn mens holdet jager (${primaryAbility}=${leaderAbility}).`;
      } else if (stance === "let_go") {
        effort = "save";
        reason = `Spares: ${terrainLabel} er ikke kaptajnens staerke side (${primaryAbility}=${leaderAbility}), og holdet jager ikke i dag.`;
      } else {
        effort = "normal";
        reason = `Normal indsats: kaptajnens ${primaryAbility}-vaerdi (${leaderAbility}) er middel til ${terrainLabel}.`;
      }
    } else if (isOtherCaptain) {
      effort = "save";
      reason = `Spares: ${terrainLabel} er ikke denne kaptajn-rolles speciale — kraefter gemmes til en etape der passer bedre.`;
    } else {
      effort = "normal";
      reason = leader
        ? `Normal indsats: arbejder for holdets plan paa ${terrainLabel}.`
        : `Normal indsats: intet klart kaptajn-fokus paa ${terrainLabel} i dag.`;
    }

    const tryBreak = breakScoreById.has(entrant.rider_id);
    if (tryBreak) {
      reason += ` Udbrudsforsoeg: ${roleLabel(entrant.role)} med hoej aggression+${primaryAbility}-score (${breakScoreById.get(entrant.rider_id)}) mens holdet ikke selv jager.`;
    }

    riders.push({ rider_id: entrant.rider_id, effort, try_break: tryBreak });
    riderReasons[entrant.rider_id] = reason;
  }

  const order: TeamOrder = { team_id: input.team_id, breakaway_stance: stance, riders };

  const validation = validateTeamOrder(order);
  if (!validation.ok) {
    // Skal ALDRIG kunne indtraeffe (kontrakten bygges korrekt herover) — men
    // fail-loud fremfor at lade en AI-ordre afvige fra spiller-kontrakten.
    throw new Error(`AI-taktik genererede en ugyldig TeamOrder: ${validation.errors.join("; ")}`);
  }

  return { order, reasons: { breakaway_stance: stanceReason, riders: riderReasons } };
}
