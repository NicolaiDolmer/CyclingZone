// Passiv rytterudviklings-motor (#1137 / epic #1136) — RENE kurve-funktioner.
//
// Ejer-besluttet 2026-06-07: udvikling muterer de afledte abilities DIREKTE
// (rider_derived_abilities, 0-99), ikke PCM-stats. Alt gameplay-forbrug hænger på
// abilities (race-motor #1102, base_value #1101, type #49), så mutation dér
// propagerer korrekt. Board-ungdomsmål #813 flyttes tilsvarende til ability-rummet.
//
// Denne fil er KUN ren matematik (ingen DB, ingen Math.random/Date.now) så den kan:
//   • kalibreres via scripts/previewRiderProgression.js (vis kurver → ejer justerer)
//   • køres deterministisk i season-transition (samme input → samme output)
//   • unit-testes isoleret.
//
// MODEL (alt i CONFIG nedenfor er ejer-justerbart i kalibrerings-løkken):
//   1. Loft per evne   = baseline-ability + headroom(potentiale) × signatur-vægt(type,evne)
//   2. Vækst < peak    = current rykker en alders-vægtet brøkdel af (loft − current)
//   3. Fald ≥ peak     = current falder N ability-point/sæson (type-afhængig peak-alder)
//   4. Determinisme    = seeded støj per (rider_id, sæson) via FNV-1a → reproducerbart
//   5. Retirement      = seeded i alders-vindue, garanteret ved guaranteedAge

import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { RIDER_TYPES } from "./riderTypes.js";

// ── EJER-JUSTERBARE KONSTANTER (kalibreres i previewRiderProgression.js) ────────
export const PROGRESSION_CONFIG = Object.freeze({
  // Ejer 2026-06-07: ENS udviklingskurve per alder på tværs af typer → ét fælles
  // peak (ikke type-afhængigt). peakAgeByType bevaret som null-hook hvis type-
  // variation senere ønskes.
  peakAge: 28,
  peakAgeByType: null,

  // Headroom = ability-point en SIGNATUR-evne kan stige over sin baseline ved fuldt
  // indfriet potentiale. Interpoleret lineært mellem disse potentiale-ankre (1-6).
  // Off-type-evner får offTypeHeadroomFactor × headroom; modsatte (negativ type-vægt)
  // vokser ikke (factor 0).
  headroomByPotential: Object.freeze({ 1: 4, 2: 9, 3: 15, 4: 22, 5: 30, 6: 38 }),
  offTypeHeadroomFactor: 0.35,

  // Vækst-fraktion: andel af (loft − current) der lukkes pr. sæson, efter alder.
  // Yngre = hurtigere konvergens mod loftet (aftager asymptotisk).
  growthFractionByAge: Object.freeze([
    { maxAge: 19, frac: 0.35 },
    { maxAge: 22, frac: 0.28 },
    { maxAge: 25, frac: 0.18 },
    { maxAge: 99, frac: 0.10 },
  ]),
  // ± seeded variation på vækst-fraktionen (to ens talenter udvikler sig forskelligt,
  // men deterministisk). 0.15 = op til ±15% relativ på fraktionen.
  growthNoise: 0.15,

  // Fald efter peak: ability-point/sæson på signatur-evner, voksende med år forbi peak.
  declineByYearsPastPeak: Object.freeze([
    { maxYears: 3, drop: 1.0 },
    { maxYears: 6, drop: 1.8 },
    { maxYears: 99, drop: 2.6 },
  ]),
  offTypeDeclineFactor: 0.7,

  // Semi-auto retirement: seeded sandsynlighed stiger lineært fra windowStart til
  // guaranteedAge; garanteret derover. noticeSeasons = varsel før faktisk exit.
  retirement: Object.freeze({ windowStartAge: 36, guaranteedAge: 40, noticeSeasons: 1 }),
});

