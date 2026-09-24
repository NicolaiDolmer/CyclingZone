// Rytter-fødsel uden PCM-stats (#5269) — spillets EGNE priors pr. arketype/evne.
//
// ═══ EJER-BESLUTNING 15/9 2026 (ordret) ═══
//   "Intet skal vaere vaegtet paa pcm stats mere. Spillet skal kunne holde sig
//    selv oppe nu. Men ryttere skal stadig vaere de samme nu her inde i spillet.
//    Det er bare fremadrettet det skal stoppe."
//
// Denne fil er den "fremadrettede" side af den beslutning: en NY rytter fødes
// direkte i EVNE-rummet (1-99) fra en arketype-prior + støj. `stat_*` (PCM-
// vokabularet) er ikke længere input til nogen evne for en nyfødt rytter — de
// skrives slet ikke, dvs. NULL i `riders`. Eksisterende ryttere røres IKKE:
// ingen migration, ingen re-derivation, ingen ændring af abilityDerivation.js.
//
// ── HVORFOR TALLENE ER PRÆCIS DISSE ──────────────────────────────────────────
//
// Priorerne er IKKE gættet. De er den ABILITY-RUMS-SPEJLING af den population
// spillet allerede producerer i dag, så "ryttere skal stadig vaere de samme"
// holder: den gamle kæde var
//
//     stat ∈ [50,85]  →  pcmFrac = (stat−50)/35  →  evne = 1 + 98·pcmFrac
//
// altså en REN LINEÆR afbildning med faktoren 98/35 = 2,8 og forskydningen
// evne(50) = 1. Hele tier-/arketype-tabellen i fictionalRiderGenerator.js kan
// derfor skrives om til evne-enheder uden at flytte en eneste rytter:
//
//     evne-niveau  = (statMean − 50) · 2,8 + 1
//     evne-boost   = stat-boost · 2,8
//     evne-sd      = stat-sd · 2,8
//
// Det er dét hele denne fil er: samme fordeling, PCM-vokabularet fjernet.
// `riderBirthPriors.test.js` beviser spejlingen numerisk mod ARCHETYPES/TIERS,
// så en fremtidig ændring af den ene side ikke kan drive fra den anden i stilhed.
//
// ── DE TRE STEDER DEN BEVIDST AFVIGER ────────────────────────────────────────
//
// 1. `aggression` mister sit ALDERS-led. I dag er
//    `aggression = 0,85·pcmFrac(stat_ftr) + 0,15·youth`, dvs. op til +15 gratis
//    evne-point til en 21-årig. docs/audits/2026-09-15-3668-ability-scale-
//    investigation.md §1.2-1.3 måler det som den ene af to rod-årsager til at
//    evne-skalaen er skæv. Nyfødte får den rene arketype-prior.
// 2. `tactics` mister sit ALDERS-led. I dag er
//    `tactics = 0,55·experience + 0,45·aggressionFrac` — et aldersmålerur
//    (median 14 ved 16-21 år, 57 ved 31-33 år, §1.3). Nyfødte får
//    `0,60·aggression + 0,40·descending`, dvs. rapportens behandling C UDEN
//    dens rest-alders-led (ejer-krav til denne lane: taktik/aggression må IKKE
//    bruge alder).
// 3. `leadership` MÅ bruge alder (design-beslutning D-030) — se AGE_CURVED
//    nedenfor. Den evne findes ikke i registret endnu (#5268 lander den);
//    kurven ligger klar og aktiveres af sig selv den dag nøglen dukker op.
//
// ── EVNE-LISTEN HENTES, DEN HARDCODES IKKE ───────────────────────────────────
//
// Alle evner læses fra abilityRegistry.js (REGISTRY_ABILITY_KEYS). En evne der
// IKKE er navngivet i en arketype-profil falder tilbage på kategoriens default
// (DEFAULT_PRIOR_BY_CATEGORY) — det er dét der gør at #5268's `teamwork` og
// `leadership` får en fornuftig prior automatisk i samme sekund de står i
// registret, uden at denne fil skal røres. Registret ændres ALDRIG herfra.

import { ABILITY_REGISTRY, REGISTRY_ABILITY_KEYS, abilityMeta } from "./abilityRegistry.js";
import {
  FILL_TAIL_ABILITY_CAP,
  FILL_TAIL_GENERATION_TAG,
} from "./abilityDerivation.js";
// Truppernes aldersgrænser — U23-fødslens interval udledes af dem, aldrig af en
// lokal kopi. `squads.js` importerer kun `riderSeasonAge.js`, så der er ingen cyklus.
import { SQUAD_MAX_AGE } from "./squads.js";

// ── Skala-konstanter (evne-rummet) ───────────────────────────────────────────
export const ABILITY_FLOOR = 1;
export const ABILITY_CEIL = 99;

// PCM-skalaens billede i evne-rummet. KUN brugt som dokumenteret HERKOMST for
// tallene nedenfor (og som kontrakt i testen) — ingen runtime-sti bruger en
// stat-værdi.
export const PCM_TO_ABILITY_GAIN = 98 / 35; // 2,8 evne-point pr. stat-point

/** stat-enheder → evne-enheder (kun til tabel-herkomst/test, ikke runtime-input). */
export const statPointsToAbility = (points) => points * PCM_TO_ABILITY_GAIN;
/** stat-NIVEAU (50-85) → evne-NIVEAU (1-99). */
export const statLevelToAbility = (stat) => (stat - 50) * PCM_TO_ABILITY_GAIN + 1;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// ── Privat seeded PRNG ───────────────────────────────────────────────────────
// Bevidst en LOKAL mulberry32 i stedet for at importere makeRng fra
// fictionalRiderGenerator.js: generatoren importerer denne fil, og en import
// den anden vej ville lave en cyklus. `riderBirthPriors.test.js` beviser at de
// to strømme er bit-identiske for samme seed, så "lokal kopi" ikke kan drive.
export function makeBirthRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng, mean, sd) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const uniform = (rng, lo, hi) => lo + rng() * (hi - lo);

