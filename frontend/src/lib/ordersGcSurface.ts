// #6067: spillerfladerne til regel-revisionen orders_gc_v1 (#5955/#5978).
//
// Ren afledning, ingen DOM og ingen IO, så både taktikfanen og løbsfilmen kan
// testes uden en browser. To ting bor her:
//
//   1. Taktik-mapping: hvilken regel-revision løbet bruger, om ordre-halvdelen
//      skal vises, og hvilke labels jagt-stancen får. Alt nyt er usynligt indtil
//      løbet har `engine_rules_revision = "orders_gc_v1"`; legacy og NULL er
//      uændret (NULL på et løb betyder legacy, jf. backend/lib/
//      raceEngineRulesRevision.ts).
//   2. Filmlinjer for GC-reaktionens ærlige kvitteringer (`gc_reaction`) og
//      diagnosen for et manglende klassement (`gc_context`). Kun nøgler og
//      navne, aldrig tal: motorens events bærer ingen tal, og fladen må ikke
//      opfinde nogen (fog of war, RACE_ENGINE_RULES).

export const ORDERS_GC_REVISION = "orders_gc_v1";

export type RulesRevision = "legacy" | "orders_gc_v1";

// Arvelinjen (backend/lib/raceEngineRulesRevision.ts): hver revision er hele
// den forrige plus sit eget, så alle vises som orders_gc_v1 på fladerne.
// #6199: the official-times revisions carry the full orders package too
// (official_times_v1 branches from v2, official_times_v2 from v3).
const ORDERS_GC_LINEAGE: ReadonlySet<unknown> = new Set([ORDERS_GC_REVISION, "orders_gc_v2", "orders_gc_v3", "official_times_v1", "official_times_v2"]);

/**
 * Løbets effektive regel-revision for spillerfladerne. #6084: orders_gc_v2 er
 * hele orders_gc_v1-pakken plus en motorændring uden egen flade, så den vises
 * som orders_gc_v1. #6187: orders_gc_v3 ligeså (dens eneste flade er en
 * filmlinje). Alt andet er legacy.
 */
export function raceRulesRevision(raw: unknown): RulesRevision {
  return ORDERS_GC_LINEAGE.has(raw) ? ORDERS_GC_REVISION : "legacy";
}

export function isOrdersGcRevision(raw: unknown): boolean {
  return raceRulesRevision(raw) === ORDERS_GC_REVISION;
}

/**
 * Ordre-halvdelen (jagt-stance, Forsøg udbrud, sprint-tog) er preview-gated
 * for legacy-løb. Under orders_gc_v1 styrer ordrerne morgenudbruddet, så de
 * skal kunne ses og sættes: uden "Forsøg udbrud" kan en kaptajn ikke gå med.
 */
export function ordersVisible({ showOrders, revision }: { showOrders: unknown; revision: unknown }): boolean {
  return Boolean(showOrders) || isOrdersGcRevision(revision);
}

/** i18n-nøgle (races-namespace) for en jagt-stance under løbets revision. */
export function breakawayStanceLabelKey(stance: string, revision: unknown): string {
  return isOrdersGcRevision(revision)
    ? `tacticsOrders.ordersGc.stance.${stance}`
    : `tacticsOrders.breakaway.${stance}`;
}

type FilmEvent = { type?: string; km?: number; params?: Record<string, unknown> };
type FilmCopy = { key: string; params: Record<string, unknown> };

/**
 * Filmlinje for GC-reaktionens kvitteringer. `nameOf` slår et rytter-id op og
 * svarer null når navnet ikke kendes; så springes linjen over (samme regel som
 * resten af løbsfilmen, #4026: aldrig et råt id).
 *
 * gc_reaction.status (backend/lib/engine/v4/mechanics/teamChaseReaction.ts):
 *   started     holdet begynder at reagere på en trussel mod sin GC-rytter
 *   stopped     reaktionen stopper (reason "contained" = truslen er under kontrol)
 *   exhausted   den forebyggende reaktions arbejdsbudget for etapen er brugt
 *   unavailable holdet har ingen ledige hjælpere i GC-rytterens gruppe
 * gc_context.status "missing" = klassementet før etapen mangler (diagnose).
 * own_riders_ahead (#6187, orders_gc_v3): holdet jagter ikke, fordi det har
 *   egne ryttere (`rider_ids`) foran. Højst én pr. hold pr. etape.
 */
export function describeGcReactionEvent(
  event: FilmEvent | null | undefined,
  nameOf: (id: unknown) => string | null,
): FilmCopy | null {
  const p = event?.params ?? {};
  if (event?.type === "gc_context") {
    return p.status === "missing" ? { key: "gc_context_missing", params: {} } : null;
  }
  if (event?.type === "own_riders_ahead") {
    const ids = Array.isArray(p.rider_ids) ? p.rider_ids : [];
    const names = ids.map((id) => nameOf(id)).filter((n): n is string => Boolean(n));
    if (!names.length) return null;
    const riders = names.join(", ");
    const gcRider = nameOf(p.protected_rider_id);
    return gcRider
      ? { key: "own_riders_ahead", params: { rider: gcRider, riders, count: names.length } }
      : { key: "own_riders_ahead_team", params: { riders, count: names.length } };
  }
  if (event?.type !== "gc_reaction") return null;
  const rider = nameOf(p.protected_rider_id);
  if (!rider) return null;
  switch (p.status) {
    case "started": {
      const ids = Array.isArray(p.rider_ids) ? p.rider_ids : [];
      const threats = ids.map((id) => nameOf(id)).filter((n): n is string => Boolean(n));
      return threats.length
        ? { key: "gc_reaction_started_threat", params: { rider, threats: threats.join(", "), count: threats.length } }
        : { key: "gc_reaction_started", params: { rider } };
    }
    case "stopped":
      return { key: p.reason === "contained" ? "gc_reaction_contained" : "gc_reaction_stopped", params: { rider } };
    case "exhausted":
      return { key: "gc_reaction_exhausted", params: { rider } };
    case "unavailable":
      return { key: "gc_reaction_no_workers", params: { rider } };
    default:
      return null;
  }
}
