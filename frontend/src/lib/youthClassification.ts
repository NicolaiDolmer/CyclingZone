// #7031 (ejer 21/10): intet ungdomsklassement i U23- og juniorløb. Alle i feltet er
// i forvejen unge, så klassementet var en kopi af det samlede. Backend skriver det
// ikke længere (raceRunner.youthClassificationRanking); her skjules det også i løb
// der blev afviklet før, så ingen side viser det. Seniorløb er uændrede.

const YOUTH_SQUADS = new Set(["u23", "junior"]);
const YOUTH_RESULT_TYPES = new Set(["young", "young_day"]);

export function raceHasYouthClassification(squad: string | null | undefined): boolean {
  return !YOUTH_SQUADS.has(String(squad ?? ""));
}

export function isHiddenYouthClassificationRow(
  row: { result_type?: string | null } | null | undefined,
  squad: string | null | undefined,
): boolean {
  return !raceHasYouthClassification(squad) && YOUTH_RESULT_TYPES.has(String(row?.result_type ?? ""));
}

export function withoutHiddenYouthClassification<T extends { result_type?: string | null }>(
  rows: T[] | null | undefined,
  squad: string | null | undefined,
): T[] {
  const list = rows ?? [];
  if (raceHasYouthClassification(squad)) return list;
  return list.filter((r) => !YOUTH_RESULT_TYPES.has(String(r?.result_type ?? "")));
}

// Karriere-præstationen "første klassementstrøje" (first_jersey) blev også skrevet
// for ungdomstrøjen i U23-/juniorløb før #7031. Den skjules af samme regel.
export function isHiddenYouthCareerEvent(
  // params er Supabase-Json (løst typet); kun classification læses.
  event: { event_type?: string | null; params?: unknown } | null | undefined,
  squad: string | null | undefined,
): boolean {
  return !raceHasYouthClassification(squad)
    && event?.event_type === "first_jersey"
    && (event?.params as { classification?: unknown } | null | undefined)?.classification === "young";
}
