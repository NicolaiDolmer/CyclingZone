// Delt stage-schedule-logik — ÉN kilde for hvordan race_stage_schedule (#1597)
// præsenteres for spilleren: countdown-segmentering + status pr. etape.
//
// ÆRLIGHED: race_stage_schedule bærer KUN ét scheduled_at pr. (race, etape) +
// races.stages_completed (hvor langt løbet er afviklet). Vi viser de FAKTISKE
// lagrede tider — INGEN gæt. "Næste etape" = stages_completed + 1, præcis som
// backend-scheduleren (backend/lib/stageScheduler.js) finder den forfaldne etape.
//
// Ren .js uden JSX/React-imports, så `node --test` kan loade modulet direkte og
// StageScheduleCard kan importere uden bundling-magi.

// IANA-zone for spillets faste etape-slots. Backend lagrer scheduled_at som
// absolut TIMESTAMPTZ; vi RENDERER den eksplicit i København-tid, så en spiller
// i en anden tidszone ser det rigtige slot (#1597 / [[feedback_timezone_copenhagen]]).
export const RACE_TIMEZONE = "Europe/Copenhagen";

// Etape-status set fra stages_completed (løbets fremdrift) + stage_number.
//   done    — etapen er kørt (stage_number <= stages_completed)
//   next    — den førstkommende uafviklede etape (stage_number === completed + 1)
//   pending — en senere uafviklet etape
export function stageStatus(stageNumber, stagesCompleted) {
  const completed = Number.isFinite(stagesCompleted) ? stagesCompleted : 0;
  if (stageNumber <= completed) return "done";
  if (stageNumber === completed + 1) return "next";
  return "pending";
}

// Bryd en positiv ms-difference ned i {days, hours, minutes} til countdown-visning.
// Returnerer null hvis tiden er forbi/nu (<= 0) → kalderen viser "starter nu".
// Minutter rundes OP, så "om 1 min" ikke fejlagtigt bliver "om 0 min" lige før slot.
export function countdownParts(msUntil) {
  if (!Number.isFinite(msUntil) || msUntil <= 0) return null;
  const totalMinutes = Math.ceil(msUntil / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  return { days, hours, minutes };
}

// Vælg de (maks 2) mest betydende countdown-segmenter, så "om 1 dag 3 timer"
// ikke drukner i sekund-præcision. Returnerer en liste af { unit, count } i
// faldende orden; kalderen mapper hver til en i18n-streng.
//   ≥1 dag   → dage + timer
//   ≥1 time  → timer + minutter
//   <1 time  → kun minutter
export function countdownSegments(parts) {
  if (!parts) return [];
  const { days, hours, minutes } = parts;
  if (days > 0) {
    return hours > 0
      ? [{ unit: "days", count: days }, { unit: "hours", count: hours }]
      : [{ unit: "days", count: days }];
  }
  if (hours > 0) {
    return minutes > 0
      ? [{ unit: "hours", count: hours }, { unit: "minutes", count: minutes }]
      : [{ unit: "hours", count: hours }];
  }
  return [{ unit: "minutes", count: Math.max(1, minutes) }];
}

// Hvilken kalenderdag falder scheduled_at på i København-tid, relativt til now?
// Returnerer "today" | "tomorrow" | null (null = brug fuld dato). Sammenligner
// på København-kalenderdage via Intl, så midnat-grænsen er korrekt uanset hvor
// spilleren selv befinder sig.
export function relativeDayKey(scheduledAt, now = new Date(), timeZone = RACE_TIMEZONE) {
  const target = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
  if (Number.isNaN(target.getTime())) return null;
  const dayOf = (d) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d); // "YYYY-MM-DD" i zonen
  const targetDay = dayOf(target);
  const todayDay = dayOf(now);
  if (targetDay === todayDay) return "today";
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (targetDay === dayOf(tomorrow)) return "tomorrow";
  return null;
}
