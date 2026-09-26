// Traeningsprogrammer pr. loebsdag (#4629, ejer-go til BETA 26/9) — RENE funktioner.
//
// ═══ HVAD ET PROGRAM ER ═════════════════════════════════════════════════════
// En navngivet 7-dages skabelon: EEN session pr. ugedag (TRAINING_RULES §3:
// intensiteten er en egenskab ved sessionen, ikke et valg). Formen er laast
// 15/9 (TRAINING_RULES §13.3 beslutning 8): 7 ugedage x 5 loebsdage = 35
// celler. Ugedagens session fylder de 5 loebsdags-slots som default, og
// spilleren overstyrer enkelte celler.
//
// ═══ DE TRE LAASTE EJER-VALG 26/9 ═══════════════════════════════════════════
//   1. KOPI ved tildeling. Programmet kopieres ind i rytterens plan
//      (training_week_plans.days). `program_key` er KUN proveniens: en senere
//      rettelse af kataloget her flytter ALDRIG en allerede tildelt plan. Kun
//      spillerens eget klik aendrer planen (postmortem #2438).
//   2. Loeb er loeb. Programmet baerer ingen loebs-intention. Paa en loebsdag
//      hvor rytteren koerer, springer motoren programmets session over (samme
//      gren som i dag: `racedToday` / `boundRestToday` i dailyTrainingEngine.js).
//   3. Kataloget er KONFIGURATION. Listen herunder er ejerens godkendte 22
//      (issue #4629, kommentar 26/9) og justeres under betaen. Fladen henter den
//      fra API'et; den er ikke haardkodet i UI'et.
//
// ═══ DATAFORMEN I training_week_plans.days ═════════════════════════════════
//   { mon: { session: "sprint", intensity: "hard", slots?: [null, "recovery", null, null, null] }, ... }
//
//   session   : ugedagens session (ALL_SESSIONS + "rest"/"recovery").
//   intensity : AFLEDT af sessionen. Den staar der bevidst: raekken er dermed
//               ogsaa en gyldig gammeldags ugerytme, saa den gamle laesesti
//               (resolveDayIntensity, flaget off) aldrig moeder en raekke den
//               ikke kan laese. Flaget off = motoren laeser praecis som i dag.
//   slots     : valgfri, laengde <= PROGRAM_SLOTS. null = foelg ugedagen.
//
// Gamle raekker (kun `intensity`, #1895) er uroerte og laeses praecis som i dag.

import {
  ALL_SESSIONS, SESSION_INTENSITY, RECOVERY_INTENSITY, programForChoice, dayTypeForProgram,
} from "./trainingDayTypes.js";
import { WEEKDAY_KEYS, resolveDayIntensity, isValidIntensity } from "./training.js";

// Loebsdage pr. kalenderdato (CALENDAR_RULES §1e-b: 5 paa HVER dato, alle
// divisioner). Det er gitterets bredde, ikke en balance-konstant.
export const PROGRAM_SLOTS = 5;

// Hele-dags-tilstande der ogsaa kan staa i en celle.
export const WHOLE_DAY_SESSIONS = Object.freeze(["rest", "recovery"]);
export const PROGRAM_SESSIONS = Object.freeze([...WHOLE_DAY_SESSIONS, ...ALL_SESSIONS]);

export function isProgramSession(session) {
  return typeof session === "string" && PROGRAM_SESSIONS.includes(session);
}

// Sessionens faste intensitet (hvile/restitution er deres egen).
export function intensityForSession(session) {
  if (session === "rest") return "rest";
  if (session === "recovery") return RECOVERY_INTENSITY;
  return SESSION_INTENSITY[session] ?? null;
}

// Hvem programmet er tænkt til. Rytter-typer bruger RIDER_TYPE_KEYS
// (PROGRESSION_RULES §2); `audience` er en kort i18n-noegle for de programmer
// der ikke er bundet til en type.
const P = (key, nameEn, nameDa, taglineEn, taglineDa, targetTypes, audience, week) => Object.freeze({
  key,
  nameEn,
  nameDa,
  taglineEn,
  taglineDa,
  targetTypes: Object.freeze(targetTypes),
  audience,
  days: Object.freeze(Object.fromEntries(WEEKDAY_KEYS.map((weekday, i) => [weekday, week[i]]))),
});