// ── Kvalitets-bånd (tiers) i evne-enheder ────────────────────────────────────
// Spejling af TIERS i fictionalRiderGenerator.js:
//   superstar  statMean 70,75 sd 1,50 dampScale 0,35 → evne 59,1 sd 4,20
//   star       statMean 67,00 sd 2,50 dampScale 0,50 → evne 48,6 sd 7,00
//   solid      statMean 63,75 sd 2,75 dampScale 0,75 → evne 39,5 sd 7,70
//   domestique statMean 53,00 sd 3,50 dampScale 1,00 → evne  9,4 sd 9,80
// `level` er det fysiologi-NIVEAU (0..1) tieren i forvejen bærer
// (TIER_PHYSIOLOGY_LEVEL) — bevaret så krops-/fysiologi-seedingen er uændret.
export const BIRTH_TIERS = Object.freeze({
  superstar:  Object.freeze({ mean: statLevelToAbility(70.75), sd: statPointsToAbility(1.5),  dampScale: 0.35, level: 0.92 }),
  star:       Object.freeze({ mean: statLevelToAbility(67),    sd: statPointsToAbility(2.5),  dampScale: 0.5,  level: 0.75 }),
  solid:      Object.freeze({ mean: statLevelToAbility(63.75), sd: statPointsToAbility(2.75), dampScale: 0.75, level: 0.55 }),
  domestique: Object.freeze({ mean: statLevelToAbility(53),    sd: statPointsToAbility(3.5),  dampScale: 1,    level: 0.30 }),
});

export const BIRTH_TIER_KEYS = Object.freeze(Object.keys(BIRTH_TIERS));

// Værdimodellens type-offset-modvægt (TYPE_MEAN_ADJUST), i evne-enheder.
export const TYPE_MEAN_ADJUST_ABILITY = Object.freeze({
  sprinter: statPointsToAbility(-1.5), climber: statPointsToAbility(-0.5),
  brostensrytter: 0, baroudeur: statPointsToAbility(0.5),
  gc: statPointsToAbility(0.5), tt: statPointsToAbility(-1),
  rouleur: statPointsToAbility(1.5), puncheur: statPointsToAbility(1.5),
});

// Boost-jitter (intBetween(-2,2) stat-point) og damp-magnitude (uniform 5-10
// stat-point), begge i evne-enheder.
const BOOST_JITTER_ABILITY = statPointsToAbility(2);
const DAMP_LO_ABILITY = statPointsToAbility(5);
const DAMP_HI_ABILITY = statPointsToAbility(10);

// ── Arketype-profiler i EVNE-rummet ──────────────────────────────────────────
// `boost` er evne-point oven på tier-niveauet; `damp` er de evner der trækkes
// ned (rolle-svaghed ON, ejer-beslutning). Tallene er ARCHETYPES (fictional-
// RiderGenerator.js) × 2,8, med stat-nøglerne oversat til evne-nøgler via
// registrets egen derivation-mapping (stat_bj→climbing osv.).
//
// `stat_prl` (prolog) har INGEN evne: abilityDerivation slår den sammen med
// stat_tt via max(). tt-arketypens prl-boost (10) er derfor absorberet i
// time_trial-boostet (12), som er det største af de to — præcis hvad max()
// gjorde. Det er den ENESTE af de 14 stats der ikke har en 1:1-evne.
//
// Ingen NYE arketyper er opfundet: listen er nøjagtig de 8 der findes i
// ARCHETYPES/PHYSIOLOGY_ARCHETYPES/CLASSIFIER_WEIGHTS i forvejen.
export const BIRTH_ARCHETYPE_PROFILES = Object.freeze({
  sprinter: Object.freeze({
    boost: Object.freeze({ sprint: statPointsToAbility(12), acceleration: statPointsToAbility(9), flat: statPointsToAbility(6) }),
    damp: Object.freeze(["climbing", "tempo", "endurance"]),
  }),
  tt: Object.freeze({
    boost: Object.freeze({ time_trial: statPointsToAbility(12), flat: statPointsToAbility(5) }),
    damp: Object.freeze(["sprint", "punch", "climbing"]),
  }),
  climber: Object.freeze({
    boost: Object.freeze({ climbing: statPointsToAbility(12), tempo: statPointsToAbility(8), punch: statPointsToAbility(5), endurance: statPointsToAbility(5) }),
    damp: Object.freeze(["sprint", "acceleration", "flat"]),
  }),
  puncheur: Object.freeze({
    boost: Object.freeze({ punch: statPointsToAbility(11), tempo: statPointsToAbility(8), climbing: statPointsToAbility(6), endurance: statPointsToAbility(5) }),
    damp: Object.freeze(["time_trial", "sprint"]),
  }),
  brostensrytter: Object.freeze({
    boost: Object.freeze({ cobblestone: statPointsToAbility(13), flat: statPointsToAbility(7), endurance: statPointsToAbility(5), punch: statPointsToAbility(5) }),
    damp: Object.freeze(["climbing", "sprint"]),
  }),
  baroudeur: Object.freeze({
    boost: Object.freeze({
      aggression: statPointsToAbility(11), flat: statPointsToAbility(5), punch: statPointsToAbility(5),
      endurance: statPointsToAbility(6), descending: statPointsToAbility(5), recovery: statPointsToAbility(5),
    }),
    damp: Object.freeze(["time_trial"]),
  }),
  rouleur: Object.freeze({
    boost: Object.freeze({ flat: statPointsToAbility(6), endurance: statPointsToAbility(5), recovery: statPointsToAbility(4) }),
    damp: Object.freeze([]),
    // Loft så rouleur ikke guardes ud af sin egen type (ARCHETYPES.capSpeciality 76).
    capSpeciality: statLevelToAbility(76),
  }),
  gc: Object.freeze({
    boost: Object.freeze({
      climbing: statPointsToAbility(10), time_trial: statPointsToAbility(9), recovery: statPointsToAbility(8),
      tempo: statPointsToAbility(7), endurance: statPointsToAbility(5), durability: statPointsToAbility(5),
    }),
    damp: Object.freeze(["sprint"]),
    // Hårdt gulv → type-GUARDS i riderTypes.js kan opfyldes ved ALLE tiers
    // (ARCHETYPES.minStats 72/67/67).
    minAbilities: Object.freeze({
      climbing: statLevelToAbility(72), time_trial: statLevelToAbility(67), recovery: statLevelToAbility(67),
    }),
  }),
});

export const BIRTH_ARCHETYPE_KEYS = Object.freeze(Object.keys(BIRTH_ARCHETYPE_PROFILES));

// Evner der tæller som "speciale" for rouleur-loftet (spejler SPECIALITY_STATS).
const SPECIALITY_ABILITIES = Object.freeze([
  "climbing", "tempo", "punch", "cobblestone", "time_trial", "sprint",
]);

