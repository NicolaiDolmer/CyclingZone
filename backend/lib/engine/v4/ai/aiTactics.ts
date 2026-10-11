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
//  * #6055 (2/10): kaptajnen selv koerer `normal` paa jagt-dage, ogsaa den
//    afgoerende. Replayet af prod-etaperne viste at `all_out` og `protect`
//    koster ham mere reserve end finalen giver tilbage; han ankom tom til
//    netop den finale holdet satsede paa. Om `all_out` skal kunne betale sig
//    for en kaptajn er et prisvalg (det gaelder ogsaa spillere), ikke AI'ens.
//  * `leadout` (M6, sprint-toget) saettes som rollens standard, saa et AI-hold
//    ikke mister sit tog ved at M14 overtager standardordren.

import type { AbilityKey, FinaleType, ProfileType, RiderRole } from "../types.ts";
import type { BreakawayStance, EffortLevel, TeamOrder, TeamOrderRider } from "./teamOrderContract.ts";
import { validateTeamOrder } from "./teamOrderContract.ts";
import { isOrdersGcV2OrLater, isOrdersGcV3OrLater, sharedTimeModelGeneration } from "../../../raceEngineRulesRevision.ts";

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
  /**
   * #6097 (VALGFRIT): loebets bundne regel-revision. Kun "orders_gc_v2" aendrer
   * noget (udbrudsforsoeg fra hjaelpere, se generateAiTeamOrder punkt 6);
   * udeladt eller enhver anden vaerdi giver praecis samme ordre som foer.
   */
  rules_revision?: string;
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
  /**
   * #6097 (KUN orders_gc_v2): en hjaelper/fri rytter er en passende
   * udbrudskandidat naar hans udbruds-score er i denne top-andel af feltet.
   */
  V2_BREAK_CANDIDATE_FIELD_SHARE: 0.5,
  /** #6097 (KUN orders_gc_v2): et let_go-holds egne udbrudsforsoeg (hunters taeller med). */
  V2_LET_GO_BREAK_CANDIDATES: 1,
  /** #6201 R2a (KUN official_times_v3): et holds forsoeg i alt paa kuperet/rullende og bjerg. */
  V3_MAX_BREAK_CANDIDATES: 3,
  /** #6201 R2a (KUN official_times_v3): passende klatrere et hold sender paa en bjergetape. */
  V3_CLIMBERS_ON_CLIMB_DAY: 2,
  /** #6201 R2a (KUN official_times_v3): angribere et hold sender paa kuperet/rullende. */
  V3_ATTACKERS_ON_HILLY_DAY: 1,
});

/**
 * #6201 R2a (KUN official_times_v3): holdets ekstra udbrudskandidater paa
 * kuperet/rullende (en angriber) og bjerg (passende klatrere), oveni de
 * eksisterende. Ren og deterministisk; aendrer intet paa andre dage.
 */
