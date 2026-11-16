// #7947 skitse: indsats foer traening. Ren model, ingen React.
//
// Skitsen aendrer IKKE hvad der gemmes. Planen er stadig (focus, intensity) som
// i dag; indsats og traening er en visning der udledes af parret og skrives
// tilbage til samme par. Saa gemte planer mister ikke deres betydning, og
// serveren kan afvise ugyldige kombinationer paa samme maade som nu.
//
// Hvor aktiv restitution bor er et aabent valg (ejer: aabent punkt). Modellen
// tager derfor `recoveryHome` som parameter, saa varianterne kan vise begge.

import {
  RECOVERY_FOCUS,
  RECOVERY_INTENSITY,
  SESSION_INTENSITY_V3,
  SKILL_SESSIONS,
  TRAINING_SESSIONS_BY_LEVEL_V3,
  dayTypeForProgram,
  sessionForProgram,
} from "../../../lib/trainingDayTypes.js";

export type Effort = "rest" | "easy" | "normal" | "hard";
export type RecoveryHome = "rest" | "easy";
export type Plan = { focus?: string | null; intensity?: string | null } | null | undefined;
export type Choice = { effort: Effort | null; session: string | null };
type Opts = { recoveryHome?: RecoveryHome };

export const EFFORTS: readonly Effort[] = Object.freeze(["rest", "easy", "normal", "hard"] as const);
export const RECOVERY_SESSION = "recovery"; // synlig noegle i valget, ikke en ny session i motoren

const intensityOf = SESSION_INTENSITY_V3 as Record<string, string>;
const byLevel = TRAINING_SESSIONS_BY_LEVEL_V3 as Record<string, readonly string[]>;
const skill = SKILL_SESSIONS as readonly string[];

// Sessioner pr. indsats, i visningsraekkefoelge. Katalog v3 er med, fordi det er
// det katalog skitsen skal kunne rumme; v3 er stadig slukket i spillet.
export function sessionsForEffort(effort: Effort, { recoveryHome = "easy" }: Opts = {}): string[] {
  if (effort === "rest") return recoveryHome === "rest" ? [RECOVERY_SESSION] : [];
  if (effort === "easy") {
    const base = [...byLevel.easy, ...skill];
    return recoveryHome === "easy" ? [RECOVERY_SESSION, ...base] : base;
  }
  if (effort === "normal") return [...byLevel.normal];
  return [...byLevel.hard];
}

export function effortForSession(session: string | null): Effort | null {
  if (!session || session === RECOVERY_SESSION) return null; // afhaenger af recoveryHome, se choiceFromPlan
  const intensity = intensityOf[session];
  if (intensity === "easy" || intensity === "normal" || intensity === "hard") return intensity;
  return null;
}

// Gemt plan -> det valg skitsen viser. Rent udledt, intet skema aendres.
export function choiceFromPlan(plan: Plan, { recoveryHome = "easy" }: Opts = {}): Choice {
  if (!plan || !plan.focus) return { effort: null, session: null };
  const dayType = dayTypeForProgram(plan) as string;
  if (dayType === "rest") return { effort: "rest", session: null };
  if (dayType === "recovery") return { effort: recoveryHome, session: RECOVERY_SESSION };
  const session = sessionForProgram(plan) as string | null;
  return { effort: effortForSession(session), session };
}

// Er (indsats, session) en kombination serveren ville tage imod?
export function isValidChoice(effort: Effort | null, session: string | null, opts: Opts = {}): boolean {
  if (!effort || !EFFORTS.includes(effort)) return false;
  // Hvile er altid gyldig uden session (hel hvile); aktiv restitution kommer
  // kun til som ekstra valg paa den indsats, den bor paa.
  if (effort === "rest" && session == null) return true;
  return session != null && sessionsForEffort(effort, opts).includes(session);
}

// Valg -> plan (focus, intensity). Hvile bevarer det gamle fokus i kolonnen,
// praecis som i dag ("et klik tilbage"), men fokus faar ingen betydning paa hvile.
export function planFromChoice(
  effort: Effort,
  session: string | null,
  { keepFocus = null }: { keepFocus?: string | null } = {},
): { focus: string | null; intensity: string } {
  if (session === RECOVERY_SESSION) return { focus: RECOVERY_FOCUS as string, intensity: RECOVERY_INTENSITY as string };
  if (effort === "rest") return { focus: keepFocus, intensity: "rest" };
  return { focus: session, intensity: intensityOf[session ?? ""] };
}

// Hvad gemte planer ser ud som efter skiftet: bruges af oversigten i skitsen.
export function transitionRow(plan: Plan, opts: Opts = {}) {
  const dayType = dayTypeForProgram(plan) as string;
  const { effort, session } = choiceFromPlan(plan, opts);
  return {
    dayType,
    effort,
    session,
    // Fokus staar kun i kolonnen; paa hvile bevises intet om at det trænes.
    focusIgnored: dayType === "rest" && Boolean(plan?.focus),
  };
}
