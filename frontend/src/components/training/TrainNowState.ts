// "Train now" (#4847, design 29/9) - pure state for the training page.
//
// The server decides whether the press exists for the viewer (stage flag
// `training_train_now`, evaluated against beta status). When it does, the page's
// ONE gold button becomes "Train now": it is available the whole date until the
// press or the evening settlement, not only after the last race.

export type TrainNowStatus = {
  enabled: boolean;
  available: boolean;
  reason: string | null;
  tickDate: string | null;
  locked: boolean;
  lockedAt: string | null;
  settled: boolean;
};

export type TrainNowPressResult = {
  settledRiderIds: string[];
  afterRaceRiderIds: string[];
};

export const TRAIN_NOW_OFF: TrainNowStatus = {
  enabled: false, available: false, reason: "flag_off", tickDate: null, locked: false, lockedAt: null, settled: false,
};

// `=== true` everywhere: an older backend without the route gives the old page.
export function parseTrainNowStatus(data: unknown): TrainNowStatus {
  if (!data || typeof data !== "object") return TRAIN_NOW_OFF;
  const d = data as Record<string, unknown>;
  if (d.enabled !== true) return TRAIN_NOW_OFF;
  return {
    enabled: true,
    available: d.available === true,
    reason: typeof d.reason === "string" ? d.reason : null,
    tickDate: typeof d.tickDate === "string" ? d.tickDate : null,
    locked: d.locked === true,
    lockedAt: typeof d.lockedAt === "string" ? d.lockedAt : null,
    settled: d.settled === true,
  };
}

type DayClose = { open?: boolean | null; opensAtHour?: number } | null | undefined;

/**
 * The inputs the page's existing gold-button logic (primaryActionFor/canRunToday)
 * reads. With the press enabled, "trained today" means "the date is decided"
 * and the gate is the press's own availability, not the evening window.
 */
export function trainNowRunGate(
  status: TrainNowStatus,
  fallback: { trainedToday: boolean; dayClose: DayClose },
): { trainedToday: boolean; dayClose: DayClose } {
  if (!status.enabled) return fallback;
  return {
    trainedToday: status.locked || status.settled,
    dayClose: { ...(fallback.dayClose ?? {}), open: status.available },
  };
}

/** Which short line sits under the button. Keys live in training.json `trainNow.*`. */
export function trainNowNoteKeys(
  status: TrainNowStatus,
  result: TrainNowPressResult | null,
  error: string | null,
): string[] {
  if (!status.enabled) return [];
  if (error) {
    if (error === "previous_date_open") return ["trainNow.previousOpen"];
    if (error === "no_race_day_today") return ["trainNow.noRaceDay"];
    if (error === "date_settled") return ["trainNow.settled"];
    return ["trainNow.error"];
  }
  if (status.settled) return ["trainNow.settled"];
  if (status.locked) {
    return result && result.afterRaceRiderIds.length > 0
      ? ["trainNow.locked", "trainNow.afterRace"]
      : ["trainNow.locked"];
  }
  if (status.reason === "previous_date_open") return ["trainNow.previousOpen"];
  if (status.reason === "no_race_day_today") return ["trainNow.noRaceDay"];
  return ["trainNow.helper"];
}
