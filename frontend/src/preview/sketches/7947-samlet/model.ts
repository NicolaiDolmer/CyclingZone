// #7947 samlet design: den rene model bag skitsen. Ingen React, saa node --test
// kan koere den. Modellen er spillets egen (TRAINING_RULES §datomodellen og
// TrainingPlanCard.tsx PROGRAM_SLOTS): hver dato har FEM felter pr. rytter. Et
// felt er enten et traeningspas, en etape (laast af loebet) eller et pas, der
// allerede er koert efter Traen nu (laast resten af datoen).
// Intet her er produktkode; skitsen gemmer intet.

export const FIELDS_PER_DATE = 5;

export type Session =
  | "rest" | "recovery"
  | "technique" | "aero" | "loebslaere"
  | "endurance" | "tempo"
  | "vo2max" | "vo2max_climb" | "vo2max_punch" | "threshold" | "sprint"
  | "cobbled_sectors" | "echelon_drills" | "attack_repeats";

export type Field =
  | { kind: "train"; session: Session; changed: boolean }
  | { kind: "stage"; label: string }
  | { kind: "done"; session: Session };

export type Level = 0 | 1 | 2 | 3;

// Belastningen er en egenskab ved passet (TRAINING_RULES §3): hvile/restitution,
// let (faerdighed + lang tur), mellem (tempo), haard (resten).
const LEVEL: Record<Session, Level> = {
  rest: 0, recovery: 0,
  technique: 1, aero: 1, loebslaere: 1, endurance: 1,
  tempo: 2,
  vo2max: 3, vo2max_climb: 3, vo2max_punch: 3, threshold: 3, sprint: 3,
  cobbled_sectors: 3, echelon_drills: 3, attack_repeats: 3,
};

export function levelOf(session: Session): Level {
  return LEVEL[session];
}

/** Et felt der stadig kan aendres: hverken etape eller koert. */
export function isOpen(field: Field): field is Extract<Field, { kind: "train" }> {
  return field.kind === "train";
}

export function openCount(fields: readonly Field[]): number {
  return fields.filter(isOpen).length;
}

/**
 * Det almindelige valg: eet pas paa alle dagens AABNE felter. Etaper og koerte
 * felter roeres aldrig (samme regel som telefonens Hvile/Restitution/Program i dag).
 */
export function applyWholeDay(fields: readonly Field[], session: Session): Field[] {
  return fields.map((field) => (isOpen(field) ? { kind: "train", session, changed: false } : field));
}

/** Hurtig rettelse af eet felt. Et felt der afviger fra dagens valg er "aendret". */
export function setField(fields: readonly Field[], index: number, session: Session): Field[] {
  const base = dayChoice(fields);
  return fields.map((field, i) => {
    if (i !== index || !isOpen(field)) return field;
    return { kind: "train", session, changed: base !== null && session !== base };
  });
}

/**
 * Dagens valg som eet ord: det pas flest aabne felter har. Uafgjort vinder det
 * foerste felt. Ingen aabne felter (hele dagen er loeb eller koert) = null.
 */
export function dayChoice(fields: readonly Field[]): Session | null {
  const counts = new Map<Session, number>();
  let first: Session | null = null;
  for (const field of fields) {
    if (!isOpen(field)) continue;
    if (first === null) first = field.session;
    counts.set(field.session, (counts.get(field.session) ?? 0) + 1);
  }
  if (first === null) return null;
  let best: Session = first;
  for (const [session, n] of counts) if (n > (counts.get(best) ?? 0)) best = session;
  return best;
}

/**
 * Blandet dag: de aabne felter har forskellige pas. Vaelgeren maa saa ikke vise
 * flertallet som valgt, ellers kan det pas ikke laegges paa alle felter.
 */
export function isMixed(fields: readonly Field[]): boolean {
  return new Set(fields.filter(isOpen).map((f) => f.session)).size > 1;
}

/** Traen nu: alle aabne felter koeres straks; en etape beholder sit felt. */
export function trainNow(fields: readonly Field[]): Field[] {
  return fields.map((field) => (isOpen(field) ? { kind: "done", session: field.session } : field));
}

/** Hvor mange felter rytteren bruger paa loeb i dag. */
export function stageCount(fields: readonly Field[]): number {
  return fields.filter((field) => field.kind === "stage").length;
}

/** Dagens tal til overblikket: mangler plan, loeb, traener, traette. */
export function overviewCounts(
  riders: ReadonlyArray<{ fields: readonly Field[]; hasPlan: boolean; tired: boolean }>,
): { needsPlan: number; racing: number; training: number; tired: number } {
  let needsPlan = 0, racing = 0, training = 0, tired = 0;
  for (const rider of riders) {
    if (!rider.hasPlan) needsPlan += 1;
    if (stageCount(rider.fields) > 0) racing += 1;
    if (rider.fields.some((f) => f.kind !== "stage" && levelOf(f.session) > 0)) training += 1;
    if (rider.tired) tired += 1;
  }
  return { needsPlan, racing, training, tired };
}
