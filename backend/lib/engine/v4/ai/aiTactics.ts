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
//
// #5571 (lag 1 i "Holdmoedet", ejer 23/9) — AI-holdene i PROD:
//  * Kaptajnens styrke vurderes MOD STARTLISTEN (plads i feltet paa dagens
//    terraen), ikke mod en absolut evne-graense. Evne-skalaen i prod ligger
//    langt under fixtures'enes, saa de absolutte graenser gjorde naesten
//    hvert AI-hold til "svagt" (lader alt gaa, sparer kaptajnen). En
//    sportsdirektoer vurderer sin kaptajn mod de andre paa startlisten —
//    det er ogsaa det der goer beslutningen skala-invariant.
//  * Indsatstrappen bruges som et rigtigt hold ville (ejerens tre eksempler):
//    sprintere paa `grupetto` i bjergene i etapeloeb, hjaelpere paa
//    `protect` ("Arbejd eller angrib") ved en kaptajn holdet koerer for, og
//    kaptajnen paa `all_out` paa den afgoerende dag. Aldrig et frikort: hvert
//    trin betaler sin egen pris i motoren (M12/M16), praecis som for spillere.
//  * `leadout` (M6, sprint-toget) saettes som rollens standard, saa et AI-hold
//    ikke mister sit tog ved at M14 overtager standardordren.

import type { AbilityKey, FinaleType, ProfileType, RiderRole } from "../types.ts";
import type { BreakawayStance, EffortLevel, TeamOrder, TeamOrderRider } from "./teamOrderContract.ts";
import { validateTeamOrder } from "./teamOrderContract.ts";

export type AiRosterEntrant = {
  rider_id: string;
  role: RiderRole;
  abilities: Record<AbilityKey, number>;
};

/** Én rytter paa dagens startliste (alle hold), til at placere kaptajnen i feltet. */
export type AiFieldRider = {
  rider_id: string;
  abilities: Record<AbilityKey, number>;
};

export type AiTacticsRoute = {
  profile_type: ProfileType;
  finale_type: FinaleType | null;
};

/**
 * Loebet omkring dagens etape. VALGFRI: uden den kender AI'en ikke loebet og
 * bruger hverken `grupetto` eller `all_out` (ingen "afgoerende dag" at se).
 */
export type AiRaceContext = {
  /** Etapeloeb (grupettoen og "gem benene til i morgen" findes kun her). */
  is_stage_race: boolean;
  /** Loebets etaper EFTER i dag, i koerselsorden. Tom = i dag er sidste dag. */
  later_stages: readonly AiTacticsRoute[];
};