// Ejer-godkendt 26/9 (issue #4629). Uge = man..soen.
export const TRAINING_PROGRAMS = Object.freeze([
  P("sprinter", "Sprinter", "Sprinter",
    "Sprint twice a week with easy days in between, so the finish stays fast.",
    "Sprint to gange om ugen med rolige dage imellem, så afslutningen forbliver hurtig.",
    ["sprinter"], null,
    ["sprint", "endurance", "echelon_drills", "recovery", "sprint", "endurance", "rest"]),
  P("hill_climber", "Hill climber", "Bakkerytter",
    "Climbing intervals three times a week for riders who win uphill.",
    "Klatreintervaller tre gange om ugen til ryttere der vinder op ad bakke.",
    ["climber"], null,
    ["vo2max", "vo2max_climb", "recovery", "vo2max", "vo2max_climb", "endurance", "rest"]),
  P("cobbles_rider", "Cobbles rider", "Brostensrytter",
    "Three technique days, two long rides and one hard day on the cobbles.",
    "Tre teknikdage, to lange ture og én hård dag på brostenene.",
    ["brosten"], null,
    ["technique", "endurance", "technique", "endurance", "technique", "cobbled_sectors", "rest"]),
  P("gc_rider", "GC rider", "GC-rytter",
    "Intervals, threshold and climbing for riders who have to last three weeks.",
    "Intervaller, tærskel og klatring til ryttere der skal holde i tre uger.",
    ["gc"], null,
    ["vo2max", "threshold", "vo2max_climb", "recovery", "vo2max", "endurance", "rest"]),
  P("all_rounder", "All-rounder", "Rouleur",
    "Tempo, aero and crosswind work for the rider who does a bit of everything.",
    "Tempo, aero og sidevind til rytteren der kan lidt af det hele.",
    ["rouleur"], null,
    ["tempo", "aero", "echelon_drills", "threshold", "recovery", "endurance", "rest"]),
  P("puncheur", "Puncheur", "Puncheur",
    "Short, hard efforts for steep finishes and late attacks.",
    "Korte, hårde tag til stejle afslutninger og sene angreb.",
    ["puncheur"], null,
    ["vo2max_punch", "attack_repeats", "recovery", "vo2max", "attack_repeats", "endurance", "rest"]),
  P("breakaway", "Breakaway rider", "Baroudeur",
    "Threshold, race craft and attacks for riders who go early.",
    "Tærskel, løbslære og angreb til ryttere der kører tidligt væk.",
    ["baroudeur"], null,
    ["threshold", "loebslaere", "endurance", "attack_repeats", "recovery", "tempo", "rest"]),
  P("classics", "Classics rider", "Klassikerrytter",
    "Cobbles, crosswinds and punch for the one-day races in spring.",
    "Brosten, sidevind og punch til forårets endagsløb.",
    ["brosten", "puncheur"], null,
    ["cobbled_sectors", "endurance", "echelon_drills", "recovery", "vo2max_punch", "tempo", "rest"]),
  P("time_trial", "Time triallist", "TT-specialist",
    "Threshold and aero position for the race against the clock.",
    "Tærskel og aerostilling til løbet mod uret.",
    ["tt"], null,
    ["threshold", "aero", "recovery", "threshold", "endurance", "echelon_drills", "rest"]),
  P("build_base", "Build base", "Byg base",
    "Long, easy volume that builds the foundation for everything else.",
    "Lange, rolige kilometer der bygger fundamentet til alt det andet.",
    [], "all",
    ["endurance", "technique", "endurance", "recovery", "endurance", "tempo", "rest"]),
  P("recovery_week", "Recovery week", "Restitutionsuge",
    "A light week that brings fatigue down before the next block.",
    "En let uge der får trætheden ned før næste blok.",
    [], "all",
    ["recovery", "recovery", "technique", "recovery", "rest", "recovery", "rest"]),
  P("technical_focus", "Technical focus", "Teknisk fokus",
    "Technique, aero and race craft, light on the legs.",
    "Teknik, aero og løbslære, let for benene.",
    [], "allYouth",
    ["technique", "aero", "loebslaere", "technique", "recovery", "endurance", "rest"]),
  P("balanced_week", "Balanced week", "Afbalanceret uge",
    "A bit of everything: endurance, technique, tempo and one interval day.",
    "Lidt af det hele: udholdenhed, teknik, tempo og én intervaldag.",
    [], "all",
    ["endurance", "technique", "tempo", "recovery", "vo2max", "endurance", "rest"]),
  P("hard_block", "Hard block", "Hård blok",
    "A demanding week of intervals and threshold for riders in good shape.",
    "En krævende uge med intervaller og tærskel til ryttere i god form.",
    [], "experienced",
    ["vo2max", "threshold", "recovery", "vo2max", "recovery", "tempo", "rest"]),
  P("active_recovery", "Active recovery block", "Aktiv restitutionsblok",
    "Mostly recovery rides with a few light days to keep the legs moving.",
    "Mest restitution med et par lette dage, så benene bliver ved med at køre.",
    [], "all",
    ["recovery", "endurance", "recovery", "technique", "recovery", "endurance", "rest"]),
  P("youth_development", "Youth development", "Ungdomsopbygning",
    "Skills and endurance first, no hard days.",
    "Færdigheder og udholdenhed først, ingen hårde dage.",
    [], "youth",
    ["technique", "endurance", "aero", "endurance", "loebslaere", "tempo", "rest"]),
  P("peak_week", "Peak week", "Topformuge",
    "Sharpen with intervals, then rest before the goal race.",
    "Skærp med intervaller, og hvil så før målløbet.",
    [], "all",
    ["vo2max", "recovery", "threshold", "recovery", "rest", "tempo", "rest"]),
  P("every_other_day", "Every other day", "Hver anden dag",
    "Hard and easy days in turn, so every hard day starts fresh.",
    "Hårde og lette dage på skift, så hver hård dag starter frisk.",
    [], "all",
    ["vo2max", "recovery", "threshold", "recovery", "vo2max", "endurance", "rest"]),
  P("race_rest", "Race rest", "Løbshvile",
    "Mostly rest for riders with many race days in their legs.",
    "Mest hvile til ryttere med mange løbsdage i benene.",
    [], "manyRaceDays",
    ["rest", "recovery", "vo2max", "rest", "endurance", "rest", "recovery"]),
  P("six_and_one", "Six and one", "Seks-og-én",
    "Six training days and one rest day for young talents with few races.",
    "Seks træningsdage og én hviledag til unge talenter med få løb.",
    [], "youngStars",
    ["vo2max", "threshold", "vo2max", "tempo", "vo2max", "endurance", "rest"]),
  P("veteran_maintenance", "Veteran maintenance", "Veteranvedligehold",
    "More rest and steady work to keep an older rider going.",
    "Mere hvile og jævnt arbejde, så en ældre rytter holder niveauet.",
    [], "veterans",
    ["rest", "endurance", "threshold", "recovery", "endurance", "rest", "recovery"]),
  P("youth_push", "Youth push", "Ungdomsfremdrift",
    "Intervals and sprint for juniors, U23 riders and the academy.",
    "Intervaller og sprint til juniorer, U23-ryttere og akademiet.",
    [], "youthSquads",
    ["vo2max", "sprint", "vo2max", "recovery", "vo2max", "threshold", "rest"]),
]);