// ── Sammensatte evner ────────────────────────────────────────────────────────
// To evner har ingen egen arketype-signatur; de er i dag SAMMENSAT af andre
// evner i abilityDerivation.js, og den sammensætning bevares her (uden alder).
//   positioning = 0,50·flat + 0,30·descending + 0,20·aggression  (uændret)
//   tactics     = 0,60·aggression + 0,40·descending              (NY — se hovedet)
//   cobblestone = 0,85·egen prior + 0,15·durability              (uændret blanding)
// Rækkefølgen er afhængighedsrækkefølge: kilderne trækkes FØR de sammensatte.
export const COMPOSITE_ABILITIES = Object.freeze({
  cobblestone: Object.freeze({ self: 0.85, from: Object.freeze({ durability: 0.15 }) }),
  positioning: Object.freeze({ self: 0, from: Object.freeze({ flat: 0.5, descending: 0.3, aggression: 0.2 }) }),
  tactics: Object.freeze({ self: 0, from: Object.freeze({ aggression: 0.6, descending: 0.4 }) }),
});

// ── Default-prior pr. kategori ───────────────────────────────────────────────
// Sikkerhedsnettet for enhver evne der IKKE er navngivet i en arketype-profil
// og ikke er sammensat — fx #5268's `teamwork`/`leadership` den dag de lander i
// registret. `meanScale` skalerer tier-niveauet; `sdScale` tier-spredningen.
//
// mental: 0,80 af niveauet og en BREDERE spredning (1,15) — en mental evne er
// mindre koblet til rytterens fysiske klasse end en fysisk evne er, så en
// domestique kan sagtens være en stærk holdkammerat. Det er samme forhold som
// aggression i praksis har i dag, målt over prod (§2.1: aggression-median ligger
// tæt på de fysiske evners, men med bredere hale).
export const DEFAULT_PRIOR_BY_CATEGORY = Object.freeze({
  physical:  Object.freeze({ meanScale: 1, sdScale: 1 }),
  technical: Object.freeze({ meanScale: 1, sdScale: 1 }),
  mental:    Object.freeze({ meanScale: 0.8, sdScale: 1.15 }),
});
const FALLBACK_PRIOR = Object.freeze({ meanScale: 1, sdScale: 1 });

// ── Alders-kurver (undtagelsen, ikke reglen) ─────────────────────────────────
// KUN evner hvor designet udtrykkeligt siger at alder er en legitim driver må
// stå her. `leadership` gør (D-030): erfaring er en del af hvad lederskab ER.
// `tactics`/`aggression` gør IKKE og står derfor ikke her — se filhovedet.
//
// Modellen: peak ved `peakAge`, lineær op/ned, målt i evne-point. En 19-årig
// U23-rytter får −9 point, en 31-årig +3 (loft), en 38-årig +3.
export const AGE_CURVED = Object.freeze({
  leadership: Object.freeze({ peakAge: 31, perYearBelowPeak: 0.75, maxBelow: 12, abovePeakGain: 0 }),
});

function ageOffsetFor(key, age) {
  const curve = AGE_CURVED[key];
  if (!curve || !Number.isFinite(age)) return 0;
  const below = Math.max(0, curve.peakAge - age);
  return -Math.min(curve.maxBelow, below * curve.perYearBelowPeak);
}

// ── Blanding af primært + sekundært anlæg ────────────────────────────────────
// Samme konvekse model som generatorens `blendArchetypeShape`: boost er et
// vægtet snit over UNIONEN, damp er en SKALA i [0,1] i stedet for en liste, og
// en evne der er ét af anlæggenes signatur dæmpes ikke.
//
// Vægten er 0 i produktionen, præcis som SECONDARY_SIGNATURE_WEIGHT er det for
// voksen-stien i dag (se dens lange begrundelse i fictionalRiderGenerator.js:
// race:gate's bånd er en golden-population-fixture og falder ved enhver vægt
// > 0). Knappen findes så bi-typens vægt kan måles ét sted, ikke to.
export const BIRTH_SECONDARY_SIGNATURE_WEIGHT = 0;

export function blendBirthProfiles(primaryKey, secondaryKey, weight = BIRTH_SECONDARY_SIGNATURE_WEIGHT) {
  const primary = BIRTH_ARCHETYPE_PROFILES[primaryKey];
  if (!primary) throw new Error(`riderBirthPriors: unknown archetype ${primaryKey}`);
  const secondary = secondaryKey && secondaryKey !== primaryKey ? BIRTH_ARCHETYPE_PROFILES[secondaryKey] : null;
  const w = secondary ? clamp(Number(weight) || 0, 0, 0.5) : 0;

  const boost = {};
  for (const key of new Set([...Object.keys(primary.boost), ...Object.keys(secondary?.boost ?? {})])) {
    const v = (primary.boost[key] ?? 0) * (1 - w) + (secondary?.boost[key] ?? 0) * w;
    if (v > 0) boost[key] = v;
  }
  const damp = {};
  for (const key of new Set([...(primary.damp ?? []), ...(secondary?.damp ?? [])])) {
    if (boost[key]) continue; // et anlægs signatur dæmpes aldrig
    const v = (primary.damp?.includes(key) ? 1 - w : 0) + (secondary?.damp?.includes(key) ? w : 0);
    if (v > 0) damp[key] = v;
  }
  return {
    boost,
    damp,
    minAbilities: primary.minAbilities ?? null,
    capSpeciality: primary.capSpeciality ?? null,
  };
}

// ── Ungdoms-bånd (akademi-intake / U23-fødsel) ───────────────────────────────
// Spejling af YOUTH_GEN_CONFIG (academyGenerator.js) i evne-enheder — samme
// faktor 2,8, samme invariant: en ungdomsrytters NUVÆRENDE evne må aldrig løfte
// ability_caps over det loft hans potentiale tillader (G5, #3561/#2064 §2a).
//   baseStatAt16 47,5      → evne  -6,0 (klampes til gulvet, dvs. reelt 1)
//   statPerYearOver16 1,4  → evne   3,92 pr. år over 16
//   potStartLift 0,5       → evne   1,40 pr. potentiale-trin over 1
//   startLuckSd 0,6        → evne   1,68
//   sd 0,8                 → evne   2,24
//   statFloor 48,5 / ceil 54 → evne -3,2 / 12,2  (gulvet klampes til 1)
// Signatur-boostet er PROPORTIONALT med klassifikator-vægten (#3458 fase 2) og
// bevares som sådan: signatureBoostPerWeight 0,8 → 2,24 evne-point pr. vægt.
export const YOUTH_BIRTH_BAND = Object.freeze({
  baseAt16: statLevelToAbility(47.5),
  perYearOver16: statPointsToAbility(1.4),
  potStartLift: statPointsToAbility(0.5),
  startLuckSd: statPointsToAbility(0.6),
  sd: statPointsToAbility(0.8),
  floor: statLevelToAbility(48.5),
  ceil: statLevelToAbility(54),
  ceilBoosted: statLevelToAbility(54),
  signatureBoostPerWeight: statPointsToAbility(0.8),
  dampPerWeight: statPointsToAbility(1.0),
  secondarySignatureWeight: 0.1,
  gcTimeTrialBoostRatio: 0.55,
  gcClimbingBoostRatio: 0.85,
});