// ── Ungdoms-loft (#akademi-rework 2026-06-23) — START-værdier, kalibreres i Fase D ──
export const YOUTH_PROGRESSION_CONFIG = Object.freeze({
  // Mål-niveau på en PRIMÆR naturlig evne ved fuldt indfriet potentiale.
  loftByPotential: Object.freeze({ 1: 35, 2: 48, 3: 60, 4: 70, 5: 80, 6: 88 }),
  // Andel af loftet en evne får efter dens rolle ift. de 2 anlægs-retninger.
  naturalPrimaryFactor: 1.0,
  naturalSecondaryFactor: 0.82,
  neutralFactor: 0.45,
  oppositeFactor: 0.12,
  // Potentiale → træningsfart-multiplikator (Fase B).
  rateByPotential: Object.freeze({ 1: 0.6, 2: 0.78, 3: 0.92, 4: 1.06, 5: 1.2, 6: 1.35 }),
});

// Rolle-faktor for én evne givet primær+sekundær type. Positiv vægt i primary →
// primær-naturlig; ellers positiv i secondary → sekundær-naturlig; negativ i primary
// (eller secondary uden positiv) → modsat; ellers neutral.
export function youthRoleFactor(primaryType, secondaryType, ability, cfg = YOUTH_PROGRESSION_CONFIG) {
  const wp = WEIGHTS_BY_TYPE[primaryType]?.[ability];
  const ws = WEIGHTS_BY_TYPE[secondaryType]?.[ability];
  if (wp > 0) return cfg.naturalPrimaryFactor;
  if (ws > 0) return cfg.naturalSecondaryFactor;
  if (wp < 0 || ws < 0) return cfg.oppositeFactor;
  return cfg.neutralFactor;
}

