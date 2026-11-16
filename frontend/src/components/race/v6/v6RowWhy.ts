// #7778 · Hvorfor?-knappen på v6-løbssiden (kontakten rider_why_button, #7717).
// Samme regel som den nuværende side (StageTabV2): knappen findes kun, når kontakten
// er tændt og løbshistorien ikke fejlede; en ikke-starter har intet løb at forklare.
import { riderWhy, routeFitsAtRaceTime } from "../../../lib/riderWhyModel.ts";
import type { RiderWhyInput } from "../../../lib/riderWhyModel.ts";
import type { RowWhy } from "../stagePageV2/YourDayCard.tsx";

export interface V6RowWhyInput {
  enabled: boolean;
  storyError: boolean;
  storyLoading: boolean;
  events: RiderWhyInput["events"];
  story: RiderWhyInput["story"];
  climbs: RiderWhyInput["climbs"];
  cast: RiderWhyInput["cast"];
  routeFits: RiderWhyInput["routeFits"];
}

/** null = ingen knap på rækkerne (kontakten slukket eller historien kan ikke hentes). */
export function buildV6RowWhy(input: V6RowWhyInput): RowWhy | null {
  if (!input.enabled || input.storyError) return null;
  const { events, story, climbs, cast, routeFits } = input;
  return {
    loading: input.storyLoading,
    forRow: (r) => (r.status === "dns" ? null : riderWhy({ riderId: r.riderId, rank: r.rank, status: r.status, reasonKey: r.reasonKey, events, story, climbs, cast, routeFits })),
  };
}

/** Rute-match kun så længe etapen er frisk, som på den nuværende side. */
export function v6RouteFits(fits: ReadonlyMap<string, number | null>, ranAt: string | null | undefined, nowMs: number) {
  return routeFitsAtRaceTime(fits, ranAt, nowMs);
}