// ── U23-fødselsbåndet (engangs-truppen til AI-holdene) ───────────────────────
//
// HVAD DET IKKE ER: det her flytter IKKE hvor ryttere fødes i spillet. Ryttere
// fødes fortsat som 16-årige i AKADEMIET, på `YOUTH_BIRTH_BAND`, og den sti er
// bit for bit uændret. Båndet nedenfor bruges ét sted og til ét formål:
// ENGANGS-genereringen af en U23-trup (6-9 ryttere, 19-22 år) til hvert AI-hold
// ved S4-cutover, så U23-kalenderens løb har køreklare felter fra dag ét
// (GDD D-054 §10.4, spec `docs/superpowers/specs/2026-09-15-u23-kalender-og-
// trup-datamodel-design.md` §4.4 + §10.4). Efter cutover er der ingen løbende
// U23-fødsel: U23-truppen fyldes af akademiet, der graduerer opad.
//
// HVORFOR ET EGET BÅND: akademiets bånd er kalibreret til 16-21 år, hvor det er
// en TILSIGTET invariant at evnerne mætter mod loftet (G5, #3561/#2064 §2a: en
// ungdomsrytters NUVÆRENDE evne må ikke løfte `ability_caps` over det loft hans
// potentiale tillader). Netop dét loft rammer igennem i den øvre ende af
// U23-intervallet, hvor alderen så holder op med at flytte noget — målt i
// generator-rapportens §8 (#5283/#5376). Brugtes akademiets bånd som det er,
// ville en 19-årig og en 22-årig U23-rytter fødes praktisk talt ens.
//
// EJER-VALG 18/9 2026 (#5376), variant A — "løft loftet, behold rampen":
// U23-stien får ét højere loft, mens FORANKRING (`baseAt16`), ALDERS-RAMPE
// (`perYearOver16`) og SPREDNING (`sd`, `startLuckSd`) er akademiets uændret.
// Alders-rampen fandtes allerede; det var kun klipningen mod loftet der fjernede
// dens virkning. Fravalgt: et helt eget bånd med egen rampe og spredning (B,
// to bånd at holde i sync) og et alders-rampet loft der kun gav den ældste
// årgang luft (C, løste ikke mætningen længere nede).
//
// Prisen ejeren købte med: de tre år (19-21) der OVERLAPPER akademiets interval
// trækkes nu forskelligt alt efter hvor rytteren kommer fra — en akademi-
// graduand og en U23-fødsel på samme alder er ikke længere samme fordeling.
// Det er tilsigtet og gælder kun engangs-kuldet; akademiet selv er urørt.
//
// Båndet er AFLEDT af akademiets, ikke en kopi: alt andet end loftet arves med
// spread, så en fremtidig ændring af akademiets forankring/rampe/spredning
// følger med af sig selv i stedet for at drive i stilhed. `u23BandOverrides()`
// + testen i `riderBirthPriors.test.js` beviser at loftet er den ENESTE forskel.
/** Loftet som stat-NIVEAU — samme sprog som akademiets `statCeil` er skrevet i. */
export const U23_BIRTH_CEIL_STAT_LEVEL = 60;
const U23_BIRTH_CEIL = statLevelToAbility(U23_BIRTH_CEIL_STAT_LEVEL);

export const U23_BIRTH_BAND = Object.freeze({
  ...YOUTH_BIRTH_BAND,
  ceil: U23_BIRTH_CEIL,
  ceilBoosted: U23_BIRTH_CEIL,
});

/** Præcis de felter U23-båndet afviger fra akademiets på — test-kontrakt for variant A. */
export function u23BandOverrides() {
  const diff = {};
  for (const key of new Set([...Object.keys(YOUTH_BIRTH_BAND), ...Object.keys(U23_BIRTH_BAND)])) {
    if (!Object.is(YOUTH_BIRTH_BAND[key], U23_BIRTH_BAND[key])) diff[key] = U23_BIRTH_BAND[key];
  }
  return diff;
}

// Fødselsaldrene er IKKE frit valgte og kopieres ikke: de er truppens egne
// aldersgrænser (`squads.js` → `riderSeasonAge.js`). U23 er sæson-alder ≤ 22, og
// en rytter der er vokset ud af junior er 19. Flytter ejeren en grænse, flytter
// fødsels-intervallet med i stedet for at stå tilbage som en lokal kopi.
export const U23_BIRTH_AGE_MIN = SQUAD_MAX_AGE.junior + 1;
export const U23_BIRTH_AGE_MAX = SQUAD_MAX_AGE.u23;

/** Markørens tier for en U23-fødsel — den nøgle re-derivationen vælger bånd på. */
export const U23_BIRTH_TIER = "u23";
/** Markørens tier for en akademi-fødsel (akademiets bånd). */
export const YOUTH_BIRTH_TIER = "youth";

/** Båndet en fødsels-markørs tier hører til, eller `null` for en voksen-tier. */
export function birthBandForTier(tier) {
  if (tier === YOUTH_BIRTH_TIER) return YOUTH_BIRTH_BAND;
  if (tier === U23_BIRTH_TIER) return U23_BIRTH_BAND;
  return null;
}

// ── Evne-listen (fra registret — ALDRIG hardcodet) ───────────────────────────
/** Alle evner en nyfødt skal have en prior for, i lagrings-orden. */
export function birthAbilityKeys() {
  return REGISTRY_ABILITY_KEYS;
}

function priorScalesFor(key) {
  const meta = abilityMeta(key);
  return DEFAULT_PRIOR_BY_CATEGORY[meta?.category] ?? FALLBACK_PRIOR;
}

/** Evner uden egen arketype-signatur og uden sammensætning — rene default-priors. */
export function abilitiesOnDefaultPrior() {
  const named = new Set();
  for (const profile of Object.values(BIRTH_ARCHETYPE_PROFILES)) {
    for (const k of Object.keys(profile.boost)) named.add(k);
    for (const k of profile.damp ?? []) named.add(k);
  }
  return REGISTRY_ABILITY_KEYS.filter((k) => !named.has(k) && !COMPOSITE_ABILITIES[k]);
}

