// #5843: ungdomsløbenes kalender og resultater (U23-/Junior-siderne).
//
// Ren model, ingen I/O: tager løbene i holdets ungdomspulje, deres etape-slots
// og holdets egne entries, og deler dem i Calendar (ikke afsluttet, stigende
// start) og Results (afsluttet, nyeste først). Selve udtagelsen sker på den
// eksisterende løbsside (/races/:id → Hold-fanen), præcis som for seniorløb.
export interface YouthRaceRow {
  id: string;
  name: string;
  race_type: string | null;
  stages: number | null;
  stages_completed: number | null;
  status: string | null;
}

export interface YouthScheduleRow {
  race_id: string;
  stage_number: number | null;
  scheduled_at: string | null;
}

export interface YouthEntryRow {
  race_id: string;
  is_auto_filled: boolean | null;
}

export type YouthSelectionState = "manual" | "auto" | "none";

export interface YouthRaceItem {
  id: string;
  name: string;
  stages: number;
  stagesCompleted: number;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  riders: number;
  selection: YouthSelectionState;
}

function selectionState(entries: YouthEntryRow[]): YouthSelectionState {
  if (!entries.length) return "none";
  return entries.every((e) => e.is_auto_filled) ? "auto" : "manual";
}

export function buildYouthRaceItems(
  races: YouthRaceRow[],
  schedule: YouthScheduleRow[],
  entries: YouthEntryRow[],
): { calendar: YouthRaceItem[]; results: YouthRaceItem[] } {
  const slots = new Map<string, string[]>();
  for (const s of schedule) {
    if (!s.scheduled_at) continue;
    const list = slots.get(s.race_id) ?? [];
    list.push(s.scheduled_at);
    slots.set(s.race_id, list);
  }
  const entriesByRace = new Map<string, YouthEntryRow[]>();
  for (const e of entries) {
    const list = entriesByRace.get(e.race_id) ?? [];
    list.push(e);
    entriesByRace.set(e.race_id, list);
  }

  const items: YouthRaceItem[] = races.map((r) => {
    const times = (slots.get(r.id) ?? []).slice().sort();
    const own = entriesByRace.get(r.id) ?? [];
    return {
      id: r.id,
      name: r.name,
      stages: r.stages ?? 1,
      stagesCompleted: r.stages_completed ?? 0,
      status: r.status ?? "scheduled",
      startsAt: times[0] ?? null,
      endsAt: times[times.length - 1] ?? null,
      riders: own.length,
      selection: selectionState(own),
    };
  });

  const byStart = (a: YouthRaceItem, b: YouthRaceItem) =>
    String(a.startsAt ?? "9999").localeCompare(String(b.startsAt ?? "9999")) || a.name.localeCompare(b.name);
  const calendar = items.filter((i) => i.status !== "completed").sort(byStart);
  const results = items.filter((i) => i.status === "completed").sort((a, b) => byStart(b, a));
  return { calendar, results };
}

/** Kan manageren stadig ændre truppen? Samme gate som PUT /selection: planlagt og ingen etape kørt. */
export function youthSelectionOpen(item: YouthRaceItem): boolean {
  return item.status === "scheduled" && item.stagesCompleted === 0;
}
