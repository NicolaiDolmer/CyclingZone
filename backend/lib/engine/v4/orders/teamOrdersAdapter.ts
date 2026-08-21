// F3 taktik-ordrer v1 (#4030/#3855) — adapter: race_team_orders-raekker →
// StageInput.orders. Adapter-laget er (som entrantAdapter/routeAdapter) den
// LOVLIGE graense mellem DB-former og den rene kerne: herfra og ind er alt
// deterministisk og IO-frit.
//
// T4 (taktik-spec): fravaerende ordrer = neutrale defaults — kernen kraever
// ALDRIG ordrer. Adapteren udfylder derfor en neutral ordre for ethvert hold i
// startlisten uden en gemt raekke, saa mekanikkerne (M5-udbrud m.fl.) altid kan
// slaa et holds stance op uden null-tjek.
//
// TYPE-NOTE (F3-wiring, orkestrator-ansvar): types.ts's TeamOrder er stadig det
// loese F2-placeholder ({team_id, kind, params?}) — flere F3-spor (M5, M14)
// afventer at orkestratoren fryser T3-formen i types.ts. Indtil da baerer denne
// fil specens praecise form som SIN EGEN eksport (TeamTacticsOrder) og pakker
// den ind i placeholder-formen via toEngineTeamOrder(), saa alt kompilerer mod
// UAENDRET types.ts. Naar types.ts fryses til T3-formen, kollapser wrapperen til
// identitet og TeamTacticsOrder erstattes af den centrale type.

import type { TeamOrder } from "../types.ts";

export type BreakawayStance = "chase" | "neutral" | "let_go";
export type OrderEffort = "protect" | "normal" | "save";

/** T3-formen fra 2026-08-21-race-tactics-orders-v1-design.md (frosset i spec). */
export type TeamTacticsOrder = {
  team_id: string;
  breakaway_stance: BreakawayStance;
  riders: Array<{
    rider_id: string;
    race_role: string;
    effort: OrderEffort;
    try_break: boolean;
  }>;
};

/** Raekkeform fra race_team_orders (DB) — kun felterne adapteren laeser. */
export type TeamOrderRow = {
  team_id: string;
  stage_number: number;
  breakaway_stance?: string | null;
  riders?: unknown;
};

const VALID_STANCES: ReadonlySet<string> = new Set(["chase", "neutral", "let_go"]);
const VALID_EFFORTS: ReadonlySet<string> = new Set(["protect", "normal", "save"]);

/** T4-defaulten for et hold uden gemt raekke. */
export function neutralOrder(teamId: string): TeamTacticsOrder {
  return { team_id: teamId, breakaway_stance: "neutral", riders: [] };
}

/**
 * Én DB-raekke → TeamTacticsOrder. Defensiv mod jsonb-drift (shape haandhaeves
 * i API-laget, ikke DB): ukendte stances/efforts falder til neutral/normal,
 * ikke-arrays til tom liste — en korrupt raekke maa aldrig vaelte en simulering.
 */
export function rowToTacticsOrder(row: TeamOrderRow): TeamTacticsOrder {
  const stance = VALID_STANCES.has(row.breakaway_stance ?? "")
    ? (row.breakaway_stance as BreakawayStance)
    : "neutral";
  const rawRiders = Array.isArray(row.riders) ? row.riders : [];
  const riders = rawRiders
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .filter((r) => typeof r["rider_id"] === "string")
    .map((r) => ({
      rider_id: r["rider_id"] as string,
      race_role: typeof r["race_role"] === "string" ? (r["race_role"] as string) : "helper",
      effort: VALID_EFFORTS.has((r["effort"] as string) ?? "") ? (r["effort"] as OrderEffort) : "normal",
      try_break: r["try_break"] === true,
    }));
  return { team_id: row.team_id, breakaway_stance: stance, riders };
}

/**
 * Pak T3-formen ind i types.ts's nuvaerende loese TeamOrder-placeholder
 * ({team_id, kind, params}). kind="team_tactics" er kontrakten mekanik-hooks
 * matcher paa indtil types.ts fryses (se TYPE-NOTE oeverst).
 */
export function toEngineTeamOrder(order: TeamTacticsOrder): TeamOrder {
  return {
    team_id: order.team_id,
    kind: "team_tactics",
    params: { breakaway_stance: order.breakaway_stance, riders: order.riders },
  };
}

/**
 * Alle raekker for ÉN etape + startlistens hold → komplet StageInput.orders.
 * Raekker for andre etaper ignoreres; hold uden raekke faar neutral default
 * (T4); raekker for hold UDENFOR startlisten droppes (holdet stiller ikke op).
 * Deterministisk output-orden: startlistens holdorden.
 */
export function buildStageOrders(args: {
  rows: TeamOrderRow[];
  stageNumber: number;
  teamIdsInStartlist: string[];
}): TeamOrder[] {
  const { rows, stageNumber, teamIdsInStartlist } = args;
  const byTeam = new Map<string, TeamOrderRow>();
  for (const row of rows) {
    if (row.stage_number === stageNumber) byTeam.set(row.team_id, row);
  }
  return teamIdsInStartlist.map((teamId) => {
    const row = byTeam.get(teamId);
    return toEngineTeamOrder(row ? rowToTacticsOrder(row) : neutralOrder(teamId));
  });
}
