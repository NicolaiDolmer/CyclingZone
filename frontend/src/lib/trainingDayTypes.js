// Dagstype før session (#3762) — frontendens spejl af backend/lib/trainingDayTypes.js.
//
// Fladen SKAL kunne det samme som serveren her: udlede hvilken dag en gemt plan
// er, og hvilke sessioner der findes på en dagstype. Ellers kan panelet tilbyde
// noget serveren afviser, eller vise en umigreret plan som en tilstand der ikke
// findes.
//
// Værdierne holdes i sync af en drift-vagt der importerer BEGGE moduler og
// sammenligner tallene (backend/lib/handheldCopyGuards.test.js, #3681-familien),
// ikke af en kommentar der lover det.

export const DAY_TYPES = Object.freeze(["rest", "recovery", "skill", "training"]);
export const SKILL_SESSIONS = Object.freeze(["technique", "aero"]);
export const TRAINING_SESSIONS_BY_LEVEL = Object.freeze({
  easy: Object.freeze(["endurance"]),
  normal: Object.freeze(["tempo"]),
  hard: Object.freeze(["vo2max", "threshold", "sprint"]),
});
export const TRAINING_LEVELS = Object.freeze(Object.keys(TRAINING_SESSIONS_BY_LEVEL));
export const SESSION_INTENSITY = Object.freeze({
  technique: "easy",
  aero: "easy",
  endurance: "easy",
  tempo: "normal",
  vo2max: "hard",
  threshold: "hard",
  sprint: "hard",
});
export const RECOVERY_FOCUS = "restitution";
export const RECOVERY_INTENSITY = "recovery";

// Dagstyper uden et trin 2. De ER hele dagen.
export const DAY_TYPES_WITHOUT_SESSION = Object.freeze(["rest", "recovery"]);

export function dayTypeForProgram(program) {
  const focus = program?.focus ?? null;
  const intensity = program?.intensity ?? null;
  if (intensity === "rest") return "rest";
  if (intensity === RECOVERY_INTENSITY || focus === RECOVERY_FOCUS) return "recovery";
  if (SKILL_SESSIONS.includes(focus)) return "skill";
  return "training";
}

export function sessionForProgram(program) {
  const dayType = dayTypeForProgram(program);
  if (DAY_TYPES_WITHOUT_SESSION.includes(dayType)) return null;
  return program?.focus ?? null;
}

export function sessionsForDayType(dayType) {
  if (dayType === "skill") return SKILL_SESSIONS;
  if (dayType === "training") return TRAINING_LEVELS.flatMap((level) => TRAINING_SESSIONS_BY_LEVEL[level]);
  return [];
}

export function levelForSession(session) {
  for (const level of TRAINING_LEVELS) {
    if (TRAINING_SESSIONS_BY_LEVEL[level].includes(session)) return level;
  }
  return null;
}

// Rækkerne trin 2 tegner for en dagstype, grupperet efter niveau.
// Returnerer [{ level, sessions:[...] }] — for færdighedsdage er level null,
// fordi de ikke ligger på et belastnings-niveau (det er hele deres pointe).
export function sessionGroupsForDayType(dayType) {
  if (dayType === "skill") return [{ level: null, sessions: [...SKILL_SESSIONS] }];
  if (dayType !== "training") return [];
  return TRAINING_LEVELS.map((level) => ({ level, sessions: [...TRAINING_SESSIONS_BY_LEVEL[level]] }));
}

// Er en gemt plan allerede på modellens form? Bruges til at markere de planer
// der endnu ikke er migreret, så fladen kan vise dem som dét de BLIVER.
export function isCanonicalProgram(program) {
  const dayType = dayTypeForProgram(program);
  if (dayType === "rest") return program?.intensity === "rest";
  if (dayType === "recovery") {
    return program?.focus === RECOVERY_FOCUS && program?.intensity === RECOVERY_INTENSITY;
  }
  const session = sessionForProgram(program);
  return SESSION_INTENSITY[session] === program?.intensity;
}