// ── Hovedtrækket: én voksen rytters fødselsevner ─────────────────────────────
/**
 * Træk et komplet evne-sæt for ÉN nyfødt VOKSEN rytter direkte fra priorerne.
 * Ingen `stat_*` indgår — hverken som input eller output.
 *
 * @param {object}   args
 * @param {function} args.rng          seeded PRNG (makeBirthRng)
 * @param {string}   args.tier         superstar|star|solid|domestique
 * @param {string}   args.archetype    primært anlæg
 * @param {string}   [args.secondaryArchetype] sekundært anlæg (bi-typen)
 * @param {number}   [args.secondaryWeight]    bi-typens vægt (default: 0, se konstanten)
 * @param {number}   [args.age]        alder — KUN brugt af AGE_CURVED-evner (leadership)
 * @param {string[]} [args.abilityKeys] evne-liste (default: registret)
 * @returns {Object<string, number>} evne → 1-99
 */
export function drawBirthAbilities({
  rng,
  tier,
  archetype,
  secondaryArchetype = null,
  secondaryWeight = BIRTH_SECONDARY_SIGNATURE_WEIGHT,
  age = null,
  abilityKeys = REGISTRY_ABILITY_KEYS,
}) {
  const band = BIRTH_TIERS[tier];
  if (!band) throw new Error(`riderBirthPriors: unknown tier ${tier}`);
  const shape = blendBirthProfiles(archetype, secondaryArchetype, secondaryWeight);
  const base = band.mean + (TYPE_MEAN_ADJUST_ABILITY[archetype] ?? 0);

  const out = {};
  // Trin 1: alle IKKE-sammensatte evner. Rækkefølgen er registrets lagrings-
  // orden, så en evne der TILFØJES bagest (som #5268's teamwork/leadership)
  // ikke kan forskyde trækkene for de evner der lå der før.
  for (const key of abilityKeys) {
    if (COMPOSITE_ABILITIES[key] && !COMPOSITE_ABILITIES[key].self) continue;
    const scales = priorScalesFor(key);
    let v = gaussian(rng, base * scales.meanScale, band.sd * scales.sdScale);
    if (shape.boost[key]) {
      v += shape.boost[key] + uniform(rng, -BOOST_JITTER_ABILITY, BOOST_JITTER_ABILITY);
    } else if (shape.damp[key]) {
      v -= uniform(rng, DAMP_LO_ABILITY, DAMP_HI_ABILITY) * band.dampScale * shape.damp[key];
    }
    v += ageOffsetFor(key, age);
    out[key] = clamp(v, ABILITY_FLOOR, ABILITY_CEIL);
  }

  // Trin 2: gulv/loft fra anlægget (gc's type-guard-gulv, rouleurs speciale-loft).
  if (shape.minAbilities) {
    for (const [key, floor] of Object.entries(shape.minAbilities)) {
      if (out[key] != null && out[key] < floor) out[key] = clamp(floor, ABILITY_FLOOR, ABILITY_CEIL);
    }
  }
  if (shape.capSpeciality != null) {
    for (const key of SPECIALITY_ABILITIES) {
      if (out[key] != null) out[key] = Math.min(out[key], shape.capSpeciality);
    }
  }

  // Trin 3: de sammensatte evner, oven på de færdige kilder.
  for (const key of abilityKeys) {
    const recipe = COMPOSITE_ABILITIES[key];
    if (!recipe) continue;
    let v = (out[key] ?? 0) * recipe.self;
    for (const [src, w] of Object.entries(recipe.from)) v += (out[src] ?? base) * w;
    out[key] = clamp(v, ABILITY_FLOOR, ABILITY_CEIL);
  }

  for (const key of abilityKeys) out[key] = Math.round(out[key]);
  return out;
}

// ── Ungdoms-trækket (akademi / U23) ──────────────────────────────────────────
/**
 * Træk evner for ÉN nyfødt UNG rytter (16-22) i ungdomsbåndet.
 * Samme prior-idé som voksen-trækket, men niveauet er alders- og
 * potentiale-rampen fra YOUTH_BIRTH_BAND, og signatur-boostet er
 * proportionalt med klassifikator-vægten (#3458 fase 2).
 *
 * @param {object} args
 * @param {function} args.rng
 * @param {number} args.age
 * @param {number} args.potentiale
 * @param {string} args.archetype
 * @param {string} [args.secondaryArchetype]
 * @param {Object<string,Object<string,number>>} args.classifierWeightsByType
 *        klassifikator-vægte pr. type — SENDES IND (riderTypes.js læses af
 *        kaldstedet), så denne fil hverken importerer eller kan røre weights/*.
 * @param {string[]} [args.abilityKeys]
 * @param {object} [args.band]
 */
export function drawYouthBirthAbilities({
  rng,
  age,
  potentiale,
  archetype,
  secondaryArchetype = null,
  classifierWeightsByType,
  abilityKeys = REGISTRY_ABILITY_KEYS,
  band = YOUTH_BIRTH_BAND,
}) {
  if (!BIRTH_ARCHETYPE_PROFILES[archetype]) throw new Error(`riderBirthPriors: unknown archetype ${archetype}`);
  const shape = blendYouthSignature(archetype, secondaryArchetype, classifierWeightsByType, band);

  const ageLift = Math.max(0, (Number(age) || 16) - 16) * band.perYearOver16;
  const potLift = (clamp(Number(potentiale) || 1, 1, 6) - 1) * band.potStartLift;
  const startLuck = gaussian(rng, 0, band.startLuckSd); // ÉT træk pr. rytter
  const base = band.baseAt16 + ageLift + potLift + startLuck;

  const out = {};
  for (const key of abilityKeys) {
    if (COMPOSITE_ABILITIES[key] && !COMPOSITE_ABILITIES[key].self) continue;
    const scales = priorScalesFor(key);
    let v = gaussian(rng, base * scales.meanScale, band.sd * scales.sdScale);
    let ceil = band.ceil;
    if (shape.boost[key]) {
      v += shape.boost[key] * band.signatureBoostPerWeight;
      ceil = band.ceilBoosted;
    } else if (shape.damp[key]) {
      v -= shape.damp[key] * band.dampPerWeight;
    }
    v += ageOffsetFor(key, age);
    out[key] = clamp(v, Math.max(ABILITY_FLOOR, band.floor), ceil);
  }

  for (const key of abilityKeys) {
    const recipe = COMPOSITE_ABILITIES[key];
    if (!recipe) continue;
    let v = (out[key] ?? 0) * recipe.self;
    for (const [src, w] of Object.entries(recipe.from)) v += (out[src] ?? base) * w;
    out[key] = clamp(v, Math.max(ABILITY_FLOOR, band.floor), band.ceil);
  }

  for (const key of abilityKeys) out[key] = Math.round(out[key]);
  return out;
}