function v3ExtraBreakCandidates(args: {
  input: AiTacticsInput;
  demand: TerrainDemand;
  primaryAbility: AbilityKey;
  field: readonly AiFieldRider[];
  fieldPrimary: readonly number[];
  grupettoIds: ReadonlySet<string>;
  breakCandidates: BreakScoreEntry[];
}): BreakScoreEntry[] {
  const { input, demand, primaryAbility, field, fieldPrimary, grupettoIds } = args;
  const profile = input.route.profile_type;
  const climbDay = demand === "climb";
  const hillyDay = !climbDay && (profile === "hilly" || profile === "rolling");
  if (!climbDay && !hillyDay) return args.breakCandidates;
  const rankCap = Math.max(1, Math.ceil(field.length * AI_TACTICS_TUNING.V2_BREAK_CANDIDATE_FIELD_SHARE));
  // Paa kuperet/rullende er angriberens evne dagens terraenevne (tempo paa en spurtdag).
  const attackKey: AbilityKey = demand === "sprint" ? "tempo" : primaryAbility;
  const scoreOf = (r: AiRosterEntrant) => (climbDay ? abilityOf(r, "climbing") : breakScore(r.abilities, attackKey));
  const fieldScores = climbDay ? fieldPrimary : field.map((r) => breakScore(r.abilities, attackKey));
  const suitable = (r: AiRosterEntrant) => fieldRank(scoreOf(r), fieldScores) <= rankCap;
  const want = climbDay ? AI_TACTICS_TUNING.V3_CLIMBERS_ON_CLIMB_DAY : AI_TACTICS_TUNING.V3_ATTACKERS_ON_HILLY_DAY;
  let out = [...args.breakCandidates];
  const byId = new Map(input.roster.map((r) => [r.rider_id, r]));
  let have = out.filter((c) => { const r = byId.get(c.riderId); return r !== undefined && suitable(r); }).length;
  const taken = new Set(out.map((c) => c.riderId));
  const pool = input.roster
    .filter((r) => !grupettoIds.has(r.rider_id) && !taken.has(r.rider_id))
    .filter((r) => r.role === "hunter" || r.role === "free_role" || r.role === "helper")
    .filter(suitable)
    .sort((a, b) => scoreOf(b) - scoreOf(a) || a.rider_id.localeCompare(b.rider_id));
  for (const r of pool) {
    if (have >= want || out.length >= AI_TACTICS_TUNING.V3_MAX_BREAK_CANDIDATES) break;
    out = [...out, { riderId: r.rider_id, score: breakScore(r.abilities, primaryAbility) }];
    have += 1;
  }
  return out;
}

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

export type AiStanceDecision = {
  stance: BreakawayStance;
  reason: string;
  /** Dagens terraen-relevante kaptajn (null = holdet har ingen). */
  leader: AiRosterEntrant | null;
  /** Kaptajnens plads i feltet paa dagens primaere evne (Infinity uden kaptajn). */
  leaderRank: number;
};

/**
 * M14's holdstance for én etape (punkt 1-4 i generateAiTeamOrder): kaptajnen
 * blandt feltets favoritter -> chase, uden for feltets top eller ingen
 * kaptajn -> let_go, ellers neutral. Ren og deterministisk.
 *
 * #6441 (ejer 10/10 kl. 22:40): under official_times_v3 er dette ogsaa
 * standard-stancen for et menneskehold uden egen udbrudsordre for etapen
 * (orders/teamOrdersAdapter.ts). Én regel, ingen kopi.
 */
export function decideAiBreakawayStance(input: Pick<AiTacticsInput, "route" | "roster" | "field">): AiStanceDecision {
  const demand = classifyTerrainDemand(input.route);
  const primaryAbility = PRIMARY_ABILITY_BY_DEMAND[demand];
  const terrainLabel = TERRAIN_DEMAND_LABEL[demand];
  const leaderRole = leaderRoleForDemand(demand);
  const field: readonly AiFieldRider[] = input.field && input.field.length > 0 ? input.field : input.roster;
  const fieldPrimary = field.map((r) => clampAbility(r.abilities[primaryAbility]));

  const leader = input.roster.find((r) => r.role === leaderRole) ?? null;
  const leaderAbility = leader ? abilityOf(leader, primaryAbility) : 0;
  const leaderRank = leader ? fieldRank(leaderAbility, fieldPrimary) : Number.POSITIVE_INFINITY;

  if (leader !== null && leaderRank <= AI_TACTICS_TUNING.CONTENDER_FIELD_RANK) {
    return {
      stance: "chase",
      reason: `${capitalize(leaderRoleLabel(leaderRole))} ${primaryAbility} er nr. ${leaderRank} i feltet til ${terrainLabel} — holdet jager udbrud ned for at holde loebet aabent.`,
      leader,
      leaderRank,
    };
  }
  if (leader === null || leaderRank > AI_TACTICS_TUNING.OUTSIDER_FIELD_RANK) {
    return {
      stance: "let_go",
      reason: leader
        ? `${capitalize(leaderRoleLabel(leaderRole))} ${primaryAbility} er nr. ${leaderRank} i feltet til ${terrainLabel} — intet at forsvare, sparer kraefter.`
        : `Ingen ${leaderRole === "sprint_captain" ? "sprint-kaptajn" : "kaptajn"} paa holdlisten til ${terrainLabel} — intet at forsvare, sparer kraefter.`,
      leader,
      leaderRank,
    };
  }
  return {
    stance: "neutral",
    reason: `${capitalize(leaderRoleLabel(leaderRole))} ${primaryAbility} er nr. ${leaderRank} i feltet til ${terrainLabel} — hverken tydelig fordel ved at jage eller ved at spare.`,
    leader,
    leaderRank,
  };
}

