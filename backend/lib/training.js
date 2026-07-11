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

import { seededUnit, signatureFactor, PROGRESSION_CONFIG } from "./riderProgression.js";

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
  threshold: Object.freeze(["time_trial", "tempo"]),
  sprint:    Object.freeze(["sprint", "acceleration"]),
  endurance: Object.freeze(["endurance", "recovery", "durability"]),
  technique: Object.freeze(["descending", "positioning", "cobblestone"]),
  aero:      Object.freeze(["time_trial", "flat"]),
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

// #1885: øvre grænse for hvor mange ryttere ét bulk-træningsrequest må røre.
// En lovlig trup er 30 senior + akademi (~realistisk < 50); 100 er en rummelig
// DoS-bund uden at ramme nogen legitim "anvend på hele truppen"-handling.
export const BULK_TRAINING_MAX_RIDERS = 100;

// #1885: resolver ét bulk-træningsrequest. Frontend sender de ønskede riderIds;
// vi partitionerer dem mod hvad holdet faktisk ejer + slot-budgettet, så route-
// handleren kan upserte ALLE gyldige i ÉT kald (i stedet for ét HTTP-request pr.
// rytter, der sprængte marketWriteLimiter på en fuld trup).
//   riderIds        : ønskede rytter-ids (kan have dubletter/null)
//   ownedRiderIds   : Set/array af ids holdet ejer (kalderen slår op i DB)
//   plannedRiderIds : ids der ALLEREDE har en aktiv plan (re-targeting = gratis slot)
//   slotsRemaining  : tilbageværende slots (null = ubegrænset; default-konfig)
// Returnerer { toApply, skippedNotOwned, skippedNoSlots } — alle arrays, deduped,
// i input-rækkefølge. Slot-grenen er inert når slotsRemaining=null (unlimitedSlots).
export function partitionBulkTrainingTargets({
  riderIds,
  ownedRiderIds,
  plannedRiderIds = [],
  slotsRemaining = null,
} = {}) {
  const owned = ownedRiderIds instanceof Set ? ownedRiderIds : new Set(ownedRiderIds ?? []);
  const planned = plannedRiderIds instanceof Set ? plannedRiderIds : new Set(plannedRiderIds ?? []);
  const seen = new Set();
  const toApply = [];
  const skippedNotOwned = [];
  const skippedNoSlots = [];
  let remaining = slotsRemaining; // null = ubegrænset
  for (const id of riderIds ?? []) {
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    if (!owned.has(id)) {
      skippedNotOwned.push(id);
      continue;
    }
    const isNewPlan = !planned.has(id);
    if (isNewPlan && remaining != null) {
      if (remaining <= 0) {
        skippedNoSlots.push(id);
        continue;
      }
      remaining -= 1;
    }
    toApply.push(id);
  }
  return { toApply, skippedNotOwned, skippedNoSlots };
}

// #1894 variant 3: partitionér et bulk-smart-focus-request. Smart-mode adskiller sig
// fra partitionBulkTrainingTargets på ÉT punkt: ryttere med en EKSISTERENDE plan
// springes over (ikke re-target) — en managers eget valg må ALDRIG overskrives af
// "anvend smart fokus på hele truppen". Ren funktion; kaldes af routes/api.js FØR
// partitionBulkTrainingTargets (som stadig håndterer ejerskab + slot-budget).
//   riderIds        : ønskede rytter-ids (kan have dubletter/null)
//   plannedRiderIds : ids der ALLEREDE har en aktiv plan i denne sæson
// Returnerer { eligible, skippedHasPlan } — deduped, input-rækkefølge bevaret.
export function partitionSmartBulkTargets({ riderIds, plannedRiderIds = [] } = {}) {
  const planned = plannedRiderIds instanceof Set ? plannedRiderIds : new Set(plannedRiderIds ?? []);
  const seen = new Set();
  const eligible = [];
  const skippedHasPlan = [];
  for (const id of riderIds ?? []) {
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    if (planned.has(id)) skippedHasPlan.push(id);
    else eligible.push(id);
  }
  return { eligible, skippedHasPlan };
}

// Resolvér en plan til en bias-modifier som riderProgression.developRiderSeason
// konsumerer. Seeder tilbageslags-rullet deterministisk pr. (rytter, sæson, plan).
//   plan         : { focus, intensity } | null
//   riderId      : seed-komponent
//   seasonNumber : seed-komponent (samme sæson → samme udfald)
// Returnerer null hvis ingen/ugyldig plan, ellers
//   { focusAbilities:Set<string>, focusMult:number, offFocusMult:number, setbackHit:boolean }.
// #1974: coarse, type-derived trainability-signal pr. fokus — UI-hint om HVORFOR
// et fokus knap ikke rykker en given rytter. Udledes UDELUKKENDE af
// signatureFactor(primaryType, ability) (riderProgression.js) — INGEN caps eller
// potentiale eksponeres (server-hidden per #1162). Én af:
//   "strength" — mindst én fokus-evne er signatur (positiv type-vægt, factor 1.0)
//   "blocked"  — ALLE fokus-evner er modsatte (negativ type-vægt, factor 0)
//   "limited"  — resten (neutral/off-type-blanding, factor offTypeHeadroomFactor)
// Ukendt/manglende type → alt "limited" (sikker neutral, ingen falsk positiv/negativ).
export function focusTrainability(primaryType, cfg = PROGRESSION_CONFIG) {
  const out = {};
  for (const [focusKey, abilities] of Object.entries(TRAINING_FOCUSES)) {
    if (primaryType == null) {
      out[focusKey] = "limited";
      continue;
    }
    const factors = abilities.map((ability) => signatureFactor(primaryType, ability, cfg));
    if (factors.some((f) => f >= 1.0)) out[focusKey] = "strength";
    else if (factors.every((f) => f === 0)) out[focusKey] = "blocked";
    else out[focusKey] = "limited";
  }
  return out;
}

// #1894: smart default-fokus for ryttere UDEN aktiv plan (44% af trup ramte
// hardcoded DEFAULT_PROGRAM.focus="endurance" i dailyTraining.js uanset type —
// en sprinter trænede endurance i stedet for sprint). Genbruger #1974's
// focusTrainability(primaryType) — INGEN ny type→fokus-mapping. Deterministisk:
// første fokus-nøgle (TRAINING_FOCUS_KEYS-rækkefølge) med "strength", ellers
// første ikke-"blocked", ellers "endurance" (sikker fallback, ukendt/manglende type).
export function smartDefaultFocus(primaryType, cfg = PROGRESSION_CONFIG) {
  const trainability = focusTrainability(primaryType, cfg);
  for (const focusKey of TRAINING_FOCUS_KEYS) {
    if (trainability[focusKey] === "strength") return focusKey;
  }
  // Manglende/ukendt type (eller en type uden nogen "strength"-fokus) giver ALT
  // "limited" (focusTrainability) — uden denne guard ville loopet nedenfor vælge
  // "vo2max" (første TRAINING_FOCUS_KEYS-nøgle) blot fordi den kommer først i
  // rækkefølgen, hvilket ikke er en meningsfuld "smart" default. "endurance"
  // matcher DEFAULT_PROGRAM's hidtidige adfærd (bagudkompatibelt).
  const allLimited = TRAINING_FOCUS_KEYS.every((k) => trainability[k] === "limited");
  if (allLimited) return "endurance";
  for (const focusKey of TRAINING_FOCUS_KEYS) {
    if (trainability[focusKey] !== "blocked") return focusKey;
  }
  return "endurance";
}

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
