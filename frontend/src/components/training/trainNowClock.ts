/**
 * #6139: HH:MM in game time (Europe/Copenhagen) for "locked since"; null when unknown.
 * Its own module (not TrainNowState.ts) so the race selection panel does not pull the
 * training state module into a shared chunk (bundle budget, #6372).
 */
export function trainNowClock(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Copenhagen" });
}
