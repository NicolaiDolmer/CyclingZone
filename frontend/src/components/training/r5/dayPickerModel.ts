// #8580 · Dagsvælgeren i I dag R5 (ejer 22/11: A = dagene frem er en oversigt; ændringer
// sker i Program pr. ugedag). Ren model; data fra GET /api/training/programs/forecast/week
// (#8591). Felterne for en dag frem regnes med SAMME funktion som i dag (dayFields) på
// datoens ugedag, med datoens løbs- og hvilefelter fra serveren. Ingen træthed frem (K-7).
import { dayFields, isTraining, STAGE, type Field } from "./todayR5Model.ts";

export type WeekRace = { raceId: string; name: string | null; kind: "stage" | "oneday"; stages: number[]; ownRiders: number };
export type WeekRiderFields = { raceSlots: number[]; restSlots: number[] };
export type WeekDay = {
  date: string;
  weekday: string;
  available: boolean;
  races: WeekRace[];
  riders?: Record<string, WeekRiderFields>;
  today?: unknown;
};
export type WeekResponse = { available: boolean; reason?: string; tickDate?: string; days: WeekDay[] };

export const PICKER_PHONE_VISIBLE = 3;

/** Ugen kan vises, når serveren har svaret med mindst én dag frem. */
export function weekUsable(week: WeekResponse | null | undefined): week is WeekResponse {
  return !!week && week.available === true && Array.isArray(week.days) && week.days.length > 1;
}

/** Hvilke datoer telefonen viser: tre ad gangen med den valgte i midten, hvor muligt. */
export function pickerWindow(selected: number, count: number, phone: boolean): number[] {
  if (!phone || count <= PICKER_PHONE_VISIBLE) return Array.from({ length: count }, (_, i) => i);
  const first = Math.max(0, Math.min(selected - 1, count - PICKER_PHONE_VISIBLE));
  return Array.from({ length: PICKER_PHONE_VISIBLE }, (_, i) => first + i);
}

/** Datoens løb, som holdet har ryttere med i (divisionens øvrige løb er ikke holdets dag). */
export function ownRaces(day: WeekDay | null | undefined): WeekRace[] {
  return (day?.races ?? []).filter((race) => race.ownRiders > 0);
}

/** Chip-ordet for datoen: holdets løb (etape før endagsløb), ellers træning. */
export function dayKind(day: WeekDay | null | undefined): { kind: "stage" | "oneday" | "training"; stage: number | null; name: string | null } {
  const races = ownRaces(day);
  const stage = races.find((race) => race.kind === "stage");
  if (stage) return { kind: "stage", stage: stage.stages[0] ?? null, name: stage.name };
  const one = races.find((race) => race.kind === "oneday");
  if (one) return { kind: "oneday", stage: null, name: one.name };
  return { kind: "training", stage: null, name: null };
}

/**
 * En rytters fem felter på en dag frem: løb fra serveren, hvile (bundet uden etape eller
 * skadet) fra serveren, ellers planens pas for datoens ugedag (samme dayFields som i dag).
 */
export function futureFields({
  programSlot, planSession, fields,
}: {
  programSlot: (slot: number) => string | null;
  planSession: string | null;
  fields: WeekRiderFields | null | undefined;
}): Field[] {
  const raceSlots = new Set(fields?.raceSlots ?? []);
  const rest = new Set(fields?.restSlots ?? []);
  return dayFields({ programSlot, planSession, raceSlots }).map((field, slot) => (rest.has(slot) && !raceSlots.has(slot) ? "rest" : field));
}

/**
 * Overblikket for en dag frem, med samme regel som I dag-fanens overblik (isTraining):
 * kører løb = mindst ét løbsfelt; træner = ingen løb og mindst ét rigtigt træningspas
 * (hvile, restitution og tomme felter tæller ikke). Codex P2 #8594.
 */
export function futureCounts(rows: ReadonlyArray<{ fields: Field[] }>): { training: number; racing: number } {
  let racing = 0;
  let training = 0;
  for (const row of rows) {
    const racingRow = row.fields.includes(STAGE);
    if (racingRow) racing += 1;
    else if (isTraining({ racing: false, fields: row.fields })) training += 1;
  }
  return { training, racing };
}
