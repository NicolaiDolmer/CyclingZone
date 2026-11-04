// backend/lib/raceCalendarScheduling.ts
// Kalender-rebuild (2026-06-27, prestige/spredning-spec): oversæt packLaneCalendar's placements
// til DB-rækker:
//   - race_stage_schedule: { race_id, stage_number, scheduled_at, game_day }
//   - races.scheduled_for  = løbets første stages scheduled_at
//
// Tids-tildeling: hver etape kører i sin BANE's faste tids-slot (lane → slots[lane]). Et løb i
// bane k kører altid på slots[k] (pænt + forudsigeligt). Antal baner = density = antal slots, så
// der er aldrig flere etaper på en dag end slots (intet overløb til natten). game_day (binding-
// nøglen, inkl. monument-båndet) bevares uændret. Deterministisk ved eksplicit from.

type RaceId = string | number;
type PlacedStage = {
  stage_number: number;
  real_day: number;
  game_day: number;
  lane?: number;
};
type Placement = { id: RaceId; stagesPlaced: readonly PlacedStage[] };
type StageSlots = readonly string[] | ((localDate: string) => readonly string[] | null | undefined);
type StageScheduleRow = {
  race_id: RaceId;
  stage_number: number;
  scheduled_at: string;
  game_day: number;
};

// DST-robust dansk-tid.
function copenhagenOffsetMinutes(utcDate: Date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Copenhagen",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts: Partial<Record<string, string>> = Object.fromEntries(
    fmt.formatToParts(utcDate).map((p) => [p.type, p.value])
  );
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === "24" ? "0" : parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return (asUTC - utcDate.getTime()) / 60000;
}
function copenhagenWallClockToUTC(dateStr: string, hhmm: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
  const offset = copenhagenOffsetMinutes(guess);
  return new Date(guess.getTime() - offset * 60000);
}
function copenhagenDatePlusDays(fromUTC: Date, days: number) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Copenhagen",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const base = fmt.format(fromUTC);
  const [y, mo, d] = base.split("-").map(Number);
  return fmt.format(new Date(Date.UTC(y, mo - 1, d + days)));
}

// Default-slots = Division 3 (3 baner). Tier-specifikke slots sendes ind af materializeren.
export const DEFAULT_STAGE_SLOTS = Object.freeze(["12:00", "15:00", "18:00"]);

/**
 *   slots: én liste for alle dage, ELLER en funktion af den danske kalenderdato (#5592:
 *   sæsonens sidste og første løbsdag har andre klokkeslæt, se calendarPlanningWindow.slotsFor).
 */
export function buildScheduleRows({
  placements = [],
  from = new Date(),
  slots = DEFAULT_STAGE_SLOTS,
}: { placements?: readonly Placement[]; from?: Date; slots?: StageSlots } = {}) {
  // Indsnævret FØR closuren, så tsc ved at kaldet er en funktion (#5158-ratchet'en).
  const slotFn = typeof slots === "function" ? slots : null;
  const fixed =
    typeof slots === "function" ? DEFAULT_STAGE_SLOTS : slots.length ? slots : DEFAULT_STAGE_SLOTS;
  const slotListFor = (dateStr: string) => {
    if (!slotFn) return fixed;
    const list = slotFn(dateStr);
    return list?.length ? list : DEFAULT_STAGE_SLOTS;
  };
  const stageRows: StageScheduleRow[] = [];
  const raceFirst = new Map<RaceId, string>();
  for (const p of placements) {
    for (const st of p.stagesPlaced) {
      const lane = Number.isFinite(st.lane) ? (st.lane as number) : 0;
      const dateStr = copenhagenDatePlusDays(from, st.real_day + 1);
      const slotList = slotListFor(dateStr);
      const slot = slotList[Math.min(lane, slotList.length - 1)];
      const scheduled_at = copenhagenWallClockToUTC(dateStr, slot).toISOString();
      stageRows.push({
        race_id: p.id,
        stage_number: st.stage_number,
        scheduled_at,
        game_day: st.game_day,
      });
      const prev = raceFirst.get(p.id);
      if (prev == null || scheduled_at < prev) raceFirst.set(p.id, scheduled_at);
    }
  }
  const raceUpdates = [...raceFirst.entries()].map(([id, scheduled_for]) => ({
    id,
    scheduled_for,
  }));
  return { raceUpdates, stageRows };
}