export const TRAINING_PROGRAM_KEYS = Object.freeze(TRAINING_PROGRAMS.map((p) => p.key));

export function findTrainingProgram(key) {
  return TRAINING_PROGRAMS.find((p) => p.key === key) ?? null;
}

// ── Kopi ved tildeling (ejer-valg 1) ──────────────────────────────────────
// En NY, selvstaendig days-struktur. Intet i den peger tilbage paa kataloget,
// saa en senere rettelse af TRAINING_PROGRAMS kan ikke flytte planen.
export function programWeekDaysFor(key) {
  const program = findTrainingProgram(key);
  if (!program) return null;
  const days = {};
  for (const weekday of WEEKDAY_KEYS) {
    const session = program.days[weekday];
    days[weekday] = { session, intensity: intensityForSession(session) };
  }
  return days;
}

// Baerer raekken programdata (mindst een ugedag med en gyldig session)?
export function weekDaysHaveSessions(days) {
  if (!days || typeof days !== "object") return false;
  return WEEKDAY_KEYS.some((weekday) => isProgramSession(days[weekday]?.session));
}

// Validering af en program-plan: alle 7 ugedage, hver med en gyldig session,
// den AFLEDTE intensitet, og valgfrie slots (null eller gyldig session).
export function isValidProgramWeekDays(days) {
  if (!days || typeof days !== "object" || Array.isArray(days)) return false;
  const keys = Object.keys(days);
  if (keys.length !== WEEKDAY_KEYS.length) return false;
  if (!keys.every((k) => WEEKDAY_KEYS.includes(k))) return false;
  for (const weekday of WEEKDAY_KEYS) {
    const entry = days[weekday];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    if (!isProgramSession(entry.session)) return false;
    if (entry.intensity !== intensityForSession(entry.session)) return false;
    if (entry.slots != null) {
      if (!Array.isArray(entry.slots) || entry.slots.length > PROGRAM_SLOTS) return false;
      if (!entry.slots.every((s) => s == null || isProgramSession(s))) return false;
    }
    const extra = Object.keys(entry).filter((k) => !["session", "intensity", "slots"].includes(k));
    if (extra.length) return false;
  }
  return true;
}

