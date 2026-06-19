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

export function isValidFocus(focus) {
  return Object.prototype.hasOwnProperty.call(TRAINING_FOCUS_ABILITIES, focus);
}
export function isValidIntensity(intensity) {
  return TRAINING_INTENSITIES.includes(intensity);
}

// Beregn antal dage til raskmelding givet en injured_until ISO-datostreng og dags dato.
// Returnerer 0 hvis rask, positivt tal hvis skadet.
// today er en Date (default = new Date()).
export function injuryDaysLeft(injured_until, today = new Date()) {
  if (!injured_until) return 0;
  const until = new Date(injured_until);
  // Kun dagsdato (ingen klokkeslæt) — normaliser begge til midnight UTC.
  const diffMs = until.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0);
  return diffMs > 0 ? Math.ceil(diffMs / 86_400_000) : 0;
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
