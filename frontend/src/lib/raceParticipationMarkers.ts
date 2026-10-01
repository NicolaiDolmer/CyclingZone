import { deriveParticipationHistory } from "../../../backend/lib/raceParticipationHistory.ts";
import type { ParticipationEvent, ParticipationHistory, RiderParticipation } from "../../../backend/lib/raceParticipationHistory.ts";

type ResultMarkerRow = { rider_id?: string | null; in_breakaway?: boolean | null; breakaway_caught?: boolean | null };
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
  if (history) {
    const recorded = history.riders.get(result.rider_id);
    return { morning: recorded?.morning ?? false, caught: recorded?.caught ?? false, survived: recorded?.survived ?? false, laterAttack: recorded?.laterAttack ?? false, verified: true };
  }
  return { morning: Boolean(result.in_breakaway), caught: Boolean(result.in_breakaway && result.breakaway_caught), survived: Boolean(result.in_breakaway && !result.breakaway_caught), laterAttack: false, verified: false };
}


export function participationFlagsForResult(result: ResultMarkerRow, history: ParticipationHistory): { in_breakaway: boolean; breakaway_caught: boolean | null } {
  const participation = participationForResult(result, history);
  return { in_breakaway: Boolean(participation?.morning), breakaway_caught: participation?.caught ? true : participation?.survived ? false : null };
}
