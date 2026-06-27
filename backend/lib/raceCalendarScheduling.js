// backend/lib/raceCalendarScheduling.js
// Kalender-rebuild (2026-06-27, prestige/spredning-spec): oversæt packLaneCalendar's placements
// til DB-rækker:
//   - race_stage_schedule: { race_id, stage_number, scheduled_at, game_day }
//   - races.scheduled_for  = løbets første stages scheduled_at
//
// Tids-tildeling: hver etape kører i sin BANE's faste tids-slot (lane → slots[lane]). Et løb i
// bane k kører altid på slots[k] (pænt + forudsigeligt). Antal baner = density = antal slots, så
// der er aldrig flere etaper på en dag end slots (intet overløb til natten). game_day (binding-
// nøglen, inkl. monument-båndet) bevares uændret. REN + deterministisk (ingen Date/random).

// DST-robust dansk-tid.
function copenhagenOffsetMinutes(utcDate) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(utcDate).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour === "24" ? "0" : parts.hour), Number(parts.minute), Number(parts.second),
  );
  return (asUTC - utcDate.getTime()) / 60000;
}
function copenhagenWallClockToUTC(dateStr, hhmm) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
  const offset = copenhagenOffsetMinutes(guess);
  return new Date(guess.getTime() - offset * 60000);
}
function copenhagenDatePlusDays(fromUTC, days) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit" });
  const base = fmt.format(fromUTC);
  const [y, mo, d] = base.split("-").map(Number);
  return fmt.format(new Date(Date.UTC(y, mo - 1, d + days)));
}

// Default-slots = Division 3 (3 baner). Tier-specifikke slots sendes ind af materializeren.
export const DEFAULT_STAGE_SLOTS = Object.freeze(["12:00", "15:00", "18:00"]);

/**
 * @param {{ placements: Array<{id, stagesPlaced: Array<{stage_number, real_day, game_day, lane}>}>,
 *           from?: Date, slots?: string[] }} args
 * @returns {{ raceUpdates: Array<{id, scheduled_for}>, stageRows: Array<{race_id, stage_number, scheduled_at, game_day}> }}
 */
export function buildScheduleRows({ placements = [], from = new Date(), slots = DEFAULT_STAGE_SLOTS } = {}) {
  const slotList = slots.length ? slots : DEFAULT_STAGE_SLOTS;
  const stageRows = [];
  const raceFirst = new Map();
  for (const p of placements) {
    for (const st of p.stagesPlaced) {
      const lane = Number.isFinite(st.lane) ? st.lane : 0;
      const slot = slotList[Math.min(lane, slotList.length - 1)];
      const dateStr = copenhagenDatePlusDays(from, st.real_day + 1);
      const scheduled_at = copenhagenWallClockToUTC(dateStr, slot).toISOString();
      stageRows.push({ race_id: p.id, stage_number: st.stage_number, scheduled_at, game_day: st.game_day });
      const prev = raceFirst.get(p.id);
      if (prev == null || scheduled_at < prev) raceFirst.set(p.id, scheduled_at);
    }
  }
  const raceUpdates = [...raceFirst.entries()].map(([id, scheduled_for]) => ({ id, scheduled_for }));
  return { raceUpdates, stageRows };
}
