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
