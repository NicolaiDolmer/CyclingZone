import { deriveParticipationHistory, settleBreakawayOutcome, nonEscapeeAheadByRider } from "../../../backend/lib/raceParticipationHistory.ts";
import type { ParticipationEvent, ParticipationHistory, RiderParticipation } from "../../../backend/lib/raceParticipationHistory.ts";

type ResultMarkerRow = { rider_id?: string | null; in_breakaway?: boolean | null; breakaway_caught?: boolean | null; breakaway_dropped?: boolean | null };
type StageTimeline = { timeline_version?: number; stage_number?: number; events?: ParticipationEvent[] } | null;
type FinishRow = { rider_id?: string | null; rank?: number | null };
export type ResultParticipation = Omit<RiderParticipation, "swallowed"> & { verified: boolean };
/**
 * A stage's projected history plus, when the stage's finish order was given,
 * per rider whether a non-escapee (by the timeline's morning set) finished
 * ahead: the same answer the engine run and the backfill settle with.
 */
export type StageParticipationHistory = ParticipationHistory & { nonEscapeeAhead?: ReadonlyMap<string, boolean> };

export function historyForStage(timeline: StageTimeline, stage: number, initialRiderIds: readonly string[] = [], finishRows: readonly FinishRow[] | null = null): StageParticipationHistory | null {
  if (!timeline || timeline.timeline_version !== 2 || timeline.stage_number !== stage || !Array.isArray(timeline.events)) return null;
  const history = deriveParticipationHistory(timeline.events, initialRiderIds);
  const formation = timeline.events.find(event => event.type === "breakaway_formed");
  const fullFormation = !formation || (typeof formation.params?.group_id === "string" && Array.isArray(formation.params?.rider_ids));
  if (!history.complete || !fullFormation) return null;
  return finishRows?.length ? { ...history, nonEscapeeAhead: nonEscapeeAheadByRider(history, finishRows) } : history;
}

export function participationForResult(result: ResultMarkerRow, history: StageParticipationHistory | null): ResultParticipation | null {
  if (!result.rider_id) return null;
  // #6185: a persisted "dropped" (engine run or backfill, incl. the finish
  // safety net) is never shown as "held home" without a timeline.
  const persistedDropped = result.breakaway_dropped === true;
  if (history) {
    const recorded = history.riders.get(result.rider_id);
    const morning = recorded?.morning ?? false;
    const recordedDropped = recorded?.dropped ?? false;
    // Settle with the SAME rule and the SAME "non-escapee ahead" as the
    // backend (settleBreakawayOutcome + nonEscapeeAheadByRider): true, false
    // or, without the stage's finish order, the persisted net's dropped flag
    // (true) or unknown (null). A timeline "survived" with a non-escapee ahead
    // is caught, so a backfilled breakaway_caught=true never shows as "held
    // home"; a dropped rider never swallowed and with nobody but escapees
    // ahead held home.
    const ahead = history.nonEscapeeAhead?.get(result.rider_id);
    const outcome = settleBreakawayOutcome({
      morning,
      caught: (recorded?.caught ?? false) || (result.breakaway_caught === true && !recordedDropped),
      survived: recorded?.survived ?? false,
      dropped: recordedDropped,
      swallowed: recorded?.swallowed ?? false,
    }, typeof ahead === "boolean" ? ahead : persistedDropped ? true : null);
    return { morning, caught: outcome === "caught", survived: outcome === "survived", dropped: outcome === "dropped", laterAttack: recorded?.laterAttack ?? false, verified: true };
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
 * every view that has no timeline (yet). With a timeline, the page settles on
 * the timeline's own morning set instead (historyForStage `finishRows`): the
 * stored in_breakaway can include later attackers on older v4 stages.
 */
export function withFinishSafetyNet<T extends RankedResultRow>(rows: readonly T[] | null | undefined): Array<T & Pick<ResultMarkerRow, "breakaway_dropped">> {
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

export type BreakawayMarkerIcon = "flag" | "dropped";
export type BreakawayMarkerTone = "accent" | "muted" | "danger";
export type BreakawayMarkerState = { labelKey: string; muted: boolean; icon: BreakawayMarkerIcon; tone: BreakawayMarkerTone };

/**
 * #6185: which label, icon and tone the morning-break marker shows. "Dropped
 * from the break" has its own icon SHAPE (arrow down, not the flag) and the
 * danger tone, so held home / caught / dropped read apart without hover and
 * on touch. Held home = accent flag, caught = muted flag, dropped = red arrow.
 */
export function breakawayMarkerState(participation: ResultParticipation): BreakawayMarkerState {
  if (participation.caught) return { labelKey: "detail.breakaway.caught", muted: true, icon: "flag", tone: "muted" };
  if (participation.dropped) return { labelKey: "detail.breakaway.dropped", muted: true, icon: "dropped", tone: "danger" };
  if (participation.verified && !participation.survived) return { labelKey: "detail.breakaway.participated", muted: true, icon: "flag", tone: "muted" };
  return { labelKey: "detail.breakaway.survived", muted: false, icon: "flag", tone: "accent" };
}

export function participationFlagsForResult(result: ResultMarkerRow, history: StageParticipationHistory): { in_breakaway: boolean; breakaway_caught: boolean | null; breakaway_dropped: boolean } {
  const participation = participationForResult(result, history);
  return {
    in_breakaway: Boolean(participation?.morning),
    breakaway_caught: participation?.caught ? true : participation?.survived ? false : null,
    breakaway_dropped: Boolean(participation?.dropped),
  };
}
