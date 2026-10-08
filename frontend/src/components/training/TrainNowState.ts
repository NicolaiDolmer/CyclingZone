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
  // #6139: the team's races with a stage today, so the button can say which race selection it locks.
  todayRaces: Array<{ id: string; name: string | null }>;
};

export type TrainNowPressResult = {
  settledRiderIds: string[];
  afterRaceRiderIds: string[];
  settledGameDays?: number[];
};

/**
 * #6006: the press's immediate effect, for "X riders trained now, Y waiting for
 * their race". Null when nothing could settle now (a date with one race day keeps
 * that day for the evening, I4), so the line never claims training that did not run.
 */
export function trainNowPressCounts(result: TrainNowPressResult | null): { trained: number; waiting: number } | null {
  if (!result) return null;
  if (Array.isArray(result.settledGameDays) && result.settledGameDays.length === 0) return null;
  const trained = result.settledRiderIds.length;
  if (!trained) return null;
  return { trained, waiting: result.afterRaceRiderIds.length };
}

export const TRAIN_NOW_OFF: TrainNowStatus = {
  enabled: false, available: false, reason: "flag_off", tickDate: null, locked: false, lockedAt: null, settled: false,
  todayRaces: [],
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
    todayRaces: Array.isArray(d.todayRaces)
      ? d.todayRaces.filter((r): r is { id: string; name: string | null } =>
        !!r && typeof (r as { id?: unknown }).id === "string")
        .map((r) => ({ id: r.id, name: typeof r.name === "string" ? r.name : null }))
      : [],
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
    const counts = trainNowPressCounts(result);
    if (counts) return [counts.waiting > 0 ? "trainNow.pressResult" : "trainNow.pressResultAll", "trainNow.locked"];
    return result && result.afterRaceRiderIds.length > 0
      ? ["trainNow.locked", "trainNow.afterRace"]
      : ["trainNow.locked"];
  }
  if (status.reason === "previous_date_open") return ["trainNow.previousOpen"];
  if (status.reason === "no_race_day_today") return ["trainNow.noRaceDay"];
  return [status.todayRaces.some((r) => r.name) ? "trainNow.helperRace" : "trainNow.helper"];
}

/** #6139: the race names a press locks today, for the helper line ("Tour A, Tour B"). */
export function trainNowRaceNames(status: TrainNowStatus): string {
  return status.todayRaces.map((r) => r.name).filter(Boolean).join(", ");
}

/**
 * #6139: a save refused by the Train now plan lock says so ("today's fields are locked,
 * you can still change tomorrow") instead of the generic "could not save".
 */
export function trainNowSaveErrorKey(error: string | null | undefined, fallbackKey: string): string {
  return error === "train_now_locked" ? "trainNow.planLocked" : fallbackKey;
}
