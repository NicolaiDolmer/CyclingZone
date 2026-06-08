// Progression L2 — træning (teaser) (#1163) — frontend display-helpers.
//
// Ren visning: hvilke evner et fokus træner + en kvalitativ risiko-label pr.
// intensitet, så assistenten kan forklare trade-off'en. Tallene SPEJLER backend
// (backend/lib/training.TRAINING_CONFIG) men er display-only — den faktiske bias
// beregnes server-side ved sæson-skift (og er gated bag #1137-flaget).

// Fokus-nøgle → evner det skubber mod cap (matcher backend TRAINING_FOCUSES).
export const TRAINING_FOCUS_ABILITIES = Object.freeze({
  vo2max:    Object.freeze(["climbing", "punch", "tempo"]),
  threshold: Object.freeze(["time_trial", "tempo", "prolog"]),
  sprint:    Object.freeze(["sprint", "acceleration"]),
  endurance: Object.freeze(["endurance", "recovery", "durability"]),
  technique: Object.freeze(["descending", "positioning", "cobblestone"]),
  aero:      Object.freeze(["time_trial", "flat", "prolog"]),
});
export const TRAINING_FOCUS_KEYS = Object.freeze(Object.keys(TRAINING_FOCUS_ABILITIES));

export const TRAINING_INTENSITIES = Object.freeze(["easy", "normal", "hard"]);

// Display-risiko pr. intensitet (spejler backend setbackChance, i procent).
export const TRAINING_SETBACK_PCT = Object.freeze({ easy: 0, normal: 5, hard: 18 });

export function isValidFocus(focus) {
  return Object.prototype.hasOwnProperty.call(TRAINING_FOCUS_ABILITIES, focus);
}
export function isValidIntensity(intensity) {
  return TRAINING_INTENSITIES.includes(intensity);
}