// ── Determinisme: FNV-1a → [0,1) fra en streng-nøgle (samme familie som
//    abilityDerivation.hashNoise; genbrugt så seed er reproducerbart pr. rytter+sæson).
export function seededUnit(key) {
  const s = String(key ?? "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Type-vægt pr. evne (positiv = signatur, negativ = modsat, 0 = neutral/off-type).
const WEIGHTS_BY_TYPE = Object.freeze(
  Object.fromEntries(RIDER_TYPES.map((t) => [t.key, t.weights]))
);

// Signatur-faktor for (type, evne): 1.0 hvis positiv type-vægt (speciale), 0 hvis
// negativ (svaghed — vokser ikke / falder hurtigst), ellers offTypeHeadroomFactor.
export function signatureFactor(primaryType, ability, cfg = PROGRESSION_CONFIG) {
  const w = WEIGHTS_BY_TYPE[primaryType]?.[ability];
  if (w == null || w === 0) return cfg.offTypeHeadroomFactor;
  return w > 0 ? 1.0 : 0;
}

// Lineær interpolation af headroom på potentiale-ankrene (1..6, clamp udenfor).
export function headroomForPotential(potentiale, cfg = PROGRESSION_CONFIG) {
  const p = clamp(Number(potentiale) || 1, 1, 6);
  const lo = Math.floor(p), hi = Math.ceil(p);
  const a = cfg.headroomByPotential[lo] ?? 0;
  const b = cfg.headroomByPotential[hi] ?? a;
  return a + (b - a) * (p - lo);
}

export function peakAgeForType(primaryType, cfg = PROGRESSION_CONFIG) {
  return cfg.peakAgeByType?.[primaryType] ?? cfg.peakAge;
}

// ── Alders-taper på det ABSOLUTTE loft (ejer-valg B, 2026-07-16, #2472) ──────
// buildYouthCaps/youthAbilityCap er BEVIDST alders-uafhængige (samme potentiale-
// ankrede mål for en 22-årig og en 34-årig — se buildCapsForRider). Det er præcis
// hvorfor #2472's konsolidering ophævede aldringen for 556 veteraner (29-36):
// dailyAbilityDelta har INGEN aldersgate (kun stepAbility gater, og kun 1×/sæson),
// så et højere, alders-uafhængigt loft genåbnede væksten for post-peak-ryttere og
// den overhalede sæson-declinen.
//
// Denne taper løser det ved at aftrappe det ABSOLUTTE loftets bidrag efter
// peakAge — IKKE gulvet (max(absolut, current)), som forbliver urørt: ingen
// spiller mister evne han ejer, taperen begrænser kun fremtidig VÆKST. Når det
// tapered absolutte loft falder til/under current, vinder gulvet og
// gap = max(0, cap − current) = 0 → ingen daglig vækst tilbage, og sæsonens
// decline (stepAbility) dominerer igen alene.
//
// Allerede skrevet som den rigtige plan i academyFlag.js's #2437-interim-
// kommentar: "jævn alders-taper, egen session". Denne funktion ER den session.
export const CAP_TAPER_CONFIG = Object.freeze({
  // Andel af det absolutte loft der er "tilbage" N år efter peakAge. Lineær
  // interpolation mellem ankrene (år ift. peakAge → retain-andel); fladt på
  // sidste ankers retain derefter. retain=0 ved 12 år forbi peak (dvs. alder 40
  // ved unified peakAge=28) — loftet bidrager intet, gulvet definerer cap alene.
  retainByYearsPastPeak: Object.freeze([
    { years: 0, retain: 1.0 },
    { years: 5, retain: 0.6 },
    { years: 9, retain: 0.3 },
    { years: 12, retain: 0.0 },
  ]),
});

// Lineær interpolation af retain-andelen på years-ankrene (0..sidste, clamp udenfor).
function interpolateRetain(yearsPast, anchors) {
  if (yearsPast <= anchors[0].years) return anchors[0].retain;
  for (let i = 1; i < anchors.length; i++) {
    const prev = anchors[i - 1];
    const cur = anchors[i];
    if (yearsPast <= cur.years) {
      const t = (yearsPast - prev.years) / (cur.years - prev.years);
      return prev.retain + (cur.retain - prev.retain) * t;
    }
  }
  return anchors[anchors.length - 1].retain;
}

// Aftrap ÉT absolut loft-tal efter alder. age ≤ peakAge ⇒ uændret (retain=1.0).
// Rent tal ind/ud — ingen clamp her (clamp 0-99 sker i buildCapsForRider EFTER
// gulvet er anvendt, så en tapered værdi aldrig kan clampe forkert alene).
// age null/undefined ⇒ uændret (sikker default for callers der ikke sender alder,
// jf. samme "valgfri, bagudkompatibel" kontrakt som academyRateMult/staff m.fl.).
export function taperedAbsoluteCap(absoluteCap, age, peakAge = PROGRESSION_CONFIG.peakAge, cfg = CAP_TAPER_CONFIG) {
  const cap = Number(absoluteCap) || 0;
  const a = Number(age);
  if (!Number.isFinite(a) || a <= peakAge) return cap;
  const retain = interpolateRetain(a - peakAge, cfg.retainByYearsPastPeak);
  return cap * retain;
}

function lookup(table, value, key, field) {
  for (const row of table) if (value <= row[key]) return row[field];
  return table[table.length - 1][field];
}

// Loft (potential ability) for én evne — uforanderligt, sættes ved init fra baseline.
export function abilityCap(baselineAbility, primaryType, ability, potentiale, cfg = PROGRESSION_CONFIG) {
  const headroom = headroomForPotential(potentiale, cfg) * signatureFactor(primaryType, ability, cfg);
  return clamp(Math.round(baselineAbility + headroom), 0, 99);
}

// Ét sæson-skridt for én evne. Returnerer den nye current (afrundet, clamp 0-99).
//   current  : nuværende ability
//   cap      : loftet (fra abilityCap)
//   age      : rytterens alder VED sæson-skiftet
//   peakAge  : type-peak
//   isSignature : true hvis positiv type-vægt (styrer fald-hastighed)
//   noiseUnit: seededUnit(`${rider_id}:${season}:${ability}`) ∈ [0,1)
//   growthMult: træningsbias på vækst-fraktionen (#1163); 1 = ingen træning.
//               Påvirker KUN vækst-fasen (alder ≤ peak) — træning fremskynder ikke decline.
export function stepAbility(current, cap, age, peakAge, isSignature, noiseUnit, cfg = PROGRESSION_CONFIG, growthMult = 1) {
  const c = Number(current);
  if (!Number.isFinite(c)) return current;

  if (age <= peakAge) {
    // Vækst mod loft (gør intet hvis allerede på/over loft).
    const gap = cap - c;
    if (gap <= 0) return Math.round(c);
    const baseFrac = lookup(cfg.growthFractionByAge, age, "maxAge", "frac");
    const noise = (noiseUnit * 2 - 1) * cfg.growthNoise; // [-growthNoise, +growthNoise]
    const frac = clamp(baseFrac * (1 + noise) * (Number(growthMult) || 1), 0, 1);
    return clamp(Math.round(c + gap * frac), 0, 99);
  }
  // Fald efter peak.
  const yearsPast = age - peakAge;
  const drop = lookup(cfg.declineByYearsPastPeak, yearsPast, "maxYears", "drop")
    * (isSignature ? 1 : cfg.offTypeDeclineFactor);
  return clamp(Math.round(c - drop), 0, 99);
}

// Seeded retirement-beslutning for én rytter i én sæson. Returnerer
// { retire, notice } hvor notice = "varsles nu, exit om noticeSeasons sæsoner".
export function retirementDecision(age, riderId, season, cfg = PROGRESSION_CONFIG) {
  const { windowStartAge, guaranteedAge } = cfg.retirement;
  if (age < windowStartAge) return { retire: false, notice: false };
  if (age >= guaranteedAge) return { retire: true, notice: true };
  const p = (age - windowStartAge) / (guaranteedAge - windowStartAge);
  const roll = seededUnit(`retire:${riderId}:${season}`);
  return { retire: roll < p, notice: roll < p };
}

// Beregn én sæsons udvikling for en rytter på tværs af alle synlige evner.
//   rider     : { id, primary_type, potentiale, age }  (age = alder VED det nye sæson-skifte)
//   abilities : { climbing, sprint, ... } current-værdier
//   caps      : { climbing, sprint, ... } uforanderlige lofter (abilityCap pr. evne)
//   season    : sæson-nummer (seed-komponent)
//   training  : bias-modifier fra training.resolveTrainingModifier(...) | null (#1163).
//               { focusAbilities:Set, focusMult, offFocusMult } — biaser vækst pr. evne.
//   options   : { skipGrowth?: boolean } — anti-double-dip (#1305): når daglig træning
//               er aktiv for menneskelige hold spring VÆKST-fasen (age ≤ peakAge) over
//               pr. evne. Fald (age > peakAge) og retirement kører ALTID uændret.
//               Ingen effect på default-adfærd (options udeladt eller skipGrowth falsy).
// Returnerer { next: {<ability>: value}, changed: [...], retirement: {...} }.
export function developRiderSeason(rider, abilities, caps, season, cfg = PROGRESSION_CONFIG, training = null, options = {}) {
  const age = Number(rider.age);
  const type = rider.primary_type;
  const peakAge = peakAgeForType(type, cfg);
  const skipGrowth = options?.skipGrowth === true;
  const next = {};
  const changed = [];

  for (const ability of VISIBLE_ABILITIES) {
    const cur = abilities?.[ability];
    if (cur == null) continue;
    // skipGrowth: vækst-fasen (age ≤ peakAge) springes over — evnen forbliver uændret.
    // Fald-fasen (age > peakAge) kører som normalt — decline er sæsonbaseret for alle.
    if (skipGrowth && age <= peakAge) {
      next[ability] = Math.round(Number(cur));
      continue;
    }
    const isSig = signatureFactor(type, ability, cfg) >= 1.0;
    const cap = caps?.[ability] ?? abilityCap(cur, type, ability, rider.potentiale, cfg);
    const noiseUnit = seededUnit(`grow:${rider.id}:${season}:${ability}`);
    const potRate = youthRateForPotential(rider.potentiale);
    const growthMult = (training
      ? (training.focusAbilities.has(ability) ? training.focusMult : training.offFocusMult)
      : 1) * potRate;
    const val = stepAbility(cur, cap, age, peakAge, isSig, noiseUnit, cfg, growthMult);
    next[ability] = val;
    if (val !== Math.round(Number(cur))) changed.push(ability);
  }

  return {
    next,
    changed,
    retirement: retirementDecision(age, rider.id, season, cfg),
  };
}

// Potentiale → vækst-rate-multiplikator (lineær interpolation på rateByPotential).
export function youthRateForPotential(potentiale, cfg = YOUTH_PROGRESSION_CONFIG) {
  const p = clamp(Number(potentiale) || 1, 1, 6);
  const lo = Math.floor(p), hi = Math.ceil(p);
  const a = cfg?.rateByPotential?.[lo] ?? 1;
  const b = cfg?.rateByPotential?.[hi] ?? a;
  return a + (b - a) * (p - lo);
}

// Lineær interpolation af ungdoms-loft-ankret på potentiale (1..6).
function youthLoftForPotential(potentiale, cfg = YOUTH_PROGRESSION_CONFIG) {
  const p = clamp(Number(potentiale) || 1, 1, 6);
  const lo = Math.floor(p), hi = Math.ceil(p);
  const a = cfg.loftByPotential[lo] ?? 0;
  const b = cfg.loftByPotential[hi] ?? a;
  return a + (b - a) * (p - lo);
}

// Afkoblet ungdoms-loft for én evne: potentiale-ankret niveau × rolle-faktor.
// IKKE en funktion af start-evnen (det er hele pointen — den lange rejse).
// cfg er påkrævet (ingen default) så .length === 5 og ingen skjult baseline-param.
export function youthAbilityCap(potentiale, primaryType, secondaryType, ability, cfg) {
  const c = cfg ?? YOUTH_PROGRESSION_CONFIG;
  const target = youthLoftForPotential(potentiale, c) * youthRoleFactor(primaryType, secondaryType, ability, c);
  return clamp(Math.round(target), 0, 99);
}

// Byg caps-sættet for en ung over alle synlige evner.
export function buildYouthCaps(potentiale, primaryType, secondaryType, cfg = YOUTH_PROGRESSION_CONFIG) {
  const caps = {};
  for (const ability of VISIBLE_ABILITIES) {
    caps[ability] = youthAbilityCap(potentiale, primaryType, secondaryType, ability, cfg);
  }
  return caps;
}

// Byg loft-sættet for en rytter fra dens baseline-abilities (kaldes ÉN gang ved init).
export function buildCaps(baselineAbilities, primaryType, potentiale, cfg = PROGRESSION_CONFIG) {
  const caps = {};
  for (const ability of VISIBLE_ABILITIES) {
    const base = baselineAbilities?.[ability];
    if (base == null) continue;
    caps[ability] = abilityCap(base, primaryType, ability, potentiale, cfg);
  }
  return caps;
}

// ── Init-helpers for ability_caps + ability_progress (#2001) ─────────────────
// ability_caps + ability_progress var KUN populeret lazily ved første sæson-
// progression (riderProgressionEngine) eller daglig trænings-tick (dailyTrainingEngine).
// Ryttere der aldrig blev udviklet/trænet (free agents, ikke-tickede hold) endte med
// begge NULL — den nye rytter-side kan så ikke vise progress-bar/caps ægte. Disse
// helpers giver derive-stien (backfillCores) + en backfill-script ÉN delt, ren init
// der matcher præcis det loft motoren ellers ville lazy-initте.

// Det fulde caps-sæt for EN VILKÅRLIG rytter — ÉN semantik for alle aldre.
//
//   loft = max( absolut_loft(potentiale, anlæg) , nuværende evne )
//
// EJER-BESLUTTET 2026-07-15. Før da levede to uforenelige semantikker side om side —
// afkoblet ungdoms-loft (potentiale = slutniveau) og baseline+headroom (potentiale =
// forbedring) — og hvilken en rytter fik var et møntkast afgjort af hvilken kodesti
// der først skrev ability_caps (feltet skrives KUN når NULL). Prod-følgen: en pot-4,5-
// rytter havde et højere livstidsloft (813) end den bedste pot-6-rytter (737), dvs.
// potentiale styrede IKKE hvor god en rytter kunne blive.
//
// GULVET er det der gør konsolideringen mulig: specs/2026-06-23-ungdoms-rytter-evner-
// rework-design.md §4.2 afviste netop én fælles formel med begrundelsen "en voksen med
// høj current ville ellers få et loft under sin current" — gulvet løser præcis det, og
// ingen spiller får frataget evne han allerede ejer. Denne funktion supersederer
// derfor §4.2/§8/§10 i den spec (dens §10 kaldte selv to-formel-modellen bevidst gæld
// der skulle konsolideres senere).
//
// ALDERS-UAFHÆNGIG med vilje: en semantik der skiftede ved 21→22 ville flytte rytterens
// livstidsloft på fødselsdagen — den bombe var kun udetoneret fordi sæson 1 stadig kører.
//
// Returnerer et 15-nøgle objekt (alle VISIBLE_ABILITIES).
//   abilities : { climbing, sprint, ... } nuværende/afledte evner (gulvet)
//   rider     : { potentiale, age } — age er VALGFRI (se taperedAbsoluteCap):
//               udeladt/null ⇒ intet taper, bagudkompatibelt med callers uden alder.
//   primaryType/secondaryType : ryttertype-nøgler (anlæggets to retninger)
//
// #2472 (16/7, ejer-valg B): det absolutte loft aftrappes efter peakAge via
// taperedAbsoluteCap — se den funktion for hvorfor (blocker-fund: uden taper
// ophæver #2472's konsolidering aldringen for post-peak-ryttere). Gulvet
// (max(tapered, current)) er URØRT — ingen spiller mister evne han ejer.
export function buildCapsForRider(abilities, { potentiale, age } = {}, primaryType, secondaryType) {
  const absolute = buildYouthCaps(potentiale, primaryType, secondaryType);
  const peakAge = peakAgeForType(primaryType);
  const caps = {};
  for (const ability of VISIBLE_ABILITIES) {
    const current = Math.round(Number(abilities?.[ability]) || 0);
    const tapered = taperedAbsoluteCap(absolute[ability] ?? 0, age, peakAge);
    caps[ability] = clamp(Math.max(tapered, current), 0, 99);
  }
  return caps;
}

// Er to caps-sæt ens over alle synlige evner? Motorerne genberegner loftet hver tick,
// men skal kun SKRIVE når det faktisk flyttede sig — ellers ville hver rytter få en
// overflødig UPDATE pr. tick. Et manglende/ikke-objekt loft tæller som forskelligt,
// så det bliver skrevet første gang.
export function sameCaps(a, b) {
  if (!a || typeof a !== "object" || !b || typeof b !== "object") return false;
  return VISIBLE_ABILITIES.every((ability) => Number(a[ability]) === Number(b[ability]));
}

// Nul-initialiseret progress-objekt over alle synlige evner: { climbing: 0, ... }.
// En aldrig-trænet rytter HAR ægte nul akkumuleret træning, så 0 er sandt (ikke en
// placeholder). Frontend viser kun en bar når fraktion > 0 → nul = ingen bar endnu,
// men feltet er nu et velformet, ikke-NULL objekt som rework-siden kan læse direkte.
export function buildProgressInit() {
  const progress = {};
  for (const ability of VISIBLE_ABILITIES) progress[ability] = 0;
  return progress;
}
