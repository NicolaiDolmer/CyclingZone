// Progression L2 — træning (teaser) (#1163 / epic #931 / #1136) — RENE funktioner.
//
// Ejer-besluttet 2026-06-08 (design-session): sæson-granulær TRÆNINGSFOKUS som
// on-ramp til den fulde Zwift/TrainingPeaks-epic. En manager vælger ét fokus +
// intensitet for op til slotsPerSeason nøgleryttere pr. sæson. Ved sæson-skift
// biaser planen den passive motor (#1137) mod cap — gated bag SAMME flag som
// #1137 (intent+UI ved launch, mekanik når progression tændes).
//
// Backend ejer KUN ledgeren (training_plans): én aktiv row pr. (hold, rytter,
// sæson). Denne fil er ren JS uden DB/Date/Math.random, så den kan unit-testes
// isoleret og køres deterministisk i season-transition (genbruger seededUnit fra
// riderProgression for reproducerbar risiko).

import { seededUnit } from "./riderProgression.js";

// ── EJER-JUSTERBARE KONSTANTER (kalibreres i scripts/previewTraining.js) ────────
export const TRAINING_CONFIG = Object.freeze({
  // Antal aktive træningsfokus en manager har pr. sæson. Spejler scouting (#1138)
  // — udledes pr. aktiv sæson, ingen reset-hook. Gratis (fair-premium).
  slotsPerSeason: 3,

  // #1305: Daglig træning = ubegrænsede programmer (hele truppen). Slot-cap bevares
  // for eventuel fremtidig brug (backward compat), men håndhæves ikke når dette er sat.
  unlimitedSlots: true,

  // Gyldige intensiteter (display via i18n; nøgler er stabile).
  // "rest" er nu gyldig — daglig intensitet, ingen vækst (håndteres i dailyTraining.js).
  intensities: Object.freeze(["easy", "normal", "hard", "rest"]),

  // Vækst-multiplikator på FOKUS-evnernes gap-lukning mod cap, pr. intensitet.
  // Startgæt — dry-run'es mod population før un-gating af progression.
  focusGrowthMult: Object.freeze({ easy: 1.15, normal: 1.35, hard: 1.60 }),

  // Ikke-fokus-evner lukker en ANELSE mindre samme sæson (fokus-trade-off): du
  // specialiserer mod X frem for breddevækst. Bevidst MILD (0,97) — dry-run
  // (#1163) viste at 0,90 ramte alle ~13 ikke-fokus-evner så hårdt at træning
  // blev netto-negativ (rytteren samlet dårligere → ingen ville træne). Den
  // ægte pris bæres af slot-knaphed + setback-risiko, ikke en bredde-straf der
  // gør træning til en fælde.
  offFocusMult: 0.97,

  // Seeded risiko for tilbageslag (overtraining → tabt vækst), pr. intensitet.
  // Let = ingen risiko; hård = mærkbar. Varsles tydeligt i UI.
  setbackChance: Object.freeze({ easy: 0, normal: 0.05, hard: 0.18 }),
  // Når tilbageslag rammer: sæsonens samlede vækst skaleres med denne faktor.
  setbackGrowthMult: 0.5,
});

// Fokus-nøgle → de evner (rider_derived_abilities) fokus skubber mod cap.
// Træningssprog der overlever ind i den fulde epic (sessions-kataloget).
export const TRAINING_FOCUSES = Object.freeze({
  vo2max:    Object.freeze(["climbing", "punch", "tempo"]),
  threshold: Object.freeze(["time_trial", "tempo", "prolog"]),
  sprint:    Object.freeze(["sprint", "acceleration"]),
  endurance: Object.freeze(["endurance", "recovery", "durability"]),
  technique: Object.freeze(["descending", "positioning", "cobblestone"]),
  aero:      Object.freeze(["time_trial", "flat", "prolog"]),
});
export const TRAINING_FOCUS_KEYS = Object.freeze(Object.keys(TRAINING_FOCUSES));

