import { deriveParticipationHistory } from "../../../backend/lib/raceParticipationHistory.ts";
import type { ParticipationEvent, ParticipationHistory, RiderParticipation } from "../../../backend/lib/raceParticipationHistory.ts";

type ResultMarkerRow = { rider_id?: string | null; in_breakaway?: boolean | null; breakaway_caught?: boolean | null; breakaway_dropped?: boolean | null };
type StageTimeline = { timeline_version?: number; stage_number?: number; events?: ParticipationEvent[] } | null;
export type ResultParticipation = RiderParticipation & { verified: boolean };

export function historyForStage(timeline: StageTimeline, stage: number, initialRiderIds: readonly string[] = []): ParticipationHistory | null {
  if (!timeline || timeline.timeline_version !== 2 || timeline.stage_number !== stage || !Array.isArray(timeline.events)) return null;
  const history = deriveParticipationHistory(timeline.events, initialRiderIds);
  const formation = timeline.events.find(event => event.type === "breakaway_formed");
  const fullFormation = !formation || (typeof formation.params?.group_id === "string" && Array.isArray(formation.params?.rider_ids));
  return history.complete && fullFormation ? history : null;
}

export function participationForResult(result: ResultMarkerRow, history: ParticipationHistory | null): ResultParticipation | null {
  if (!result.rider_id) return null;
  // #6185: a persisted "dropped" (engine run or backfill, incl. the finish
  // safety net) is never shown as "held home", with or without a timeline.
  const persistedDropped = result.breakaway_dropped === true;
  if (history) {
    const recorded = history.riders.get(result.rider_id);
    const morning = recorded?.morning ?? false;
    const caught = recorded?.caught ?? false;
    const dropped = morning && !caught && (Boolean(recorded?.dropped) || persistedDropped);
    return { morning, caught, survived: !dropped && (recorded?.survived ?? false), dropped, laterAttack: recorded?.laterAttack ?? false, verified: true };
  }
  const morning = Boolean(result.in_breakaway);
  const caught = morning && Boolean(result.breakaway_caught);
  const dropped = morning && !caught && persistedDropped;
  return { morning, caught, survived: morning && !caught && !dropped, dropped, laterAttack: false, verified: false };
}

type RankedResultRow = ResultMarkerRow & { result_type?: string | null; stage_number?: number | null; rank?: number | null };

/**
 * #6185 finish safety net for stored rows: an escapee who was not caught but
 * has a non-escapee ahead of them in the same stage result can never have
 * held on, so the row is read as dropped. Applied per (result_type,
 * stage_number) group; `rows` must hold complete groups (one fetched stage).
 * Covers rows written before the engine persisted `breakaway_dropped` and
 * every view that has no timeline (yet).
 */
export function withFinishSafetyNet<T extends RankedResultRow>(rows: readonly T[] | null | undefined): T[] {
  if (!rows?.length) return rows ? [...rows] : [];
  const best = new Map<string, number>();
  const keyOf = (row: T) => `${row.result_type ?? ""}|${row.stage_number ?? 1}`;
  for (const row of rows) {
    if (row.result_type !== "stage" && row.result_type !== "gc") continue;
    if (row.in_breakaway || typeof row.rank !== "number") continue;
    const key = keyOf(row);
    if (row.rank < (best.get(key) ?? Infinity)) best.set(key, row.rank);
  }
  return rows.map((row) => {
    if (!row.in_breakaway || row.breakaway_caught === true || row.breakaway_dropped === true || typeof row.rank !== "number") return row;
    const bestRank = best.get(keyOf(row));
    return bestRank !== undefined && row.rank > bestRank ? { ...row, breakaway_dropped: true } : row;
  });
}

/** #6185: which label the morning-break marker shows, and whether it is muted. */
export function breakawayMarkerState(participation: ResultParticipation): { labelKey: string; muted: boolean } {
  if (participation.caught) return { labelKey: "detail.breakaway.caught", muted: true };
  if (participation.dropped) return { labelKey: "detail.breakaway.dropped", muted: true };
  if (participation.verified && !participation.survived) return { labelKey: "detail.breakaway.participated", muted: true };
  return { labelKey: "detail.breakaway.survived", muted: false };
}

export function participationFlagsForResult(result: ResultMarkerRow, history: ParticipationHistory): { in_breakaway: boolean; breakaway_caught: boolean | null; breakaway_dropped: boolean } {
  const participation = participationForResult(result, history);
  return {
    in_breakaway: Boolean(participation?.morning),
    breakaway_caught: participation?.caught ? true : participation?.survived ? false : null,
    breakaway_dropped: Boolean(participation?.dropped),
  };
}