// Ret EEN celle (spillerens klik, "override-dag"). slotIndex null = hele
// ugedagen (ugedagens session, som alle loebsdags-slots foelger). Et slot der
// saettes til ugedagens egen session nulstilles til null, saa "foelger
// ugedagen" og "staar tilfaeldigvis paa det samme" ikke er to tilstande.
// Returnerer en NY days-struktur, eller null ved ugyldigt input.
export function setProgramCell(days, { weekday, slotIndex = null, session }) {
  if (!isValidProgramWeekDays(days)) return null;
  if (!WEEKDAY_KEYS.includes(weekday)) return null;
  if (!isProgramSession(session)) return null;
  const next = {};
  for (const w of WEEKDAY_KEYS) {
    next[w] = { ...days[w], ...(days[w].slots ? { slots: [...days[w].slots] } : {}) };
  }
  const entry = next[weekday];
  if (slotIndex == null) {
    entry.session = session;
    entry.intensity = intensityForSession(session);
  } else {
    const idx = Number(slotIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= PROGRAM_SLOTS) return null;
    const slots = Array.from({ length: PROGRAM_SLOTS }, (_, i) => entry.slots?.[i] ?? null);
    slots[idx] = session;
    entry.slots = slots;
  }
  // Slots der er lig ugedagen er "foelger ugedagen".
  if (entry.slots) {
    entry.slots = entry.slots.map((s) => (s === entry.session ? null : s));
    if (entry.slots.every((s) => s == null)) delete entry.slots;
  }
  return next;
}

// Sessionen i EEN celle: slottets egen, ellers ugedagens. null for en gammel
// raekke uden session (den laeses saa som ren intensitet, som i dag).
export function sessionForDayEntry(entry, slotIndex = 0) {
  if (!entry || typeof entry !== "object") return null;
  const idx = Number.isInteger(slotIndex) && slotIndex >= 0 ? slotIndex : 0;
  const slot = Array.isArray(entry.slots) ? entry.slots[idx] : null;
  if (isProgramSession(slot)) return slot;
  return isProgramSession(entry.session) ? entry.session : null;
}