export function isValidFocus(focus) {
  return Object.prototype.hasOwnProperty.call(TRAINING_FOCUSES, focus);
}
export function isValidIntensity(intensity, cfg = TRAINING_CONFIG) {
  return cfg.intensities.includes(intensity);
}

// Udled træningsstate for ÉT hold ud fra dets training_plans-rows.
//   rows           : [{ rider_id, season_id, focus, intensity }, ...] (kun dette holds rows)
//   activeSeasonId : den aktive sæsons id (slots + aktive planer tælles kun her)
// Returnerer { slots:{total,used,remaining}, focuses:[...], intensities:[...],
//   plans:{<rider_id>:{focus,intensity}} } hvor plans kun er den aktive sæsons.
// Når cfg.unlimitedSlots=true: slots.total=null, slots.remaining=null (UI: ubegrænset).
export function deriveTrainingState(rows, activeSeasonId, cfg = TRAINING_CONFIG) {
  const plans = {};
  let used = 0;
  for (const row of rows ?? []) {
    if (activeSeasonId == null || row.season_id !== activeSeasonId) continue;
    plans[row.rider_id] = { focus: row.focus, intensity: row.intensity };
    used++;
  }
  const unlimited = cfg.unlimitedSlots === true;
  const total = unlimited ? null : cfg.slotsPerSeason;
  const remaining = unlimited ? null : Math.max(0, cfg.slotsPerSeason - used);
  return {
    slots: { total, used, remaining },
    focuses: TRAINING_FOCUS_KEYS,
    intensities: cfg.intensities,
    plans,
  };
}

// Må dette hold sætte/ændre en plan på denne rytter lige nu? Ren guard.
//   hasPlan        : har holdet allerede en aktiv plan på rytteren i sæsonen?
//   slotsRemaining : tilbageværende slots i sæsonen (null = ubegrænset)
// Om-målretning af en eksisterende plan koster ikke et nyt slot; kun en NY plan gør.
// Returnerer { ok, reason } hvor reason ∈ "no_slots" | null.
export function canTrain(hasPlan, slotsRemaining, cfg = TRAINING_CONFIG) {
  if (hasPlan) return { ok: true, reason: null };
  if (cfg.unlimitedSlots === true) return { ok: true, reason: null };
  if ((slotsRemaining ?? 0) <= 0) return { ok: false, reason: "no_slots" };
  return { ok: true, reason: null };
}

// Resolvér en plan til en bias-modifier som riderProgression.developRiderSeason
// konsumerer. Seeder tilbageslags-rullet deterministisk pr. (rytter, sæson, plan).
//   plan         : { focus, intensity } | null
//   riderId      : seed-komponent
//   seasonNumber : seed-komponent (samme sæson → samme udfald)
// Returnerer null hvis ingen/ugyldig plan, ellers
//   { focusAbilities:Set<string>, focusMult:number, offFocusMult:number, setbackHit:boolean }.
export function resolveTrainingModifier(plan, riderId, seasonNumber, cfg = TRAINING_CONFIG) {
  if (!plan || !isValidFocus(plan.focus) || !isValidIntensity(plan.intensity, cfg)) return null;
  const focusAbilities = new Set(TRAINING_FOCUSES[plan.focus]);
  // "rest" i den sæsonale sti behandles som "easy": ingen vækst-boost, aldrig setback.
  // Den daglige sti (dailyTraining.js/abilityMult) håndterer rest-semantikken selvstændigt.
  const effectiveIntensity = plan.intensity === "rest" ? "easy" : plan.intensity;
  const baseFocus = cfg.focusGrowthMult[effectiveIntensity] ?? 1;
  const chance = plan.intensity === "rest" ? 0 : (cfg.setbackChance[effectiveIntensity] ?? 0);
  const roll = seededUnit(`train:${riderId}:${seasonNumber}:${plan.focus}:${plan.intensity}`);
  const setbackHit = roll < chance;
  const dampen = setbackHit ? cfg.setbackGrowthMult : 1;
  return {
    focusAbilities,
    focusMult: baseFocus * dampen,
    offFocusMult: cfg.offFocusMult * dampen,
    setbackHit,
  };
}