// ── U23-trækket (engangs-truppen til AI-holdene, D-054 §10.4) ────────────────
/**
 * Træk evner for ÉN nyfødt U23-rytter (19-22) i U23-båndet.
 *
 * REN funktion: ingen DB, ingen `Math.random`, ingen `stat_*`, ingen I/O. Den
 * er hele U23-fødslens evne-side og er skrevet til at blive kaldt af den
 * kommende engangs-generator (spec A6) — den generator findes IKKE endnu, og
 * INTET produktions-kaldsted kalder denne funktion i dag. Det er med vilje:
 * selve genereringen er en ejer-gated engangs-handling ved S4-cutover, og den
 * må ikke kunne udløses som sideeffekt af at båndet blev bygget.
 *
 * Trækket er PRÆCIS akademiets (`drawYouthBirthAbilities`) — samme kodesti, ikke
 * en parallel kopi — blot med `U23_BIRTH_BAND` som bånd. Måles et bånd ad en
 * anden kodesti end den der fødes på, måler man en anden rytter (#2065).
 *
 * @param {object} args  som `drawYouthBirthAbilities`, men `age` SKAL ligge i
 *                       U23-fødselsintervallet.
 * @returns {Object<string, number>} evne → 1-99
 */
export function drawU23BirthAbilities({
  rng,
  age,
  potentiale,
  archetype,
  secondaryArchetype = null,
  classifierWeightsByType,
  abilityKeys = REGISTRY_ABILITY_KEYS,
}) {
  // Alderen valideres HER og ikke i generatoren. Båndets niveau er
  // `baseAt16 + (alder − 16)·perYearOver16`: en alder uden for intervallet ville
  // give et gyldigt-udseende evne-sæt for en rytter der ikke kan stå i truppen —
  // enten straks for gammel (≥ 23, Graduation Day) eller en junior i U23-tøj.
  // Ingen coercion: en generator der sender "20" eller null har en fejl, og en
  // stille omregning ville skjule den bag et gyldigt-udseende evne-saet.
  if (!Number.isInteger(age) || age < U23_BIRTH_AGE_MIN || age > U23_BIRTH_AGE_MAX) {
    throw new Error(
      `riderBirthPriors: U23-fødselsalder skal være et helt tal i [${U23_BIRTH_AGE_MIN},${U23_BIRTH_AGE_MAX}] — fik ${JSON.stringify(age)}`,
    );
  }
  return drawYouthBirthAbilities({
    rng,
    age,
    potentiale,
    archetype,
    secondaryArchetype,
    classifierWeightsByType,
    abilityKeys,
    band: U23_BIRTH_BAND,
  });
}

// Signatur-profil i EVNE-rummet, proportional med klassifikatorens egne vægte
// (#3458 fase 2). Modsat academyGenerator.js' `signatureProfile` er der ingen
// ability→stat-oversættelse undervejs: vægtene ER allerede evne-nøglede.
function blendYouthSignature(primaryKey, secondaryKey, weightsByType, band) {
  const profileFor = (key) => {
    const weights = weightsByType?.[key];
    if (!weights) throw new Error(`riderBirthPriors: no classifier weights for ${key}`);
    const boost = {};
    const damp = {};
    for (const [ability, w] of Object.entries(weights)) {
      if (w > 0) boost[ability] = w;
      else if (w < 0) damp[ability] = -w;
    }
    if (key === "gc") {
      if (boost.time_trial) boost.time_trial *= band.gcTimeTrialBoostRatio;
      if (boost.climbing) boost.climbing *= band.gcClimbingBoostRatio;
    }
    return { boost, damp };
  };

  const a = profileFor(primaryKey);
  const w = clamp(Number(band.secondarySignatureWeight ?? 0), 0, 0.5);
  if (!secondaryKey || secondaryKey === primaryKey || w === 0) return a;
  const b = profileFor(secondaryKey);
  const boost = {};
  for (const key of new Set([...Object.keys(a.boost), ...Object.keys(b.boost)])) {
    boost[key] = (a.boost[key] ?? 0) * (1 - w) + (b.boost[key] ?? 0) * w;
  }
  // KUN de FÆLLES svagheder dæmpes (samme regel som akademi-stien i dag).
  const damp = {};
  for (const key of Object.keys(a.damp)) {
    if (key in b.damp) damp[key] = a.damp[key] * (1 - w) + b.damp[key] * w;
  }
  return { boost, damp };
}

