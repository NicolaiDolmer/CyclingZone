// #6461 B: the one rule the training engine needs from the whole-day press. Its own
// file so dailyTrainingEngine.js can import it without an import cycle.

/**
 * PURE: does this rider wait with this race day?
 * Default (flag off, every caller but the B press): any open race slot on the date
 * waits, exactly the old rule. `settleBeforeUnresolved` (B press only): only an open
 * slot on or before this race day waits, so the training slots before the race settle.
 */
export function riderWaitsForOpenSlot(slots, raceDay, settleBeforeUnresolved = false) {
  const open = slots ?? [];
  if (!settleBeforeUnresolved) return open.length > 0;
  return open.some((slot) => !Number.isInteger(Number(slot?.gameDay)) || Number(slot.gameDay) <= raceDay);
}
