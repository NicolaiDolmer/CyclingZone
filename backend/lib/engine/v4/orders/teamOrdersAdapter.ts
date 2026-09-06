// F3 taktik-ordrer v1 (#4030/#3855/#4246) — adapter: race_team_orders-raekker +
// holdudtagelsens roller → StageInput.orders. Adapter-laget er (som
// entrantAdapter/routeAdapter) den LOVLIGE graense mellem DB-former og den rene
// kerne: herfra og ind er alt deterministisk og IO-frit.
//
// #4246 (ejer 2/9 + 27/8, LAAST) — kaeden fra spiller til motor lukkes her:
//
//   holdudtagelsens rolle  ->  standardordren   (teamOrderContract.defaultTeamOrderForRoster)
//   + etapens gemte raekke ->  dagens overlay   (teamOrderContract.applyStageOverlayToOrder)
//   = én team_tactics-ordre + (naar holdet har et tog) én leadout-ordre
//
// Auditten 5/9 fandt tre huller, alle lukket her:
//   (a) standardordren gav ALLE ryttere "normal, proev ikke udbrud" uanset
//       rolle — nu er rollen standardordren (en `hunter` proever udbruddet uden
//       at spilleren skal roere noget).
//   (b) sprint-toget kunne ikke saettes af en spiller — `leadout` pr. rytter er
//       nu i kontrakten, og adapteren oversaetter det til M6's `leadout`-ordre.
//   (c) `race_role` laa i selve ordren — DB-raekker kan stadig baere feltet
//       (gamle raekker), men det LAESES ikke laengere: rollen kommer fra
//       holdudtagelsen, og taktik-kortet kan ikke overskrive den.
//
// ÉN kontrakt: formen, vokabularerne og rolle-defaulten bor i
// `../ai/teamOrderContract.ts` og importeres herfra — de fire uenige kopier
// auditten fandt er nu én.

import type { TeamOrder as EngineTeamOrder } from "../types.ts";
import {
  applyStageOverlayToOrder,
  defaultTeamOrderForRoster,
  BREAKAWAY_STANCE_VALUES,
  EFFORT_LEVEL_VALUES,
  RIDER_ROLE_VALUES,
  type BreakawayStance,
  type EffortLevel,
  type RiderRole,
  type RosterEntry,
  type StageOverlay,
  type StageOverlayRider,
  type TeamOrder as TeamTacticsOrder,
} from "../ai/teamOrderContract.ts";
import { TEAM_TACTICS_ORDER_KIND } from "../mechanics/breakaway.ts";
import { LEADOUT_ORDER_KIND } from "../mechanics/leadout.ts";

export type { BreakawayStance, TeamTacticsOrder };

/** Raekkeform fra race_team_orders (DB) — kun felterne adapteren laeser. */
export type TeamOrderRow = {
  team_id: string;
  stage_number: number;
  breakaway_stance?: string | null;
  riders?: unknown;
};

/** Startlistens hold + roller: hvem koerer, og hvad er deres opgave. */
export type RosterRider = { team_id: string; rider_id: string; role?: string | null };

const VALID_STANCES: ReadonlySet<string> = new Set(BREAKAWAY_STANCE_VALUES);
const VALID_EFFORTS: ReadonlySet<string> = new Set(EFFORT_LEVEL_VALUES);
const VALID_ROLES: ReadonlySet<string> = new Set(RIDER_ROLE_VALUES);

/** Ukendt/manglende rolle → `free_role` (ingen bunden opgave), aldrig et kast. */
function toRole(role: string | null | undefined): RiderRole {
  return VALID_ROLES.has(role ?? "") ? (role as RiderRole) : "free_role";
}

/**
 * Én DB-raekke → etapens overlay. Defensiv mod jsonb-drift (shape haandhaeves i
 * API-laget, ikke DB): ukendte stances/efforts droppes som "ikke valgt" i
 * stedet for at blive tvunget til neutral/normal — en ulaeselig vaerdi maa
 * falde tilbage paa ROLLENS standard, ikke overskrive den. Ikke-arrays bliver
 * en tom liste; en korrupt raekke maa aldrig vaelte en simulering.
 *
 * `race_role` i raekken ignoreres bevidst (#4246, ejer 27/8).
 */
