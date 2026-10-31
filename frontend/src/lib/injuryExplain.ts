// #7412: skadechippen forklarer skaden. Spillerne kunne se AT en rytter var skadet, men ikke
// hvorfor, hvor eller hvornaar han kan koere igen. "Injured until 2/11" blev laest som "rask
// 2/11"; datoen er sidste SKADEDE dag. Rene funktioner, saa reglen kan testes uden React.

export type CrashOrigin = { race: string | null; stage: number | null; stages: number | null };
export type InjuryCauseMessage = { key: string; params: Record<string, string | number> };

/**
 * Foerste RASKE dag: dagen efter `injured_until` (DATE, inklusiv sidste skadedag).
 * Udtagelses-gaten holder rytteren ude hele `injured_until`, saa datoen her er praecis den
 * dag han kan stille op igen, ogsaa naar varigheden er talt i loebsdage (#5462).
 * @returns "YYYY-MM-DD" eller null
 */
export function injuryFitAgainDate(injuredUntil: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(injuredUntil ?? ""));
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1)).toISOString().slice(0, 10);
}

/**
 * Hvilken aarsags-tekst (noegle i `rider`-namespacet) chippen skal vise.
 * `injury_cause` skrives af motoren: race_crash (styrt), training_overload (traening),
 * illness (syg af ekstrem traethed, #6938). Ukendt/tom aarsag = ingen tekst (en skade fra
 * foer kolonnen fandtes skal ikke faa en opfundet aarsag).
 * `crash` er det seneste skadende styrt (race_incidents), kun brugt naar cause = race_crash.
 */
export function injuryCauseMessage(cause: string | null | undefined, crash: CrashOrigin | null = null): InjuryCauseMessage | null {
  if (cause === "training_overload") return { key: "condition.causeTraining", params: {} };
  if (cause === "illness") return { key: "condition.causeIllness", params: {} };
  if (cause !== "race_crash") return null;
  const race = crash?.race || null;
  if (!race) return { key: "condition.causeCrash", params: {} };
  const stage = Number(crash?.stage);
  // Et endagsloeb har ingen etape at naevne; "stage 1" ville vaere stoej.
  if (Number(crash?.stages) > 1 && Number.isInteger(stage) && stage > 0) {
    return { key: "condition.causeCrashStage", params: { race, stage } };
  }
  return { key: "condition.causeCrashRace", params: { race } };
}
