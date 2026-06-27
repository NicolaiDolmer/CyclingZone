// backend/lib/raceCalendarScheduling.js
// Kalender-rebuild (2026-06-27): oversæt packDivisionCalendar's placements til DB-rækker:
//   - race_stage_schedule: { race_id, stage_number, scheduled_at, game_day }
//   - races.scheduled_for  = løbets første stages scheduled_at
//
// game_day = pakkerens in-game-dag (binding-nøglen). scheduled_at = real_day mappet til en
// dansk vægur-tid (DST-robust), så ~maxStagesPerRealDay etaper afvikles på samme real-dag på
// adskilte tidspunkter (stageScheduler kører dem i rækkefølge). REN + deterministisk.

// DST-robust dansk-tid (samme to-trins-logik som backfillRaceScheduledFor.js — holdt inline
// for at undgå import-bivirkninger fra dét scripts I/O-del).
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
function hhmmFromMinutes(total) {
  const h = Math.floor(total / 60) % 24, m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * @param {{ placements: Array<{id, stagesPlaced: Array<{stage_number, real_day, game_day}>}>,
 *           from?: Date, baseHour?: number, spacingMinutes?: number }} args
 * @returns {{ raceUpdates: Array<{id, scheduled_for}>, stageRows: Array<{race_id, stage_number, scheduled_at, game_day}> }}
 */
export function buildScheduleRows({ placements = [], from = new Date(), baseHour = 8, spacingMinutes = 60 } = {}) {
  const byDay = new Map();
  for (const p of placements) {
    for (const st of p.stagesPlaced) {
      if (!byDay.has(st.real_day)) byDay.set(st.real_day, []);
      byDay.get(st.real_day).push({ race_id: p.id, stage_number: st.stage_number, game_day: st.game_day });
    }
  }
  const stageRows = [];
  const raceFirst = new Map();
  for (const [day, evs] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
    evs.sort((a, b) => String(a.race_id).localeCompare(String(b.race_id)) || a.stage_number - b.stage_number);
    const dateStr = copenhagenDatePlusDays(from, day + 1);
    evs.forEach((e, idx) => {
      const slot = hhmmFromMinutes(baseHour * 60 + idx * spacingMinutes);
      const scheduled_at = copenhagenWallClockToUTC(dateStr, slot).toISOString();
      stageRows.push({ race_id: e.race_id, stage_number: e.stage_number, scheduled_at, game_day: e.game_day });
      const prev = raceFirst.get(e.race_id);
      if (prev == null || scheduled_at < prev) raceFirst.set(e.race_id, scheduled_at);
    });
  }
  const raceUpdates = [...raceFirst.entries()].map(([id, scheduled_for]) => ({ id, scheduled_for }));
  return { raceUpdates, stageRows };
}