// ── Skjult potentiale ────────────────────────────────────────────────────────
// Uændret formel-FORM fra abilityDerivation.js: den bygger på `potentiale` og
// alder, ALDRIG på en stat, og er derfor ikke berørt af PCM-afviklingen.
// Gentaget her (ikke importeret) fordi den er privat i abilityDerivation.js —
// `riderBirthPriors.test.js` beviser at de to giver samme tal for samme input.
function hashNoise(id) {
  const s = String(id ?? "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

export function birthHiddenPotential({ potentiale, age, id }) {
  const potRaw = Number(potentiale);
  const potential = Number.isFinite(potRaw) ? clamp((potRaw - 1) / 5, 0, 1) : 0.4;
  const a = Number.isFinite(Number(age)) ? clamp(Number(age), 16, 45) : 25;
  const youth = clamp((32 - a) / (32 - 21), 0, 1);
  const frac = 0.6 * potential + 0.25 * youth + 0.15 * hashNoise(id);
  return clamp(Math.round(1 + clamp(frac, 0, 1) * 98), 1, 99);
}

// ── Fødsels-markøren (persisteret, så re-derivation kan reproducere trækket) ──
//
// Den ligger i `riders.archetype_draw` (jsonb), som ALLEREDE persisteres for
// hver generator-født rytter (toInsertPayload → archetype_draw). Ingen
// migration: vi tilføjer et `birth`-felt ved siden af de eksisterende
// `primary`/`secondary`, og enhver eksisterende læser (`draw.primary`,
// `draw.secondary` i backfillCores.js/riderTypes.js) ser præcis det samme som før.
//
// Hvorfor markøren SKAL være persisteret: `deriveForRiderIds` kaldes IGEN ved
// enhver re-derive (riderDeriveHealSweep #1673, starterSquadHealSweep,
// backfill-scripts). Uden markøren ville en nyfødt rytter med `stat_* = NULL`
// få hele sit evne-sæt re-udledt til 1 af PCM-fallbacken. MED markøren
// reproduceres PRÆCIS det oprindelige træk, fordi seed'en ligger i rækken.
export const BIRTH_MARKER_VERSION = 1;

/**
 * @param {object} args
 * @param {string} args.tier
 * @param {number} args.seed
 * @param {number|null} [args.cap] evne-loft der følger rytteren (se nedenfor)
 * @param {number|null} [args.age] FØDSELS-alderen, ikke den nuværende
 */
export function makeBirthMarker({ tier, seed, cap = null, age = null }) {
  if (!BIRTH_TIERS[tier]) throw new Error(`riderBirthPriors: unknown tier ${tier}`);
  if (!Number.isInteger(seed)) throw new Error("riderBirthPriors: birth seed must be an integer");
  const marker = { v: BIRTH_MARKER_VERSION, tier, seed: seed >>> 0 };
  if (age != null && Number.isFinite(Number(age))) marker.age = Math.round(Number(age));
  // `cap` = et EVNE-loft der følger rytteren resten af livet gennem
  // re-derivationen. Det er own-priors-stiens erstatning for det STAT-vindue
  // buildWeakStarterPool (#1487) klemte fyld-/start-trups-ryttere ind i: uden et
  // stat-felt at klemme skal loftet stå i markøren, ellers ville en heal-sweep
  // genoplive en ukLEMT profil. Se withBirthAbilityCap nedenfor.
  // `cap == null` betyder INTET loft. Testen skal være mod null/undefined og ikke
  // kun Number.isFinite: Number(null) er 0 og fuldt finit, så en ren
  // isFinite-test ville give hver eneste rytter loftet 1.
  if (cap != null && Number.isFinite(Number(cap))) {
    marker.cap = Math.round(clamp(Number(cap), ABILITY_FLOOR, ABILITY_CEIL));
  }
  return marker;
}

/**
 * Sæt (eller sænk) evne-loftet i en allerede trukket fødsels-markør.
 * Ren funktion — returnerer et NYT draw-objekt, muterer ikke input.
 * Loftet kan kun sænkes, aldrig hæves: et kuld der først er født svagt må ikke
 * kunne blive stærkt af at passere endnu et kaldsted.
 */
export function withBirthAbilityCap(archetypeDraw, cap) {
  if (!archetypeDraw?.birth || cap == null || !Number.isFinite(Number(cap))) return archetypeDraw;
  const next = Math.round(clamp(Number(cap), ABILITY_FLOOR, ABILITY_CEIL));
  const prev = archetypeDraw.birth.cap;
  const current = prev != null && Number.isFinite(Number(prev)) ? Number(prev) : ABILITY_CEIL;
  return {
    ...archetypeDraw,
    birth: { ...archetypeDraw.birth, cap: Math.min(current, next) },
  };
}

/**
 * @param {object} args
 * @param {number} args.seed
 * @param {number|null} [args.age] FØDSELS-alderen (se kommentaren nedenfor)
 */
export function makeYouthBirthMarker({ seed, age = null }) {
  if (!Number.isInteger(seed)) throw new Error("riderBirthPriors: birth seed must be an integer");
  const marker = { v: BIRTH_MARKER_VERSION, tier: "youth", seed: seed >>> 0 };
  // FØDSELS-alderen, ikke den nuværende. Ungdomsbåndets niveau er
  // `baseAt16 + (alder − 16)·perYearOver16`; brugte re-derivationen rytterens
  // NUVÆRENDE alder, ville hver sæson løfte hans start-evner gratis — uden
  // træning og uden at nogen skrev det. Trækket skal reproducere fødslen, ikke
  // genberegne den. Udvikling ejes af riderProgression, ikke af denne fil.
  if (age != null && Number.isFinite(Number(age))) marker.age = Math.round(Number(age));
  return marker;
}

/**
 * Fødsels-markør for en U23-fødsel. EGEN tier, ikke `"youth"`.
 *
 * Det er ikke kosmetik: `deriveBirthAbilities` vælger BÅND ud fra markørens
 * tier, og enhver re-derive (heal-sweep, backfill) kører igennem den. Bar
 * markøren `"youth"`, ville hver eneste sweep reproducere engangs-kuldet mod
 * AKADEMIETS bånd og klippe rytterne ned til akademiets loft — stille, og først
 * synligt når nogen undrede sig over at U23-felterne var blevet svagere.
 *
 * Alderen er FØDSELS-alderen af samme grund som på ungdoms-markøren: niveauet
 * er alders-rampet, så en re-derive mod den nuværende alder ville løfte
 * start-evnerne gratis hver sæson. Udvikling ejes af `riderProgression.js`.
 */
export function makeU23BirthMarker({ seed, age }) {
  if (!Number.isInteger(seed)) throw new Error("riderBirthPriors: birth seed must be an integer");
  // Ingen coercion: en generator der sender "20" eller null har en fejl, og en
  // stille omregning ville skjule den bag et gyldigt-udseende evne-saet.
  if (!Number.isInteger(age) || age < U23_BIRTH_AGE_MIN || age > U23_BIRTH_AGE_MAX) {
    throw new Error(
      `riderBirthPriors: U23-fødselsalder skal være et helt tal i [${U23_BIRTH_AGE_MIN},${U23_BIRTH_AGE_MAX}] — fik ${JSON.stringify(age)}`,
    );
  }
  return { v: BIRTH_MARKER_VERSION, tier: U23_BIRTH_TIER, seed: seed >>> 0, age };
}

/** Er denne rytter født af spillets egne priors (og altså UDEN PCM-stats)? */
export function isBornFromPriors(riderRow) {
  const draw = riderRow?.archetype_draw;
  return Boolean(draw && typeof draw === "object" && draw.birth && Number(draw.birth.v) >= 1);
}

/**
 * Reproducér en nyfødt rytters evner fra den PERSISTEREDE række alene.
 * Ren funktion — ingen DB, ingen Math.random, ingen `stat_*`.
 *
 * Bruges af enhver re-derivation (deriveForRiderIds → riderDeriveHealSweep,
 * starterSquadHealSweep, backfill-scripts). Determinismen ligger i
 * `archetype_draw.birth.seed`, som blev skrevet ved fødslen.
 *
 * @param {object} riderRow  { id, archetype_draw, potentiale, birthdate, generation_tag }
 * @param {object} [opts]
 * @param {number} [opts.age] alder — KUN til AGE_CURVED-evner + hidden_potential
 * @param {Object<string,Object<string,number>>} [opts.classifierWeightsByType] kræves for ungdoms-markører
 * @returns {Object<string, number>|null} evne-sæt, eller null hvis rytteren ikke er prior-født
 */
export function deriveBirthAbilities(riderRow, { age = null, classifierWeightsByType = null } = {}) {
  if (!isBornFromPriors(riderRow)) return null;
  const draw = riderRow.archetype_draw;
  const { tier, seed } = draw.birth;
  const rng = makeBirthRng(Number(seed) >>> 0);

  // FØDSELS-alderen styrer trækket, ikke rytterens nuværende. Ellers ville hver
  // re-derive (heal-sweep, backfill) genberegne fødslen mod en ny alder: på
  // ungdoms-stien løfter alderen hele niveauet (`perYearOver16`), så en rytter
  // ville blive stærkere for hver sæson der gik, uden træning og uden at nogen
  // skrev det. Udvikling ejes af riderProgression.js — ikke af fødslen.
  //
  // `age`-argumentet (rytterens NUVÆRENDE alder) bruges stadig til
  // hidden_potential, præcis som abilityDerivation.js gør for alle andre
  // ryttere: skjult potentiale falder med alderen, og det er tilsigtet.
  const birthAge = draw.birth.age != null && Number.isFinite(Number(draw.birth.age))
    ? Number(draw.birth.age)
    : age;

  // Båndet vælges af markørens tier. En U23-fødsel (D-054 §10.4) bærer sin egen
  // tier netop for at en heal-sweep ikke reproducerer den mod akademiets bånd.
  //
  // U23-stien går gennem `drawU23BirthAbilities` med den RÅ persisterede alder,
  // ikke gennem en fallback: `makeU23BirthMarker` skriver altid en gyldig alder,
  // så en U23-række UDEN en er korrupt. En fallback ville reproducere den mod en
  // opfundet alder og give et gyldigt-udseende evne-sæt — så ville rækken være
  // repareret i tallene og stadig forkert. Den skal fejle højlydt i stedet.
  const youthBand = birthBandForTier(tier);
  const abilities = tier === U23_BIRTH_TIER
    ? drawU23BirthAbilities({
      rng,
      age: draw.birth.age,
      potentiale: riderRow.potentiale,
      archetype: draw.primary,
      secondaryArchetype: draw.secondary ?? null,
      classifierWeightsByType,
    })
    : youthBand
    ? drawYouthBirthAbilities({
      rng,
      age: birthAge ?? 18,
      potentiale: riderRow.potentiale,
      archetype: draw.primary,
      secondaryArchetype: draw.secondary ?? null,
      classifierWeightsByType,
      band: youthBand,
    })
    : drawBirthAbilities({
      rng,
      tier,
      archetype: draw.primary,
      secondaryArchetype: draw.secondary ?? null,
      age: birthAge,
    });

  abilities.hidden_potential = birthHiddenPotential({
    potentiale: riderRow.potentiale,
    age,
    id: riderRow.id,
  });

  // Evne-loftet fra markøren (#1487's stat-vindue, oversat til evne-rummet).
  // Ligger FØR fill_tail-klemmen, men begge er min() så rækkefølgen er ligegyldig.
  // Samme null-fælde som i makeBirthMarker: Number(null) === 0 er finit, og en
  // ren isFinite-test ville klemme hele rytteren til 0.
  const cap = draw.birth.cap == null ? NaN : Number(draw.birth.cap);
  if (Number.isFinite(cap)) {
    for (const key of Object.keys(abilities)) {
      if (Number.isFinite(abilities[key])) abilities[key] = Math.min(abilities[key], cap);
    }
  }

  // #4311: fyld-ryttere klemmes ved kilden. Loftet ligger i abilityDerivation.js
  // (FILL_TAIL_ABILITY_CAP) og er IMPORTERET, ikke kopieret — den fil ejes af en
  // anden lane og må ikke ændres herfra. Uden denne linje ville et fyld-kuld
  // født på prior-stien slippe uden om klemmen og læse som normale ryttere
  // (præcis den regression #4311 lukkede).
  if (riderRow.generation_tag === FILL_TAIL_GENERATION_TAG) {
    for (const key of Object.keys(abilities)) {
      if (Number.isFinite(abilities[key])) abilities[key] = Math.min(abilities[key], FILL_TAIL_ABILITY_CAP);
    }
  }
  return abilities;
}

// ── Fysiologi-bro ────────────────────────────────────────────────────────────
// `seedPhysiologyFromLegacy` (physiologySeeding.js) forventer 0-99-skalerede
// felter under PCM-navne og normaliserer dem med `/99`. Evner ER 0-99, så en
// prior-født rytter kan seede sin fysiologi fra sine EGNE evner i stedet for at
// falde tilbage på filens 60-default (som ville gøre hver eneste nyfødt
// fysiologisk identisk). Det er en ren NAVNE-bro — ingen PCM-stat findes, og
// intet skrives til `riders.stat_*`.
//
// Profilen forbliver `version 1 / seeded_from_legacy` som resten af
// populationen; v2-arketype-seeding (`aero`) er Task D2 og hører ikke til her —
// den ville tænde fysiologi-stien i abilityDerivation for netop disse ryttere
// og dermed give dem en ANDEN evne-fordeling end resten af spillet.
export const ABILITY_TO_LEGACY_FIELD = Object.freeze({
  climbing: "stat_bj", time_trial: "stat_tt", flat: "stat_fl", tempo: "stat_kb",
  sprint: "stat_sp", acceleration: "stat_acc", punch: "stat_bk", endurance: "stat_udh",
  recovery: "stat_res", durability: "stat_mod", descending: "stat_ned",
  cobblestone: "stat_bro", aggression: "stat_ftr",
});

export function physiologySeedInputFromAbilities(riderRow, abilities) {
  const seedRow = { id: riderRow?.id, height: riderRow?.height, weight: riderRow?.weight };
  for (const [ability, field] of Object.entries(ABILITY_TO_LEGACY_FIELD)) {
    const v = Number(abilities?.[ability]);
    if (Number.isFinite(v)) seedRow[field] = v;
  }
  return seedRow;
}

// Eksporteret til test/diagnostik: hvilke evner i registret er dækket af en
// eksplicit prior, og hvilke lever på kategoriens default?
export function birthPriorCoverage() {
  const onDefault = new Set(abilitiesOnDefaultPrior());
  return ABILITY_REGISTRY.map((a) => ({
    key: a.key,
    category: a.category,
    source: COMPOSITE_ABILITIES[a.key] && !COMPOSITE_ABILITIES[a.key].self
      ? "composite"
      : onDefault.has(a.key) ? "category-default" : "archetype",
    ageCurved: Boolean(AGE_CURVED[a.key]),
  }));
}