// Hvilket slot en loebsdag er paa sin kalenderdato. Hver dato baerer
// PROGRAM_SLOTS loebsdage i traek (CALENDAR_RULES §1e-b), saa positionen er
// loebsdagen modulo 5. Uden loebsdag (kalenderdags-ticket, flaget off) er det
// slot 0 — dagens ene kolonne, "I dag".
export function programSlotForGameDay(gameDay) {
  const n = Number(gameDay);
  if (gameDay == null || !Number.isFinite(n)) return 0;
  return ((Math.floor(n) % PROGRAM_SLOTS) + PROGRAM_SLOTS) % PROGRAM_SLOTS;
}

// Session → (focus, intensity), via SAMME skrivesti som dagsvalget
// (programForChoice), saa et program aldrig kan traene noget et dagsvalg ikke
// kan. Hvile bevarer rytterens fokus (REST_FOCUS_FALLBACK-reglen).
export function programForSession(session, previousFocus = null) {
  if (session === "rest") return programForChoice({ dayType: "rest", previousFocus });
  if (session === "recovery") return programForChoice({ dayType: "recovery" });
  const dayType = dayTypeForProgram({ focus: session, intensity: SESSION_INTENSITY[session] });
  return programForChoice({ dayType, session });
}

// ── Motorens laesesti ────────────────────────────────────────────────────
// Dagens program for EEN rytter. Stigen er PRAECIS resolveDayIntensity's
// (TRAINING_RULES §4) — den kaldes her, ikke genopfundet:
//   1) rytterens egen raekke (rider_id sat)       — med session: programmets celle
//   2) rytterens eksplicitte plan (training_plans)
//   3) holdets raekke (rider_id IS NULL)          — med session: programmets celle
//   4) allerede-resolvet plan/default
//   5) "normal"
// En raekke MED session indtager praecis sin egen plads i stigen; en raekke
// uden (#1895) laeses som i dag. Er `programsOn` false, er svaret bit-identisk
// med den gamle linje `program.intensity = resolveDayIntensity(...)`.
//
//   program   : { focus, intensity } fra resolveProgram (muteres IKKE)
//   slotIndex : programSlotForGameDay(loebsdag)
// Returnerer { focus, intensity, source } hvor source er "program" naar en
// programcelle vandt, ellers "legacy".
export function resolveDayProgram({
  weekday, slotIndex = 0, riderOverrideDays, teamWeekDays, program, hasExplicitPlan = false, programsOn = false,
}) {
  const legacyIntensity = resolveDayIntensity({
    weekday, riderOverrideDays, teamWeekDays, planIntensity: program?.intensity, hasExplicitPlan,
  });
  const legacy = { focus: program?.focus, intensity: legacyIntensity, source: "legacy" };
  if (!programsOn) return legacy;

  const fromSession = (session) => {
    const chosen = programForSession(session, program?.focus);
    return chosen.ok ? { focus: chosen.focus, intensity: chosen.intensity, source: "program" } : null;
  };

  // Lag 1: rytterens egen raekke. Med session vinder programmets celle; en
  // gammel raekke med kun intensitet vinder som i dag.
  const riderEntry = riderOverrideDays?.[weekday];
  const riderSession = sessionForDayEntry(riderEntry, slotIndex);
  if (riderSession) return fromSession(riderSession) ?? legacy;
  if (isValidIntensity(riderEntry?.intensity)) return legacy;

  // Lag 2: rytterens eksplicitte plan vinder over holdets (#2438).
  if (hasExplicitPlan) return legacy;

  // Lag 3: holdets raekke.
  const teamSession = sessionForDayEntry(teamWeekDays?.[weekday], slotIndex);
  if (teamSession) return fromSession(teamSession) ?? legacy;

  return legacy;
}

// Kataloget som API'et leverer det (begge sprog; fladen vaelger).
export function trainingProgramCatalog() {
  return TRAINING_PROGRAMS.map((p) => ({
    key: p.key,
    name: { en: p.nameEn, da: p.nameDa },
    tagline: { en: p.taglineEn, da: p.taglineDa },
    targetTypes: [...p.targetTypes],
    audience: p.audience,
    days: { ...p.days },
  }));
}
