// Dagstype før session (#3762, ejer-besluttet 14/8) — ÉN kilde til stigen.
//
// ═══ HVORFOR MODELLEN BLEV VENDT OM ═════════════════════════════════════════
// Fokus og intensitet blev præsenteret som to frie akser: 6 fokus × 4
// intensiteter = 24 kombinationer. Mindst en tredjedel af dem er meningsløse,
// og spillet lod dig vælge dem alligevel. Målt mod prod 14/8, 4.588 planer:
//
//   • 623 planer (13,6 %) stod på fokus + hvile, hvor `abilityMult` returnerer
//     0 for ALLE evner. Spilleren havde valgt et fokus, siden gemte det uden
//     indvending, og motoren ignorerede det hver eneste dag.
//   • 178 stod på `endurance` + hård ("hård udholdenhed" er en selvmodsigelse)
//     og 71 på `sprint` + let ("en sprint der ikke er maksimal").
//
// Årsagen er at de seks fokus var TO forskellige slags ting på én liste:
// fysiologiske ZONER (vo2max, threshold, sprint, endurance), hvor intensiteten
// er en del af definitionen, og FÆRDIGHEDER (technique, aero), som trænes på
// lav belastning. At spørge om intensitet oveni en zone er at spørge om det
// samme to gange og tillade at svarene modsiger hinanden.
//
// ═══ MODELLEN ═══════════════════════════════════════════════════════════════
// Trin 1: hvad er det for en dag?   Hvile · Aktiv restitution · Færdighed · Træning
// Trin 2: hvilken session?          kun de sessioner der FINDES på den dagstype
//
// Intensiteten er derfor ikke længere et valg — den er en EGENSKAB ved
// sessionen (SESSION_INTENSITY nedenfor). "Intervaller er hårde" er ikke
// længere noget spilleren skal vide; det er indbygget.
//
// ═══ HVORFOR INGEN SKEMA-ÆNDRING ════════════════════════════════════════════
// `training_plans` beholder (focus, intensity). Dagstype og session UDLEDES af
// parret, så der ikke opstår to sandheder der kan komme ud af trit, og så de
// 4.588 eksisterende rækker ikke skal have en ny kolonne før de kan læses.
// Prisen er at derivationen skal bo ÉT sted — nemlig her — og at både motoren,
// API'et og fladen skal spørge dette modul i stedet for at gætte.

import { TRAINING_FOCUSES } from "./training.js";

// De fire dagstyper, i den rækkefølge de præsenteres.
export const DAY_TYPES = Object.freeze(["rest", "recovery", "skill", "training"]);

// Færdigheds-sessioner: hvad man ØVER, ikke hvor hårdt man kører. De kan trænes
// på lav belastning, og de er de eneste der rører håndværket.
// `loebslaere` (positioning, tactics, aggression) lander her med #3709 trin 2.
export const SKILL_SESSIONS = Object.freeze(["technique", "aero", "loebslaere"]);

// Trænings-sessioner pr. niveau. Niveauet ER intensiteten; en session findes kun
// på ét niveau, og det er hele pointen.
export const TRAINING_SESSIONS_BY_LEVEL = Object.freeze({
  easy:   Object.freeze(["endurance"]),               // Lang tur
  normal: Object.freeze(["tempo"]),                   // Tempo
  hard:   Object.freeze(["vo2max", "threshold", "sprint"]), // Intervaller · Tærskel · Sprint
});
export const TRAINING_LEVELS = Object.freeze(Object.keys(TRAINING_SESSIONS_BY_LEVEL));

// Session → dens faste intensitet. Dette er den tabel der gør intensiteten til
// en egenskab i stedet for et valg.
export const SESSION_INTENSITY = Object.freeze({
  // færdighedsdage: lav belastning pr. definition
  technique: "easy",
  aero: "easy",
  loebslaere: "easy",
  // træningsdage: niveauet er indbygget i sessionen
  endurance: "easy",
  tempo: "normal",
  vo2max: "hard",
  threshold: "hard",
  sprint: "hard",
});

