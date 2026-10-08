/**
 * #6185 anchor: a real v4 stage (Giro della Penisola, stage 3) with rider ids
 * replaced by aliases and the peloton trimmed. Four morning escapees (e1, e2,
 * e4, e5) are dropped from the break at km 162 and finish near the back of the
 * field; e3 and e6 are caught. Group ids, kilometres and event order are kept
 * as recorded; measured gaps are left out on purpose.
 */
import type { ParticipationEvent } from "./raceParticipationHistory.ts";

export const PENISOLA_STAGE3_RACE_ID = "07f2090c-c4d2-49e7-9c1b-9a9a268b7e3f";
export const PENISOLA_MORNING = ["e1", "e2", "e3", "e4", "e5", "e6"] as const;
export const PENISOLA_DROPPED = ["e1", "e2", "e4", "e5"] as const;
export const PENISOLA_CAUGHT = ["e3", "e6"] as const;

const PELOTON = ["w", "b1", "p1", "p2", "p3", "p4", "p5", "p6", "s3", "s1"];

export const PENISOLA_STAGE3_EVENTS: ParticipationEvent[] = [
  { km: 0, type: "stage_start", params: { profile_type: "hilly" } },
  { km: 12, type: "breakaway_formed", params: { group_id: "breakaway-0", rider_ids: [...PENISOLA_MORNING] } },
  { km: 49.28, type: "group_merged", params: { group_id: "peloton-0", into_group_id: "solo-m10-0-0", rider_ids: PELOTON } },
  { km: 92, type: "peloton_splits", params: { cause: "climb_deficit", group_id: "solo-7000", source_group_id: "solo-m10-0-0", rider_ids: ["s1"] } },
  { km: 96.3, type: "group_merged", params: { group_id: "solo-7000", into_group_id: "solo-m10-7-0", rider_ids: ["s1"] } },
  { km: 96.3, type: "group_merged", params: { group_id: "solo-m10-1-0", into_group_id: "solo-m10-7-0", rider_ids: ["s2"] } },
  { km: 118.5, type: "finale_attack", params: { group_id: "breakaway-11000", direction: "descent", rider_ids: ["e1", "e3"] } },
  { km: 118.5, type: "finale_attack", params: { group_id: "solo-11001", direction: "descent", rider_ids: ["s2"] } },
  { km: 118.5, type: "group_merged", params: { group_id: "solo-m10-7-0", into_group_id: "solo-11001", rider_ids: ["s3", "s1"] } },
  { km: 162, type: "peloton_splits", params: { cause: "mixed", group_id: "chase-14000", source_group_id: "breakaway-0", rider_ids: ["e2", "e4", "e5"] } },
  { km: 162, type: "peloton_splits", params: { cause: "climb_deficit", group_id: "solo-14001", source_group_id: "breakaway-11000", rider_ids: ["e1"] } },
  { km: 162, type: "peloton_splits", params: { cause: "wprime_depleted", group_id: "solo-14002", source_group_id: "solo-11001", rider_ids: ["s1"] } },
  { km: 162, type: "peloton_splits", params: { cause: "mixed", group_id: "gruppetto-14003", source_group_id: "solo-m10-0-0", rider_ids: ["p4", "p5", "p6"] } },
  { km: 162, type: "breakaway_caught", params: { group_id: "breakaway-0", rider_ids: ["e6"], chase_group_id: "solo-m10-0-0", chase_group_kind: "peloton" } },
  { km: 162, type: "breakaway_caught", params: { group_id: "breakaway-11000", rider_ids: ["e3"], chase_group_id: "solo-m10-0-0", chase_group_kind: "peloton" } },
  { km: 162, type: "group_merged", params: { group_id: "breakaway-11000", into_group_id: "breakaway-0", rider_ids: ["e3"] } },
  { km: 162, type: "group_merged", params: { group_id: "solo-m10-0-0", into_group_id: "breakaway-0", rider_ids: ["w", "b1", "p1", "p2", "p3"] } },
  // The dropped escapees regroup with each other only: no non-escapee in the
  // merge, so nothing here can count as a catch.
  { km: 162, type: "group_merged", params: { group_id: "chase-14000", into_group_id: "solo-14001", rider_ids: ["e2", "e4", "e5"] } },
  { km: 166.2, type: "finale_attack", params: { group_id: "breakaway-15000", direction: "descent", rider_ids: ["w", "b1", "e3"] } },
  { km: 166.2, type: "finale_attack", params: { group_id: "solo-15001", direction: "descent", rider_ids: ["e1"] } },
  { km: 166.2, type: "finale_attack", params: { group_id: "gruppetto-15002", direction: "descent", rider_ids: ["p4"] } },
  { km: 166.2, type: "finale_attack", params: { group_id: "solo-15003", direction: "descent", rider_ids: ["s2"] } },
  { km: 166.2, type: "group_merged", params: { group_id: "solo-11001", into_group_id: "solo-15003", rider_ids: ["s3"] } },
  { km: 166.2, type: "group_merged", params: { group_id: "solo-14002", into_group_id: "solo-15003", rider_ids: ["s1"] } },
  { km: 175, type: "breakaway_caught", params: { group_id: "breakaway-15000", rider_ids: ["w", "b1", "e3"], chase_group_id: "breakaway-0", chase_group_kind: "peloton" } },
  { km: 175, type: "finale_attack", params: { kind: "gap_survived", group_id: "gruppetto-14003" } },
  { km: 175, type: "group_merged", params: { group_id: "breakaway-0", into_group_id: "finale-tier-1", rider_ids: ["p1"] } },
  { km: 175, type: "group_merged", params: { group_id: "breakaway-0", into_group_id: "finale-tier-5", rider_ids: ["e6"] } },
  { km: 175, type: "group_merged", params: { group_id: "breakaway-15000", into_group_id: "finale-winner-0", rider_ids: ["w"] } },
  { km: 175, type: "group_merged", params: { group_id: "breakaway-15000", into_group_id: "finale-tier-10", rider_ids: ["e3"] } },
  { km: 175, type: "finale_attack", params: { kind: "stage_decided", group_id: "finale-winner-0", rider_id: "w", win_type: "close_win", finale_type: "breakaway" } },
  { km: 175, type: "finish", params: { top: [{ rank: 1, rider_id: "w" }, { rank: 2, rider_id: "p1" }], win_type: "close_win" } },
];

