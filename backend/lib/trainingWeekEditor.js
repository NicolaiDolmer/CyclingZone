import { PROGRAM_SLOTS, isProgramSession, isValidProgramWeekDays, programSlotForRaceDay } from "./trainingPrograms.js";
import { evaluateFlagStage, readFlagStage } from "./featureStage.js";
import { isEffortLevel, isTrainingEffortLevelsEnabled } from "./trainingEffortLevels.js";

const WEEK_PRIORITY = "training_week_priority";

export async function isWeekPriorityEditorEnabled(supabase, isBetaTester) {
  return evaluateFlagStage(await readFlagStage(supabase, WEEK_PRIORITY), { isBetaTester });
}

export async function weekBlockDayWrite(supabase, body, { enabled, allowsV3, v3Only }) {
  if (body.weekBlock === undefined) return { ok: true, block: null };
  if (!enabled) return { ok: false, status: 409, reason: "feature_disabled" };
  const value = body.weekBlock;
  if (!value || !Array.isArray(value.slots) || value.slots.length !== PROGRAM_SLOTS
    || value.slots.some((session) => !isProgramSession(session))
    || !(value.lockSlot === null || Number.isInteger(value.lockSlot) && value.lockSlot >= 0 && value.lockSlot < PROGRAM_SLOTS)) {
    return { ok: false, status: 400, reason: "invalid_week_block" };
  }
  if (value.slots.some(v3Only) && !(await allowsV3())) return { ok: false, status: 400, reason: "invalid_session" };
  const block = { slots: [...value.slots], lockSlot: value.lockSlot };
  if (value.slotEfforts !== undefined && await isTrainingEffortLevelsEnabled(supabase)) {
    if (!Array.isArray(value.slotEfforts) || value.slotEfforts.length !== PROGRAM_SLOTS
      || value.slotEfforts.some((effort) => effort !== null && !isEffortLevel(effort))) {
      return { ok: false, status: 400, reason: "invalid_effort" };
    }
    block.slotEfforts = [...value.slotEfforts];
  }
  return { ok: true, block };
}

export function setWeekBlockDay(days, weekday, block) {
  const day = { ...days[weekday], ...block };
  if (day.lockSlot == null) delete day.lockSlot;
  const updated = { ...days, [weekday]: day };
  return isValidProgramWeekDays(updated) ? updated : null;
}

export async function loadWeekPrioritySettled({ supabase, teamId, seasonId, tickDate }) {
  const { data: work, error: workError } = await supabase.from("training_date_work")
    .select("game_days").eq("team_id", teamId).eq("season_id", seasonId).eq("tick_date", tickDate).maybeSingle();
  if (workError) throw new Error(`week priority date: ${workError.message}`);
  if (work?.game_days?.length !== PROGRAM_SLOTS) return {};
  const { game_days: gameDays } = work;
  // pagination-safe: one team's roster x five race days.
  const { data, error } = await supabase.from("training_rider_ticks")
    .select("rider_id, game_day, report").eq("team_id", teamId).eq("season_id", seasonId)
    .eq("tick_date", tickDate).in("game_day", gameDays);
  if (error) throw new Error(`week priority receipts: ${error.message}`);
  const out = {};
  for (const { rider_id: id, game_day: day, report } of data ?? []) {
    const slot = programSlotForRaceDay(day, gameDays);
    const target = out[id] ??= {};
    const raced = report?.race_day === true || report?.intensity === "race";
    target[slot] = raced ? null : Number.isInteger(report?.source_slot) ? report.source_slot : slot;
  }
  return out;
}