export function rowToStageOverlay(row: TeamOrderRow): StageOverlay {
  const stance = VALID_STANCES.has(row.breakaway_stance ?? "")
    ? (row.breakaway_stance as BreakawayStance)
    : undefined;
  const rawRiders = Array.isArray(row.riders) ? row.riders : [];
  const riders: StageOverlayRider[] = rawRiders
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .filter((r) => typeof r["rider_id"] === "string")
    .map((r) => {
      const entry: StageOverlayRider = { rider_id: r["rider_id"] as string };
      if (VALID_EFFORTS.has((r["effort"] as string) ?? "")) entry.effort = r["effort"] as EffortLevel;
      if (typeof r["try_break"] === "boolean") entry.try_break = r["try_break"];
      if (typeof r["leadout"] === "boolean") entry.leadout = r["leadout"];
      return entry;
    });
  return { breakaway_stance: stance, riders };
}

/**
 * Standardordre (rollerne) + evt. etape-overlay for ÉT hold.
 * Uden raekke er resultatet ren rolle-default — T4: kernen kraever ALDRIG ordrer.
 */
export function teamOrderFor(teamId: string, roster: readonly RosterEntry[], row?: TeamOrderRow): TeamTacticsOrder {
  const base = defaultTeamOrderForRoster(teamId, roster);
  return row ? applyStageOverlayToOrder(base, rowToStageOverlay(row)) : base;
}

/** Pak T3-formen ind i types.ts's aabne TeamOrder-konvolut (kind + params). */
export function toEngineTeamOrder(order: TeamTacticsOrder): EngineTeamOrder {
  return {
    team_id: order.team_id,
    kind: TEAM_TACTICS_ORDER_KIND,
    params: { breakaway_stance: order.breakaway_stance, riders: order.riders },
  };
}

/**
 * M6-ordren (sprint-toget) afledt af ÉN holdordre + holdets roller.
 *
 * Togets MAAL er rollen `sprint_captain` — aldrig noget taktik-kortet kan
 * flytte (#4246). Togets MANDSKAB er ordrens `leadout`-flag, som rollen
 * `helper` saetter som standard og spilleren kan aendre for dagen.
 *
 * `null` naar holdet ikke har en spurt-kaptajn paa etapen, eller naar ingen
 * koerer for ham — M6 giver pr. sin egen kontrakt ingen bonus for et tomt tog,
 * saa en tom ordre ville kun vaere stoej i `StageInput.orders`.
 */
export function toEngineLeadoutOrder(
  order: TeamTacticsOrder,
  roster: readonly RosterEntry[],
): EngineTeamOrder | null {
  const captain = roster.find((r) => r.role === "sprint_captain");
  if (!captain) return null;
  const train = order.riders
    .filter((r) => r.leadout === true && r.rider_id !== captain.rider_id)
    .map((r) => r.rider_id);
  if (train.length === 0) return null;
  return {
    team_id: order.team_id,
    kind: LEADOUT_ORDER_KIND,
    params: { captain_rider_id: captain.rider_id, leadout_rider_ids: train },
  };
}

/** Startlistens ryttere grupperet pr. hold, i deterministisk hold-orden (team_id stigende). */
export function rosterByTeam(roster: readonly RosterRider[]): Map<string, RosterEntry[]> {
  const byTeam = new Map<string, RosterEntry[]>();
  for (const rider of roster) {
    if (rider.team_id == null || rider.rider_id == null) continue;
    const teamId = String(rider.team_id);
    if (!byTeam.has(teamId)) byTeam.set(teamId, []);
    byTeam.get(teamId)!.push({ rider_id: String(rider.rider_id), role: toRole(rider.role) });
  }
  return new Map([...byTeam.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

/**
 * Alle raekker for ÉN etape + startlistens hold og roller → komplet
 * `StageInput.orders`.
 *
 * Raekker for andre etaper ignoreres; hold uden raekke faar rollernes
 * standardordre (T4); raekker for hold UDENFOR startlisten droppes (holdet
 * stiller ikke op). Deterministisk output-orden: hold sorteret paa team_id,
 * og pr. hold foerst `team_tactics`, saa evt. `leadout`.
 */
export function buildStageOrders(args: {
  rows: readonly TeamOrderRow[];
  stageNumber: number;
  roster: readonly RosterRider[];
}): EngineTeamOrder[] {
  const { rows, stageNumber, roster } = args;
  const byTeam = new Map<string, TeamOrderRow>();
  for (const row of rows) {
    if (row.stage_number === stageNumber) byTeam.set(String(row.team_id), row);
  }
  const orders: EngineTeamOrder[] = [];
  for (const [teamId, teamRoster] of rosterByTeam(roster)) {
    const order = teamOrderFor(teamId, teamRoster, byTeam.get(teamId));
    orders.push(toEngineTeamOrder(order));
    const leadout = toEngineLeadoutOrder(order, teamRoster);
    if (leadout) orders.push(leadout);
  }
  return orders;
}