// Fokus-nøglen der bæres på en aktiv restitutions-dag. Den har sin egen nøgle
// (og ikke fx `endurance`) fordi restitution kun må røre ÉN evne: uden en egen
// nøgle ville en restitutionsdag træne endurance og durability med, og så var
// den ikke restitution, den var en let træningsdag med et pænere navn.
export const RECOVERY_FOCUS = "restitution";
export const RECOVERY_INTENSITY = "recovery";

// Hvilken fokus-nøgle bærer en hviledag? Ingen — men kolonnen er NOT NULL, og
// `abilityMult` returnerer 0 for alle evner på `rest` uanset fokus, så værdien
// er inert. Vi BEVARER derfor spillerens hidtidige fokus på hviledage (så han
// kan skifte tilbage uden at have mistet sit valg) og falder først tilbage til
// denne når rytteren aldrig har haft en plan.
export const REST_FOCUS_FALLBACK = "endurance";

// ── Derivation: (focus, intensity) → dagstype ──────────────────────────────
// Rækkefølgen betyder noget. Intensiteten afgør hvile og restitution, FORDI en
// hviledag ignorerer fokusset fuldstændig i motoren; først derefter kigger vi
// på fokusset. Det er også dét der gør funktionen sand for de 623 gamle
// hvile-planer der stadig bærer et fokus: de er hviledage, punktum.
export function dayTypeForProgram(program) {
  const focus = program?.focus ?? null;
  const intensity = program?.intensity ?? null;
  if (intensity === "rest") return "rest";
  if (intensity === RECOVERY_INTENSITY || focus === RECOVERY_FOCUS) return "recovery";
  if (SKILL_SESSIONS.includes(focus)) return "skill";
  return "training";
}

// Sessionen for et program, eller null for dagstyper der ikke HAR en session
// (hvile og aktiv restitution er hele dagen — der er intet trin 2).
export function sessionForProgram(program) {
  const dayType = dayTypeForProgram(program);
  if (dayType === "rest" || dayType === "recovery") return null;
  return program?.focus ?? null;
}

// Alle sessioner en rytter kan trænes MED, i præsentations-rækkefølge.
// Bemærk at `restitution` bevidst IKKE er med: en restitutionsdag er en hel dag,
// ikke en session man kan vælge mellem, og den skubber ingen evne mod sit loft.
// Diagnostik der måler "hvad trænes truppen med" (fx trainingSlotHealth) skal
// bruge denne liste, ikke TRAINING_FOCUS_KEYS.
export const ALL_SESSIONS = Object.freeze([
  ...TRAINING_LEVELS.flatMap((level) => TRAINING_SESSIONS_BY_LEVEL[level]),
  ...SKILL_SESSIONS,
]);

// Hvilke sessioner findes på en dagstype? Fladen bygger trin 2 af denne, og
// API'et validerer imod den. Én kilde, så en flade ikke kan tilbyde noget
// serveren afviser.
export function sessionsForDayType(dayType) {
  if (dayType === "skill") return SKILL_SESSIONS;
  if (dayType === "training") return TRAINING_LEVELS.flatMap((level) => TRAINING_SESSIONS_BY_LEVEL[level]);
  return [];
}

// Niveauet en trænings-session ligger på ("easy" | "normal" | "hard"), eller
// null hvis den ikke er en trænings-session.
export function levelForSession(session) {
  for (const level of TRAINING_LEVELS) {
    if (TRAINING_SESSIONS_BY_LEVEL[level].includes(session)) return level;
  }
  return null;
}

// ── Skrivestien: (dagstype, session) → det par der gemmes ──────────────────
// Returnerer { ok, focus, intensity, reason }. Ugyldige kombinationer kan ikke
// gemmes — det er hele grunden til at modellen blev vendt om, så guarden hører
// hjemme i samme modul som stigen.
//   previousFocus : rytterens hidtidige fokus, kun brugt til at bevare valget
//                   hen over en hviledag (se REST_FOCUS_FALLBACK).
export function programForChoice({ dayType, session = null, previousFocus = null } = {}) {
  if (!DAY_TYPES.includes(dayType)) return { ok: false, reason: "invalid_day_type" };

  if (dayType === "rest") {
    const focus = isKnownFocus(previousFocus) ? previousFocus : REST_FOCUS_FALLBACK;
    return { ok: true, focus, intensity: "rest" };
  }
  if (dayType === "recovery") {
    return { ok: true, focus: RECOVERY_FOCUS, intensity: RECOVERY_INTENSITY };
  }
  if (!sessionsForDayType(dayType).includes(session)) {
    return { ok: false, reason: "invalid_session" };
  }
  return { ok: true, focus: session, intensity: SESSION_INTENSITY[session] };
}

