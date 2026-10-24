// #6299 (b), ejer-go 24/10: hver egen rytters LÅSTE ordre på en kørt etape.
// Ren logik, ingen React, intet netværk.
//
// Kilde: GET /api/races/:raceId/team-orders (fetchTeamOrders), som kun svarer
// for spillerens eget hold, plus /stage-roles for etapens rolle-overrides.
// Samme regler som motoren kørte etapen med:
//   - ordren = etapens gemte række lagt oven på rollens standardordre
//     (mergeOrderWithRoster = applyStageOverlayToOrder); ingen række = rollens
//     standard (T4). Toget er kun standard på en flad etape når løbets
//     revision siger det (#6462).
//   - indsatsen med raceRunners forrang (effectiveEffortByRider, #5580/#6647);
//     intet valg = rollens standard, "normal".
//   - rollen: etapens override, ellers holdudtagelsens rolle.
import { defaultTeamOrder, mergeOrderWithRoster, trainDefaultForStage } from "../../lib/tacticsPlan.js";
import { effectiveEffortByRider } from "../../lib/stageSplitTimes.ts";

export interface TeamOrdersContext {
  riders?: Array<{ rider_id: string; race_role?: string | null }>;
  orders?: Array<{ stage_number: number; breakaway_stance?: string | null; riders?: unknown[]; locked_at?: string | null }>;
  defaultOrder?: { breakaway_stance?: string; riders?: unknown[] } | null;
  sprintTrainFlatOnly?: boolean;
}

export interface StageRolesLike {
  riders?: Array<{ rider_id: string; name?: string | null; race_role?: string | null }>;
  overrides?: Array<{ stage_number: number; rider_id: string; race_role?: string | null; effort?: string | null }>;
}

export interface RecapRider {
  riderId: string;
  name: string | null;
  role: string | null;
  effort: string;
  tryBreak: boolean;
  leadout: boolean;
}

export interface StageOrdersRecap {
  stance: string;
  /** true = holdet gemte en ordre for etapen; false = rollernes standard. */
  saved: boolean;
  riders: RecapRider[];
}

const ROLE_ORDER: Record<string, number> = { captain: 0, sprint_captain: 1, hunter: 2, free_role: 3, helper: 4 };

export function stageOrdersRecap({
  context, stageRoles = null, stageNumber, profileType = null, riderIds = null, nameOf = () => null, ranAt = null,
}: {
  context: TeamOrdersContext | null | undefined;
  stageRoles?: StageRolesLike | null | false;
  stageNumber: number;
  profileType?: string | null;
  /** Egne ryttere der kørte etapen (etaperesultatet); null = hele udtagelsen. */
  riderIds?: readonly string[] | null;
  nameOf?: (id: string) => string | null | undefined;
  /** Etapens tidslinje-tidspunkt (#6647-forrangen for indsats). */
  ranAt?: string | null;
}): StageOrdersRecap | null {
  if (!context) return null;
  const roster = (context.riders ?? []).map((r) => String(r.rider_id));
  const ids = riderIds && riderIds.length ? riderIds.map(String) : roster;
  if (!ids.length) return null;

  const saved = (context.orders ?? []).find((o) => Number(o.stage_number) === stageNumber) ?? null;
  const defaultOrder = trainDefaultForStage(context.defaultOrder ?? null, { profileType: profileType as null, flatOnly: context.sprintTrainFlatOnly === true }); // JS-default (null) styrer den infererede type
  const order = mergeOrderWithRoster(
    saved ?? (defaultOrder ? { breakaway_stance: defaultOrder.breakaway_stance, riders: [] } : defaultTeamOrder(ids)),
    ids,
    defaultOrder,
  );
  const efforts = effectiveEffortByRider(stageRoles || null, context, stageNumber, { v4: true, ranAt });

  const baseRole = new Map<string, string | null>();
  for (const r of (stageRoles || null)?.riders ?? []) baseRole.set(String(r.rider_id), r.race_role ?? null);
  for (const r of context.riders ?? []) if (r.race_role) baseRole.set(String(r.rider_id), r.race_role);
  const stageRole = new Map<string, string>();
  for (const o of (stageRoles || null)?.overrides ?? []) {
    if (Number(o.stage_number) === stageNumber && o.race_role) stageRole.set(String(o.rider_id), o.race_role);
  }

  const riders: RecapRider[] = (order.riders as Array<{ rider_id: string; try_break?: boolean; leadout?: boolean }>).map((r) => {
    const id = String(r.rider_id);
    return {
      riderId: id,
      name: nameOf(id) ?? null,
      role: stageRole.get(id) ?? baseRole.get(id) ?? null,
      effort: efforts.get(id) ?? "normal",
      tryBreak: r.try_break === true,
      leadout: r.leadout === true,
    };
  });
  riders.sort((a, b) => (ROLE_ORDER[a.role ?? ""] ?? 5) - (ROLE_ORDER[b.role ?? ""] ?? 5) || String(a.name ?? "").localeCompare(String(b.name ?? "")));
  return { stance: String(order.breakaway_stance ?? "neutral"), saved: Boolean(saved), riders };
}