/** Finish order (rank) as recorded, trimmed to the fixture's riders. */
export const PENISOLA_STAGE3_RANKS: Record<string, number> = {
  w: 1, p1: 2, e6: 6, e3: 11, b1: 16, p2: 20, p3: 21, p4: 175, p5: 176,
  e4: 177, e2: 178, e5: 179, p6: 180, e1: 181, s2: 182, s3: 183, s1: 184,
};

// ── #6185 B1: the two prod stages, anonymised ───────────────────────────────
// Event SHAPES, group ids, km and the morning riders are exactly as the engine
// recorded them (race_stage_timelines v2, read 5/10); rider ids are replaced by
// their finishing place (e1 = 1st, a3 = 3rd, p9 = 9th) and the big pack lists
// are cut to a few riders. e* = morning escapee, a* = later attacker, p* = pack.

// Stage 1 of race 2349508b: six of the eight ride AWAY from the break at km 76
// (chase-4000); the two left behind in breakaway-0 are caught at the line. The
// forward piece splits again, e2 goes solo (gap survived), e1 wins solo. The
// engine's verdicts only name breakaway-0 and breakaway-5000.
export const STAGE_2349_E1: ParticipationEvent[] = [
  { km: 0, type: "stage_start", params: { distance_km: 175, field_count: 20, profile_type: "mountain" } },
  { km: 12, type: "breakaway_formed", params: { group_id: "breakaway-0", rider_ids: ["e7", "e16", "e8", "e6", "e2", "e1", "e5", "e15"] } },
  { km: 76, type: "peloton_splits", params: { cause: "mixed", group_id: "chase-4000", rider_ids: ["e7", "e16", "e8", "e2", "e1", "e15"], gap_seconds: 62.13, source_group_id: "breakaway-0" } },
  { km: 76, type: "peloton_splits", params: { cause: "mixed", group_id: "gruppetto-4001", rider_ids: ["p9", "p10", "p11", "p12", "p13", "p14", "p17", "p18", "p19", "p20"], gap_seconds: 71.02, source_group_id: "peloton-0" } },
  { km: 83.8, type: "finale_attack", params: { group_id: "breakaway-5000", direction: "descent", rider_ids: ["a4", "a3"], gained_seconds: 11.33 } },
  { km: 83.8, type: "finale_attack", params: { group_id: "gruppetto-5001", direction: "descent", rider_ids: ["p13", "p14", "p17"], gained_seconds: 16 } },
  { km: 108, type: "peloton_splits", params: { cause: "mixed", group_id: "chase-7000", rider_ids: ["e7", "e16", "e8", "e15"], gap_seconds: 34.51, source_group_id: "chase-4000" } },
  { km: 108, type: "peloton_splits", params: { cause: "mixed", group_id: "chase-7001", rider_ids: ["p18", "p19"], gap_seconds: 37.93, source_group_id: "gruppetto-4001" } },
  { km: 114.5, type: "group_merged", params: { group_id: "chase-7001", rider_ids: ["p18", "p19"], into_group_id: "gruppetto-4001" } },
  { km: 170, type: "peloton_splits", params: { cause: "climb_deficit", group_id: "solo-12000", rider_ids: ["e2"], gap_seconds: 27.15, source_group_id: "chase-4000" } },
  { km: 170, type: "peloton_splits", params: { cause: "mixed", group_id: "chase-12001", rider_ids: ["e16", "e15"], gap_seconds: 43.64, source_group_id: "chase-7000" } },
  { km: 175, type: "breakaway_caught", params: { group_id: "breakaway-0", rider_ids: ["e6", "e5"] } },
  { km: 175, type: "breakaway_caught", params: { group_id: "breakaway-5000", rider_ids: ["a4", "a3"] } },
  { km: 175, type: "finale_attack", params: { kind: "gap_survived", group_id: "solo-12000", gap_seconds: 2.2 } },
  { km: 175, type: "group_merged", params: { group_id: "chase-4000", rider_ids: ["e1"], into_group_id: "finale-winner-0" } },
  { km: 175, type: "finale_attack", params: { kind: "stage_decided", group_id: "finale-winner-0", rider_id: "e1", win_type: "solo_win", finale_type: "descent" } },
  { km: 175, type: "finish", params: { win_type: "solo_win" } },
];
export const finishRows = (ids: string[]): { rider_id: string; rank: number }[] => ids.map((id) => ({ rider_id: id, rank: Number(id.slice(1)) }));
export const STAGE_2349_E1_ROWS = finishRows(["e1", "e2", "a3", "a4", "e5", "e6", "e7", "e8", "p9", "p10", "p11", "p12", "p13", "p14", "e15", "e16", "p17", "p18", "p19", "p20"]);

