// Resume only durable, stamped free slots before the race loads entrant abilities.
// Reuses the registered frozen roster; no flag read, new freeze, or manager request.
import { loadTrainNowFrozenDateSlots, loadTrainNowInstantRiderIds } from "./trainNowLock.js";
import { loadStageStart } from "./riderFatigueNow.js";
import { fetchAllRows, SUPABASE_IN_CHUNK_SIZE } from "./supabasePagination.js";
import { trainingDateDeadline } from "./trainingDateReadiness.js";

async function checked(query, source) {
  const { data, error } = await query;
  if (error || !Array.isArray(data)) throw new Error(source + ": " + (error?.message ?? "missing rows"));
  return data;
}

export async function recoverInstantTrainingBeforeStage({ supabase, raceId, stageNumber, seasonId, seasonNumber, now }) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("instant recovery requires now");
  const start = await loadStageStart({ supabase, raceId, stageNumber });
  if (!start) return;
  const frozen = await loadTrainNowFrozenDateSlots({ supabase, seasonId, tickDate: start.tickDate });
  const ids = frozen.filter(row => row.slots.some(slot => slot.raceId === raceId)).map(row => row.rider_id);
  if (!ids.length) return;
  const stamped = new Set();
  for (let i = 0; i < ids.length; i += SUPABASE_IN_CHUNK_SIZE) {
    for (const id of await loadTrainNowInstantRiderIds({ supabase, riderIds: ids.slice(i, i + SUPABASE_IN_CHUNK_SIZE), tickDate: start.tickDate })) stamped.add(id);
  }
  if (!stamped.size) return;
  const locks = await fetchAllRows(() => supabase.from("training_train_now_locks")
    .select("rider_id, team_id").eq("season_id", seasonId).eq("tick_date", start.tickDate).order("rider_id"));
  const { runTeamTrainingDay } = await import("./dailyTrainingEngine.js");
  for (const teamId of new Set(locks.filter(row => stamped.has(row.rider_id)).map(row => row.team_id))) {
    // pagination-safe: one exact frozen team/season/date work key.
    const workRows = await checked(supabase.from("training_date_work").select("*")
      .eq("team_id", teamId).eq("season_id", seasonId).eq("tick_date", start.tickDate), "instant recovery work");
    const work = workRows[0];
    if (workRows.length !== 1 || !Array.isArray(work.game_days) || work.game_days.length !== 5
      || !Array.isArray(work.expected_rider_ids)) throw new Error("instant recovery requires frozen work");
    if (work.status === "complete" || work.status === "needs_reconciliation") continue;
    const riders = locks.filter(row => row.team_id === teamId && stamped.has(row.rider_id)
      && work.expected_rider_ids.includes(row.rider_id) && !(work.quarantined_rider_ids ?? []).includes(row.rider_id));
    const slots = Object.fromEntries(riders.map(row => [row.rider_id, frozen.find(f => f.rider_id === row.rider_id).slots]));
    if (Object.values(slots).some(list => list.some(slot => !Number.isInteger(Number(slot.gameDay))
      || !work.game_days.includes(Number(slot.gameDay))))) throw new Error("instant recovery requires known frozen slots");
    // pagination-safe: one frozen team roster times five date slots.
    const receipts = await checked(supabase.from("training_rider_ticks").select("rider_id, game_day")
      .eq("season_id", seasonId).eq("tick_date", start.tickDate).eq("team_id", teamId), "instant recovery receipts");
    for (const gameDay of [...work.game_days].sort((a, b) => a - b)) {
      const eligibleRiderIds = riders.filter(row => !slots[row.rider_id].some(slot => Number(slot.gameDay) === gameDay)
        && !receipts.some(receipt => receipt.rider_id === row.rider_id && Number(receipt.game_day) === gameDay)).map(row => row.rider_id);
      if (!eligibleRiderIds.length) continue;
      await runTeamTrainingDay({ supabase, teamId, seasonId, seasonNumber, now,
        tickDateOverride: start.tickDate, gameDay, dateGameDays: work.game_days,
        executedBy: "assistant", eligibleRiderIds, unresolvedSlotsByRider: slots, instantPress: true,
        deadlineAt: trainingDateDeadline(start.tickDate).toISOString(), deadlineReached: false });
    }
  }
}