function isKnownFocus(focus) {
  return focus != null && Object.prototype.hasOwnProperty.call(TRAINING_FOCUSES, focus);
}

// ── Læsestien: et hvilket som helst gemt par → den nye model ───────────────
// Bruges to steder: fladen (så en umigreret plan aldrig vises som en tilstand
// der ikke findes) og migrationen (samme funktion, så det der VISES og det der
// SKRIVES ikke kan divergere).
//
// REGLEN ER EJER-BESLUTTET 14/8: bevar EVNERNE, ikke intensiteten. Fokusset
// følger med, og intensiteten følger den nye model. Målt konsekvens over de
// 4.588 planer: 0 ryttere skifter hvad de trænes med, 516 planer skifter
// intensitet. Alternativet — at bevare intensiteten — ville sende 516 ryttere
// over på andre evner end i går uden at nogen havde bedt om det.
//
// Returnerer { dayType, session, focus, intensity, changed } hvor `changed`
// fortæller om det gemte par ikke allerede var på modellens form.
export function normalizeProgram(program) {
  const dayType = dayTypeForProgram(program);
  const session = sessionForProgram(program);
  const previousFocus = program?.focus ?? null;

  if (dayType === "rest" || dayType === "recovery") {
    const resolved = programForChoice({ dayType, previousFocus });
    return withChanged(program, { dayType, session: null, focus: resolved.focus, intensity: resolved.intensity });
  }

  // En session vi ikke kender (fx et fokus fra en fremtidig version, eller en
  // håndredigeret række) falder tilbage til Lang tur frem for at kaste: en
  // ulovlig plan må aldrig kunne blokere et tick eller en flade.
  const known = sessionsForDayType(dayType).includes(session);
  const finalSession = known ? session : "endurance";
  return withChanged(program, {
    dayType: known ? dayType : "training",
    session: finalSession,
    focus: finalSession,
    intensity: SESSION_INTENSITY[finalSession],
  });
}

function withChanged(program, out) {
  const changed = program?.focus !== out.focus || program?.intensity !== out.intensity;
  return { ...out, changed };
}

// Niveau-rangering. Bruges til at afgøre om en migration flytter en rytter OP i
// belastning, hvilket er den ene ting migrationen ikke må gøre i det stille.
const INTENSITY_RANK = Object.freeze({ rest: 0, recovery: 1, easy: 2, normal: 3, hard: 4 });

// Hvad migrationen skal SKRIVE for en gemt plan.
//
// ── EJER-BESLUTNING 2, 14/8: HVILEDAG FØRST FOR DEM DER RYKKER OP ───────────
// `normalizeProgram` bevarer evnerne, men en zone-plan på `normal` bliver til en
// HÅRD session, fordi zonerne kun findes som hårde dage. Målt mod prod: 1.928 af
// 4.589 planer flytter opad, og 1.085 af de ryttere har allerede træthed ≥ 70
// (median 80) — netop dér hvor skaderisikoen tænder. Migrationen ville derfor
// koste ~109 skader dag 1 hos managere der aldrig har valgt hård træning.
//
// De planer starter derfor på HVILE. Sessionen bevares i kolonnen, så det koster
// ét klik at tage den i brug — præcis den mekanik modellen selv bruger til
// hviledage. En mistet træningsdag er synlig og kan fortrydes; en skade koster
// op til fem dage og kan ikke.
//
// Returnerer { focus, intensity, dayType, changed, graceDay }.
export function migrationTargetFor(program) {
  const normalized = normalizeProgram(program);
  if (!normalized.changed) return { ...normalized, graceDay: false };

  const fra = INTENSITY_RANK[program?.intensity] ?? 0;
  const til = INTENSITY_RANK[normalized.intensity] ?? 0;
  if (til <= fra) return { ...normalized, graceDay: false };

  return { ...normalized, dayType: "rest", session: null, intensity: "rest", graceDay: true };
}
