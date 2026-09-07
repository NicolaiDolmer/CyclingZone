// backend/lib/engine/v4/testUtils/makeHookCtx.ts
// Delt test-hjaelper for #4949: bygger en SegmentHookContext PRAECIS som
// segmentLoop.ts goer det i produktion — segment-noeglet `rngFor` (via
// rng.ts's segmentRngFor) + etape-stabil `rngForStage`.
//
// Baggrund: efter #4886 (PR #4931) er SegmentHookContext.rngFor ALTID
// segment-noeglet i produktion. Fem test-rigge (climbSelection/descent/
// breakaway/teamPlay/finale) byggede stadig ctx med den raa etape-stream i
// rngFor — de testede mekanikken, men ikke produktionens noegling. cobbles.ts/
// incidents.ts-riggene og segmentLoop.rngStreams.test.ts spejlede allerede
// produktionen korrekt (se #4886) og er facit for denne hjaelper.
//
// REN test-kode — ingen import fra oevrigt backend end selve engine v4
// (samme renheds-graense som rng.ts).

import { boundRngFor, segmentRngFor } from "../rng.ts";
import type { Entrant, EngineTuning, RouteV2, Segment, SegmentHookContext, TeamOrder } from "../types.ts";

export type MakeHookCtxOptions = {
  segment: Segment;
  route: RouteV2;
  entrants: Readonly<Record<string, Entrant>>;
  tuning: EngineTuning;
  /** Default "test-seed" naar intet andet er relevant for testen. */
  seed?: string;
  /** Default 0 — de fleste rigge tester ét segment isoleret. */
  segmentIndex?: number;
  /** Default [] — T4 (tactics-orders-specen): kernen kraever ALDRIG ordrer. */
  orders?: readonly TeamOrder[];
};

/**
 * Bygger en SegmentHookContext med samme rngFor/rngForStage-kobling som
 * segmentLoop.runSegmentLoop: `rngForStage` er etapens raa, seed-bundne
 * stream; `rngFor` er DEN SAMME stream pakket ind i segmentRngFor for det
 * givne segmentIndex (#4886's kontrakt). Enhver mekanik-hook der laeser
 * ctx.rngFor i en test ser derfor praecis den stream produktionen giver den.
 */
export function makeHookCtx(opts: MakeHookCtxOptions): SegmentHookContext {
  const segmentIndex = opts.segmentIndex ?? 0;
  const rngForStage = boundRngFor(opts.seed ?? "test-seed");
  return {
    segment: opts.segment,
    segmentIndex,
    route: opts.route,
    entrants: opts.entrants,
    tuning: opts.tuning,
    rngFor: segmentRngFor(rngForStage, segmentIndex),
    rngForStage,
    orders: opts.orders ?? [],
  };
}

/**
 * Flytter en eksisterende ctx til et nyt segment — for rigge der simulerer
 * FLERE segmenter i traek (fx en jagt- eller granularitets-loekke) og genbruger
 * samme etape-stream. Spejler segmentLoop.ts's egen loekke, hvor ÉN
 * `rngForStage`-lukning genbruges paa tvaers af segmenter, og kun
 * segmentRngFor-indpakningen aendrer sig pr. segmentIndex.
 *
 * Bruges hvor `{ ...ctx, segment, segmentIndex }` ellers ville genbruge
 * ctx.rngFor uaendret paa tvaers af segmenter — praecis den fejlklasse #4886/
 * #4949 handler om.
 */
export function rekeyHookCtxForSegment(
  ctx: SegmentHookContext,
  segment: Segment,
  segmentIndex: number,
): SegmentHookContext {
  return { ...ctx, segment, segmentIndex, rngFor: segmentRngFor(ctx.rngForStage, segmentIndex) };
}