// Stage 4 of race 877c67c1: e107 splits off at km 74 and is later joined by a
// later attacker (p106). e2 attacks solo, merges back, and at km 140 the break
// splits; e2 rides in the split piece (chase-9000) and finishes 2nd; the best
// non-escapee is 8th. (e1..e7's "caught" at km 96.33 is engine issue #6234, not
// asserted here.)
export const STAGE_877_E4: ParticipationEvent[] = [
  { km: 0, type: "stage_start", params: { field_count: 20 } },
  { km: 12, type: "breakaway_formed", params: { group_id: "breakaway-0", rider_ids: ["e2", "e7", "e1", "e6", "e107", "e5", "e3", "e4"] } },
  { km: 74, type: "peloton_splits", params: { group_id: "solo-4000", rider_ids: ["e107"], source_group_id: "breakaway-0" } },
  { km: 74, type: "peloton_splits", params: { group_id: "gruppetto-4001", rider_ids: ["p120", "p121", "p141"], source_group_id: "peloton-0" } },
  { km: 80.7, type: "finale_attack", params: { group_id: "solo-5000", direction: "descent", rider_ids: ["e2"] } },
  { km: 80.7, type: "finale_attack", params: { group_id: "solo-5001", direction: "descent", rider_ids: ["p106"] } },
  { km: 80.7, type: "finale_attack", params: { group_id: "solo-5002", direction: "descent", rider_ids: ["p141"] } },
  { km: 80.7, type: "group_merged", params: { group_id: "gruppetto-4001", rider_ids: ["p120", "p121"], into_group_id: "solo-5002" } },
  { km: 96.33, type: "breakaway_caught", params: { group_id: "breakaway-0", rider_ids: ["e7", "e1", "e6", "e5", "e3", "e4"] } },
  { km: 96.33, type: "group_merged", params: { group_id: "solo-5000", rider_ids: ["e2"], into_group_id: "breakaway-0" } },
  { km: 96.33, type: "group_merged", params: { group_id: "solo-5001", rider_ids: ["p106"], into_group_id: "solo-4000" } },
  { km: 140, type: "peloton_splits", params: { group_id: "chase-9000", rider_ids: ["e2", "e7", "e6", "e5", "e3", "e4"], source_group_id: "breakaway-0" } },
  { km: 140, type: "peloton_splits", params: { group_id: "gruppetto-9001", rider_ids: ["p9", "p10"], source_group_id: "peloton-0" } },
  { km: 140, type: "peloton_splits", params: { group_id: "solo-9002", rider_ids: ["e107"], source_group_id: "solo-4000" } },
  { km: 140, type: "breakaway_survived", params: { group_id: "breakaway-0", rider_ids: ["e1"] } },
  { km: 140, type: "finale_attack", params: { kind: "gap_survived", group_id: "chase-9000" } },
  { km: 140, type: "group_merged", params: { group_id: "breakaway-0", rider_ids: ["e1"], into_group_id: "finale-winner-0" } },
  { km: 140, type: "finale_attack", params: { kind: "stage_decided", group_id: "finale-winner-0", rider_id: "e1" } },
  { km: 140, type: "finish", params: {} },
];
export const STAGE_877_E4_ROWS = finishRows(["e1", "e2", "e3", "e4", "e5", "e6", "e7", "p8", "p9", "p10", "p106", "e107", "p120", "p121", "p141"]);
