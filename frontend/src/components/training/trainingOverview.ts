// Traeningssidens overblik og dens ene guld-knap (#5485, aendring 1 og 2).
//
// Rene funktioner, saa reglerne kan testes med `node --test` uden en browser.
// Komponenterne (TrainingOverview, TrainingPage) laeser kun resultatet.

// Traethed faar advarselsfarve fra den graense hvor skaderisikoen begynder i
// koden i dag (#5418): backend/lib/riderCondition.js CONDITION_CONFIG
// .injuryFatigueFloor. Mockuppets lavere tal var IKKE en beslutning (ejer-go
// 23/9 paa #5485). Flytter reglen i backend, skal tallet her flytte med.
export const TIRED_FATIGUE_FROM = 70;

export type OverviewFilter = "needsDay" | "racing" | "training" | "tired";

export const OVERVIEW_FILTERS: readonly OverviewFilter[] = ["needsDay", "racing", "training", "tired"];

export type OverviewDayType = "rest" | "recovery" | "training" | "skill" | null;

export type OverviewInput = {
  riderIds: readonly string[];
  // Har rytteren en dag (en plan med fokus)? Uden dag taeller han som "mangler en dag".
  hasDay: (riderId: string) => boolean;
  // Koerer rytteren loeb i dag? Loeb slaar traening (realisme-reglen, ejer 18/9).
  isRacing: (riderId: string) => boolean;
  dayType: (riderId: string) => OverviewDayType;
  fatigue: (riderId: string) => number | null | undefined;
};

export type Overview = {
  needsDay: string[];
  racing: string[];
  training: string[];
  tired: string[];
  resting: number;
  recovering: number;
};

export function isTired(fatigue: number | null | undefined): boolean {
  return Number.isFinite(fatigue) && Number(fatigue) >= TIRED_FATIGUE_FROM;
}

export function buildOverview({ riderIds, hasDay, isRacing, dayType, fatigue }: OverviewInput): Overview {
  const out: Overview = { needsDay: [], racing: [], training: [], tired: [], resting: 0, recovering: 0 };
  for (const id of riderIds) {
    const racing = isRacing(id);
    if (!hasDay(id)) out.needsDay.push(id);
    if (racing) out.racing.push(id);
    else if (hasDay(id)) {
      const type = dayType(id);
      if (type === "training" || type === "skill") out.training.push(id);
      else if (type === "rest") out.resting += 1;
      else if (type === "recovery") out.recovering += 1;
    }
    if (isTired(fatigue(id))) out.tired.push(id);
  }
  return out;
}

// Id'erne et tryk paa en overbliks-celle filtrerer tabellen til. `null` = alle.
export function idsForFilter(overview: Overview, filter: OverviewFilter | null): Set<string> | null {
  if (!filter) return null;
  return new Set(overview[filter]);
}

// ── Guld-knappen (A2, ejer-go 23/9) ─────────────────────────────────────────
//
// EEN guld-knap der skifter med situationen og aldrig staar graa:
//   * ryttere mangler en dag      -> "Set days for N riders"
//   * ellers, dagen kan koeres    -> "Run today's training now"
//   * dagen er koert / kan ikke   -> ingen knap, kun en statuslinje
// "Kan ikke" daekker #4847's dayClose-gate (loebsdags-ticket venter paa dagens
// sidste loeb) og en slukket traening. #3643/PR #5552: gaten skal gaelde paa
// ALLE flader; den bor derfor her, eet sted.
export type PrimaryAction = { kind: "setDays"; riders: number } | { kind: "run" } | { kind: "none" };

export function primaryActionFor({
  needsDay,
  trainedToday,
  enabled,
  dayClose,
}: {
  needsDay: number;
  trainedToday: boolean;
  enabled: boolean;
  // null = training_tick_per_race_day er off (ingen gate).
  dayClose: { open?: boolean | null } | null | undefined;
}): PrimaryAction {
  if (trainedToday) return { kind: "none" };
  if (needsDay > 0) return { kind: "setDays", riders: needsDay };
  if (!enabled) return { kind: "none" };
  if (dayClose && !dayClose.open) return { kind: "none" };
  return { kind: "run" };
}

// Kan dagens traening koeres lige nu? Samme gate som guld-knappens "run", men
// uafhaengigt af om ryttere mangler en dag: overblikkets sekundaere "Run now"
// bruger den, saa spilleren kan koere dagen uden at saette alle dage foerst.
export function canRunToday({
  trainedToday,
  enabled,
  dayClose,
}: {
  trainedToday: boolean;
  enabled: boolean;
  dayClose: { open?: boolean | null } | null | undefined;
}): boolean {
  if (trainedToday || !enabled) return false;
  return !(dayClose && !dayClose.open);
}