/**
 * M14: genererer ét holds TeamOrder for én etape, plus en forklaring pr.
 * ordre. Ren funktion — deterministisk i (team_id, route, roster, field, race).
 *
 * Beslutningsgang (T1-T4-bevidst, mor-spec §4 M5/M14, #5571):
 * 1. Find holdets terraen-relevante kaptajn (captain for alt undtagen rene
 *    spurtetaper, sprint_captain for dem — samme rollemodel som lineuppet)
 *    og hans plads i FELTET paa dagens primaere evne.
 * 2. Kaptajn blandt feltets favoritter -> "chase": hjaelperne arbejder ved
 *    ham (`protect`, "Arbejd eller angrib"), og kaptajnen selv koerer
 *    `normal` og gemmer reserven til finalen, ogsaa paa den afgoerende dag
 *    (#6055: `protect`/`all_out` braendte hans reserve af foer finalen).
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

  const { stance, reason: stanceReason, leader, leaderRank } = decideAiBreakawayStance(input);

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
    // #6097 (KUN orders_gc_v2): AI-holdenes trupper har sjaeldent hunters/frie
    // roller, saa ovenstaaende gav naesten aldrig et forsoeg, og morgenudbruddet
    // blev for lille (ofte intet). Under v2 vaelger et hold der lader udbruddet
    // gaa (let_go) derfor selv sin bedste passende rytter: hunter, fri rolle
    // ELLER hjaelper, aldrig kaptajn/sprint-kaptajn, aldrig grupetto, og kun en
    // rytter hvis udbruds-score (aggression + dagens terraenevne) er i feltets
    // passende top-andel. Holdets hunters forsoeger stadig som rollens standard
    // (hoejst MAX_BREAK_CANDIDATES i alt). Neutrale hold og jagt-hold sender
    // ingen ekstra. Et forsoeg er aldrig en garanti: motoren afgoer stadig
    // hvem der kommer afsted (mechanics/breakawayPermission.ts).
    if (isOrdersGcV2OrLater(input.rules_revision)) { // #6187: v3 arver v2
      const v2RankCap = Math.max(1, Math.ceil(field.length * AI_TACTICS_TUNING.V2_BREAK_CANDIDATE_FIELD_SHARE));
      const eligible = input.roster
        .filter((r) => !grupettoIds.has(r.rider_id))
        .filter((r) => r.role === "hunter" || r.role === "free_role" || r.role === "helper")
        .map((r) => ({ riderId: r.rider_id, hunter: r.role === "hunter", score: breakScore(r.abilities, primaryAbility) }))
        .filter((c) => c.hunter || fieldRank(c.score, fieldBreakScores) <= v2RankCap)
        .sort((a, b) => Number(b.hunter) - Number(a.hunter) || b.score - a.score || a.riderId.localeCompare(b.riderId));
      const hunterCount = eligible.filter((c) => c.hunter).length;
      const extra = stance === "let_go" ? AI_TACTICS_TUNING.V2_LET_GO_BREAK_CANDIDATES : 0;
      const slots = Math.min(AI_TACTICS_TUNING.MAX_BREAK_CANDIDATES, Math.max(extra, hunterCount));
      breakCandidates = eligible.slice(0, slots).map(({ riderId, score }) => ({ riderId, score }));
    }
    // #6201 (KUN orders_gc_v3, ejer 5/10 valg A): paa en bjergetape sender et
    // hold uden klassementschance (lader gaa eller neutral) sin bedste passende
    // klatrer i udbrud: hunter, fri rolle eller hjaelper, aldrig kaptajn eller
    // grupetto, og kun naar hans klatreevne er i feltets passende top-andel.
    // Han kommer oveni holdets forsoeg (hoejst MAX_BREAK_CANDIDATES i alt) og
    // er aldrig en garanti. Ordrernes betydning er uaendret.
    if (isOrdersGcV3OrLater(input.rules_revision) && demand === "climb") {
      const climbCap = Math.max(1, Math.ceil(field.length * AI_TACTICS_TUNING.V2_BREAK_CANDIDATE_FIELD_SHARE));
      const taken = new Set(breakCandidates.map((c) => c.riderId));
      const climber = input.roster
        .filter((r) => !grupettoIds.has(r.rider_id) && !taken.has(r.rider_id))
        .filter((r) => r.role === "hunter" || r.role === "free_role" || r.role === "helper")
        .filter((r) => fieldRank(abilityOf(r, "climbing"), fieldPrimary) <= climbCap)
        .sort((a, b) => abilityOf(b, "climbing") - abilityOf(a, "climbing") || a.rider_id.localeCompare(b.rider_id))[0];
      const hasClimber = breakCandidates.some((c) => {
        const r = input.roster.find((x) => x.rider_id === c.riderId);
        return r !== undefined && fieldRank(abilityOf(r, "climbing"), fieldPrimary) <= climbCap;
      });
      if (climber && !hasClimber && breakCandidates.length < AI_TACTICS_TUNING.MAX_BREAK_CANDIDATES) {
        breakCandidates = [...breakCandidates, { riderId: climber.rider_id, score: breakScore(climber.abilities, primaryAbility) }];
      }
    }
    // #6201 R2a (KUN official_times_v3, ejer 5/10 valg A): et hold uden
    // klassementschance (lader gaa eller neutral) sender flere: paa kuperet og
    // rullende ogsaa en angriber, paa bjerg flere passende klatrere. Samme
    // kandidater som ovenfor (hunter, fri rolle eller hjaelper, aldrig kaptajn
    // eller grupetto, kun i feltets passende top-andel), hoejst
    // V3_MAX_BREAK_CANDIDATES i alt. Aldrig en garanti: motoren afgoer stadig
    // hvem der kommer afsted. Ordrernes betydning er uaendret.
    if (sharedTimeModelGeneration(input.rules_revision) === 3) {
      breakCandidates = v3ExtraBreakCandidates({ input, demand, primaryAbility, field, fieldPrimary, grupettoIds, breakCandidates });
    }
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
      // #6055: kaptajnen holdet koerer for, koerer `normal`. Hjaelperne tager
      // arbejdet (`protect`), og han gemmer reserven til finalen. Hverken
      // `protect` (i motoren "arbejd eller angrib": hoejere kraftkrav) eller
      // `all_out` (hoejere kraftkrav hele dagen) beskytter ham: replayet af
      // prod-etaperne viste at begge braender reserven af foer finalen, saa
      // favoritten ankom tom og tabte netop den dag holdet satsede paa ham.
      // Trinnenes pris er den samme for spillere og er ikke roert her.
      if (stance === "chase") {
        effort = "normal";
        reason = decisiveDay
          ? `Gemmer kraefterne til finalen: ${input.race?.is_stage_race ? "loebets sidste etape af denne type" : "endagsloeb"}, og ${leaderNoun} er nr. ${leaderRank} i feltet (${primaryAbility}). Hjaelperne tager arbejdet.`
          : `Gemmer kraefterne til finalen: holdet koerer for ${leaderNoun} paa ${terrainLabel} (nr. ${leaderRank} i feltet, ${primaryAbility}). Hjaelperne tager arbejdet.`;
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