export type AiTacticsInput = {
  team_id: string;
  route: AiTacticsRoute;
  roster: AiRosterEntrant[];
  /**
   * Hele dagens startliste (inkl. holdets egne ryttere). Udelades den, er
   * holdets egen trup hele "feltet" (kun til isolerede enhedstests).
   */
  field?: readonly AiFieldRider[];
  race?: AiRaceContext;
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

// Plads-graenser i FELTET (1 = feltets bedste paa dagens terraen), ikke evne-
// graenser: #5571 fandt at prod-skalaen goer absolutte graenser meningsloese
// (se filens hoved). Egne konstanter frem for tuning.ts: dette modul roerer
// aldrig tuning.ts/EngineTuning (delt/arkitekt-ejet fil paa tvaers af F3-workers).
export const AI_TACTICS_TUNING = Object.freeze({
  /** Kaptajnen er blandt feltets favoritter til terraenet -> holdet jager. */
  CONTENDER_FIELD_RANK: 8,
  /** Kaptajnen er uden for denne plads -> intet at forsvare, holdet lader gaa. */
  OUTSIDER_FIELD_RANK: 25,
  /** En fri rytter proever udbruddet naar hans udbruds-score er i feltets top-andel. */
  BREAK_CANDIDATE_FIELD_SHARE: 0.2,
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
function breakScore(abilities: Record<AbilityKey, number>, primaryAbility: AbilityKey): number {
  return Math.round((clampAbility(abilities.aggression) + clampAbility(abilities[primaryAbility])) / 2);
}

/** Deterministisk sortering: score faldende, rider_id som taerskel (ingen rng). */
function sortByScoreDesc(items: BreakScoreEntry[]): BreakScoreEntry[] {
  return [...items].sort((a, b) => b.score - a.score || a.riderId.localeCompare(b.riderId));
}

/**
 * Plads i feltet (1 = bedst) for en vaerdi blandt feltets vaerdier:
 * 1 + antallet af ryttere der er STRENGT bedre. Lighed deler plads, saa
 * rytter-raekkefoelgen i startlisten aldrig kan flytte en beslutning.
 */
function fieldRank(value: number, fieldValues: readonly number[]): number {
  let better = 0;
  for (const v of fieldValues) if (v > value) better += 1;
  return better + 1;
}

/**
 * "Den afgoerende dag" for dagens kaptajn: loebet er kendt, og der kommer
 * ingen senere etape af samme terraen-type. Et endagsloeb er altid den
 * afgoerende dag; i et etapeloeb er det den sidste bjergetape for klatreren,
 * den sidste spurtetape for sprinteren, den sidste enkeltstart for
 * tempo-rytteren. Ren funktion af rute-typerne, ingen skjult tilstand.
 */
function isDecisiveDay(demand: TerrainDemand, race: AiRaceContext | undefined): boolean {
  if (!race) return false;
  return !race.later_stages.some((later) => classifyTerrainDemand(later) === demand);
}

/**
 * Tog-rytter der ikke hoerer til i bjergene: en hjaelper paa et hold med en
 * sprint-kaptajn, som selv er bedre til at spurte end til at klatre (sammen-
 * ligning af rytterens egne to evner, altsaa skala-uafhaengig).
 */
function isSprintTrainRider(entrant: AiRosterEntrant, teamHasSprintCaptain: boolean): boolean {
  return (
    teamHasSprintCaptain &&
    entrant.role === "helper" &&
    abilityOf(entrant, "sprint") > abilityOf(entrant, "climbing")
  );
}

/**
 * M14: genererer ét holds TeamOrder for én etape, plus en forklaring pr.
 * ordre. Ren funktion — deterministisk i (team_id, route, roster, field, race).
 *
 * Beslutningsgang (T1-T4-bevidst, mor-spec §4 M5/M14, #5571):
 * 1. Find holdets terraen-relevante kaptajn (captain for alt undtagen rene
 *    spurtetaper, sprint_captain for dem — samme rollemodel som lineuppet)
 *    og hans plads i FELTET paa dagens primaere evne.
 * 2. Kaptajn blandt feltets favoritter -> "chase": kaptajnen beskyttes
 *    (`protect`), hjaelperne arbejder ved ham (`protect`, "Arbejd eller
 *    angrib"), og paa den afgoerende dag gaar kaptajnen `all_out`.
 * 3. Kaptajn uden for feltets top eller ingen kaptajn -> "let_go": kaptajnen
 *    spares, og op til to hunter/free_role-ryttere forsoeger udbrud (bounded
 *    via try_break — oeger sandsynlighed, garanterer aldrig, T3).
 * 4. Midt-imellem -> "neutral" (T4-defaultens aand); kun hunter-rollen
 *    forsoeger udbruddet, som rollens standard siger.
 * 5. Den ANDEN kaptajn-rolle spares. I et etapeloeb paa en bjergetape koerer
 *    sprint-kaptajnen og hans tog-ryttere `grupetto`: i maal inden for
 *    tidsgraensen, benene gemt til spurtetaperne.
 */
export function generateAiTeamOrder(input: AiTacticsInput): AiTacticsDecision {
  const demand = classifyTerrainDemand(input.route);
  const primaryAbility = PRIMARY_ABILITY_BY_DEMAND[demand];
  const terrainLabel = TERRAIN_DEMAND_LABEL[demand];
  const leaderRole = leaderRoleForDemand(demand);
  const otherCaptainRole: RiderRole = leaderRole === "captain" ? "sprint_captain" : "captain";
  const teamHasSprintCaptain = input.roster.some((r) => r.role === "sprint_captain");
  const climbDayInStageRace = demand === "climb" && input.race?.is_stage_race === true;

  const field: readonly AiFieldRider[] = input.field && input.field.length > 0 ? input.field : input.roster;
  const fieldPrimary = field.map((r) => clampAbility(r.abilities[primaryAbility]));

  const leader = input.roster.find((r) => r.role === leaderRole) ?? null;
  const leaderAbility = leader ? abilityOf(leader, primaryAbility) : 0;
  const leaderRank = leader ? fieldRank(leaderAbility, fieldPrimary) : Number.POSITIVE_INFINITY;

  let stance: BreakawayStance;
  let stanceReason: string;

  if (leader !== null && leaderRank <= AI_TACTICS_TUNING.CONTENDER_FIELD_RANK) {
    stance = "chase";
    stanceReason = `${capitalize(leaderRoleLabel(leaderRole))} ${primaryAbility} er nr. ${leaderRank} i feltet til ${terrainLabel} — holdet jager udbrud ned for at holde loebet aabent.`;
  } else if (leader === null || leaderRank > AI_TACTICS_TUNING.OUTSIDER_FIELD_RANK) {
    stance = "let_go";
    stanceReason = leader
      ? `${capitalize(leaderRoleLabel(leaderRole))} ${primaryAbility} er nr. ${leaderRank} i feltet til ${terrainLabel} — intet at forsvare, sparer kraefter.`
      : `Ingen ${leaderRole === "sprint_captain" ? "sprint-kaptajn" : "kaptajn"} paa holdlisten til ${terrainLabel} — intet at forsvare, sparer kraefter.`;
  } else {
    stance = "neutral";
    stanceReason = `${capitalize(leaderRoleLabel(leaderRole))} ${primaryAbility} er nr. ${leaderRank} i feltet til ${terrainLabel} — hverken tydelig fordel ved at jage eller ved at spare.`;
  }

  const decisiveDay = stance === "chase" && isDecisiveDay(demand, input.race);

  // Grupetto-ryttere (sprintere i bjergene i et etapeloeb) er ude af udbruddet
  // i motoren (M12) — de faar heller aldrig et try_break, saa ordren ikke
  // modsiger sig selv.
  const grupettoIds = new Set<string>();
  if (climbDayInStageRace) {
    for (const entrant of input.roster) {
      if (entrant.role === "sprint_captain" || isSprintTrainRider(entrant, teamHasSprintCaptain)) {
        grupettoIds.add(entrant.rider_id);
      }
    }
  }

  // Break-kandidater kun naar holdet ikke selv kontrollerer loebet (chase
  // ville modarbejde egen ordre — splittet indsats). Hunter-rollen proever
  // udbruddet som rollens standard; en fri rytter kun paa en let_go-dag og kun
  // naar hans udbruds-score er i feltets top-andel.
  let breakCandidates: BreakScoreEntry[] = [];
  if (stance !== "chase") {
    const fieldBreakScores = field.map((r) => breakScore(r.abilities, primaryAbility));
    const freeRoleRankCap = Math.max(1, Math.ceil(field.length * AI_TACTICS_TUNING.BREAK_CANDIDATE_FIELD_SHARE));
    breakCandidates = sortByScoreDesc(
      input.roster
        .filter((r) => !grupettoIds.has(r.rider_id))
        .filter((r) => r.role === "hunter" || (stance === "let_go" && r.role === "free_role"))
        .map((r) => ({ riderId: r.rider_id, role: r.role, score: breakScore(r.abilities, primaryAbility) }))
        .filter((c) => c.role === "hunter" || fieldRank(c.score, fieldBreakScores) <= freeRoleRankCap)
        .map(({ riderId, score }) => ({ riderId, score })),
    ).slice(0, AI_TACTICS_TUNING.MAX_BREAK_CANDIDATES);
  }
  const breakScoreById = new Map(breakCandidates.map((c) => [c.riderId, c.score]));

  const riders: TeamOrderRider[] = [];
  const riderReasons: Record<string, string> = {};
  const leaderNoun = leaderRole === "sprint_captain" ? "sprint-kaptajnen" : "kaptajnen";

  for (const entrant of input.roster) {
    const isLeader = leader !== null && entrant.rider_id === leader.rider_id;
    const isOtherCaptain = entrant.role === otherCaptainRole;

    let effort: EffortLevel;
    let reason: string;

    if (grupettoIds.has(entrant.rider_id)) {
      effort = "grupetto";
      reason =
        entrant.role === "sprint_captain"
          ? `Grupetto: ${terrainLabel} i et etapeloeb er ikke en sprinters dag — i maal inden for tidsgraensen, benene gemmes til spurtetaperne.`
          : `Grupetto: tog-rytter for sprint-kaptajnen; ${terrainLabel} er ikke hans dag, benene gemmes til spurtetaperne.`;
    } else if (isLeader) {
      if (stance === "chase" && decisiveDay) {
        effort = "all_out";
        reason = input.race?.is_stage_race
          ? `Alt ud: loebets sidste etape af denne type, og ${leaderNoun} er nr. ${leaderRank} i feltet (${primaryAbility}).`
          : `Alt ud: endagsloeb, og ${leaderNoun} er nr. ${leaderRank} i feltet (${primaryAbility}).`;
      } else if (stance === "chase") {
        effort = "protect";
        reason = `Beskyttes: holdets ${terrainLabel.replace(/^den |^det /, "")}-kaptajn mens holdet jager (nr. ${leaderRank} i feltet, ${primaryAbility}).`;
      } else if (stance === "let_go") {
        effort = "save";
        reason = `Spares: ${terrainLabel} er ikke kaptajnens staerke side (nr. ${leaderRank} i feltet, ${primaryAbility}), og holdet jager ikke i dag.`;
      } else {
        effort = "normal";
        reason = `Normal indsats: kaptajnen er middel til ${terrainLabel} (nr. ${leaderRank} i feltet, ${primaryAbility}).`;
      }
    } else if (isOtherCaptain) {
      effort = "save";
      reason = `Spares: ${terrainLabel} er ikke denne kaptajn-rolles speciale — kraefter gemmes til en etape der passer bedre.`;
    } else if (entrant.role === "helper" && stance === "chase") {
      effort = "protect";
      reason = `Arbejd eller angrib: arbejder ved ${leaderNoun}, som holdet koerer for paa ${terrainLabel}.`;
    } else {
      effort = "normal";
      reason = leader
        ? `Normal indsats: arbejder for holdets plan paa ${terrainLabel}.`
        : `Normal indsats: intet klart kaptajn-fokus paa ${terrainLabel} i dag.`;
    }

    const tryBreak = breakScoreById.has(entrant.rider_id);
    if (tryBreak) {
      reason += ` Udbrudsforsoeg: ${roleLabel(entrant.role)} med udbruds-score ${breakScoreById.get(entrant.rider_id)} (aggression+${primaryAbility}) mens holdet ikke selv jager.`;
    }

    // M6: rollens standard (hjaelperen koerer i sprint-kaptajnens tog), men en
    // grupetto-rytter er ikke med i nogen finale.
    const leadout = entrant.role === "helper" && teamHasSprintCaptain && effort !== "grupetto";

    riders.push({ rider_id: entrant.rider_id, effort, try_break: tryBreak, leadout });
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

function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}
