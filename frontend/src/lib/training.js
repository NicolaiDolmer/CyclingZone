// Progression L2 — træning (teaser) (#1163) — frontend display-helpers.
//
// Ren visning: hvilke evner et fokus træner + en kvalitativ risiko-label pr.
// intensitet, så assistenten kan forklare trade-off'en. Tallene SPEJLER backend
// (backend/lib/training.TRAINING_CONFIG) men er display-only — den faktiske bias
// beregnes server-side ved sæson-skift (og er gated bag #1137-flaget).

// Fokus-nøgle → evner det skubber mod cap (matcher backend TRAINING_FOCUSES).
export const TRAINING_FOCUS_ABILITIES = Object.freeze({
  vo2max:    Object.freeze(["climbing", "punch", "tempo"]),
  threshold: Object.freeze(["time_trial", "tempo"]),
  sprint:    Object.freeze(["sprint", "acceleration"]),
  endurance: Object.freeze(["endurance", "recovery", "durability"]),
  technique: Object.freeze(["descending", "positioning", "cobblestone"]),
  aero:      Object.freeze(["time_trial", "flat"]),
});
export const TRAINING_FOCUS_KEYS = Object.freeze(Object.keys(TRAINING_FOCUS_ABILITIES));

// Alle gyldige intensiteter inkl. rest (bruges i daglig træning + TrainingFocus).
export const TRAINING_INTENSITIES = Object.freeze(["rest", "easy", "normal", "hard"]);

// Display-risiko pr. intensitet (spejler backend setbackChance, i procent).
export const TRAINING_SETBACK_PCT = Object.freeze({ easy: 0, normal: 5, hard: 18 });

// #1895 PR 1: ugentlig træningsrytme — display-helpers. Spejrer backend
// (backend/lib/training.js WEEKDAY_KEYS/isValidWeekPlanDays/resolveDayIntensity)
// men er ren visning: sandheden om dagens EFFEKTIVE intensitet beregnes af
// motoren (dailyTrainingEngine.js) ved dagens tick. Bruges KUN til at markere
// rækker hvor rytmen ville afvige fra rytterens sæson-intensitet lige nu.
export const WEEKDAY_KEYS = Object.freeze(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

export function isValidWeekPlanDays(days) {
  if (!days || typeof days !== "object" || Array.isArray(days)) return false;
  const keys = Object.keys(days);
  if (keys.length !== WEEKDAY_KEYS.length) return false;
  for (const key of keys) if (!WEEKDAY_KEYS.includes(key)) return false;
  for (const weekday of WEEKDAY_KEYS) {
    const entry = days[weekday];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    if (!isValidIntensity(entry.intensity)) return false;
  }
  return true;
}

// Ugedags-nøgle for en Date i BRUGERENS lokale tid (display-only — motoren
// bruger Copenhagen-tid server-side; en visnings-hint kan afvige i sjældne
// tidszone-kanttilfælde uden konsekvens, da den aldrig styrer noget selv).
const WEEKDAY_ORDER = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export function weekdayKeyForDate(date = new Date()) {
  return WEEKDAY_ORDER[date.getDay()];
}

// Samme lagdeling som backend resolveDayIntensity (training.js): rytter-override
// (#1895 PR 2) > holdrytme > sæson-intensitet > "normal".
export function resolveDayIntensityDisplay({ weekday, riderOverrideDays, teamWeekDays, planIntensity }) {
  const riderOverride = riderOverrideDays?.[weekday]?.intensity;
  if (isValidIntensity(riderOverride)) return riderOverride;
  const teamDay = teamWeekDays?.[weekday]?.intensity;
  if (isValidIntensity(teamDay)) return teamDay;
  if (isValidIntensity(planIntensity)) return planIntensity;
  return "normal";
}

export function isValidFocus(focus) {
  return Object.prototype.hasOwnProperty.call(TRAINING_FOCUS_ABILITIES, focus);
}
export function isValidIntensity(intensity) {
  return TRAINING_INTENSITIES.includes(intensity);
}

// Beregn antal RESTERENDE skadedage (inklusiv i dag) givet en injured_until dato
// og dags dato. Returnerer 0 hvis rask, positivt tal hvis skadet.
// today er en Date (default = new Date()).
//
// injured_until er en DATE-kolonne (database/2026-06-12-daily-training.sql) =
// den SIDSTE skadede dag, inklusiv: backend regner rytteren som skadet så længe
// injured_until >= dagens dato (dailyTrainingEngine.js: injured_until >= tickDate).
// Tælleren skal derfor være INKLUSIV den sidste skadedag, ellers viser den "0 dage"
// på selve injured_until-datoen, hvor rytteren stadig er skadet (#1672).
//
// Sammenlign rene KALENDERDAGE, ikke tidsstempler: injured_until er en dato uden
// klokkeslæt (DATE-kolonne), mens today bærer brugerens lokale klokkeslæt. Vi mapper
// begge til UTC-midnat ud fra deres respektive kalenderfelter (injured_until i UTC,
// today i lokal tid) — så hverken tidszone eller sommertid kan flytte en kalenderdag.
function calendarDayUTC(value, useLocal) {
  const d = value instanceof Date ? value : new Date(value);
  return useLocal
    ? Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
    : Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function injuryDaysLeft(injured_until, today = new Date()) {
  if (!injured_until) return 0;
  const untilDay = calendarDayUTC(injured_until, false); // UTC-dato fra DB
  const todayDay = calendarDayUTC(today, true);          // brugerens lokale dag
  const diffDays = Math.round((untilDay - todayDay) / 86_400_000);
  // diffDays >= 0 ⇒ stadig skadet i dag; +1 tæller den indeværende skadedag med.
  return diffDays >= 0 ? diffDays + 1 : 0;
}

// #1531: er rytteren skadet lige nu? Bruges til skade-badget i Status-kolonnen på
// hold-tabellerne (eget hold + andres hold). injured_until = ISO-datostreng eller null.
// Genbruger injuryDaysLeft så "skadet"-tærsklen er ÉN kilde til sandhed (samme som
// skade-chippen på rytterprofilen).
export function isRiderInjured(injured_until, today = new Date()) {
  return injuryDaysLeft(injured_until, today) > 0;
}

// #1531: PostgREST select-fragment til at embedde skade-status (kun injured_until)
// på en riders-query eller en nested rider:rider_id(...)-join. rider_condition har
// RLS SELECT TO authenticated USING(true), så det virker også på andres hold.
export const CONDITION_SELECT = "rider_condition(injured_until)";

// Løft det joinede rider_condition.injured_until op på selve rytter-objektet (samme
// mønster som flattenAbilities). Supabase-embed kan komme som array (to-many) eller
// objekt (to-one); vi håndterer begge. Manglende rad = injured_until forbliver
// undefined → isRiderInjured returnerer false.
export function flattenCondition(rider) {
  if (!rider) return rider;
  const rc = rider.rider_condition;
  const cond = Array.isArray(rc) ? rc[0] : rc;
  const out = { ...rider };
  if (cond) out.injured_until = cond.injured_until;
  delete out.rider_condition;
  return out;
}
