// Evne-registrering (#3665, spec `2026-08-13-rating-fundament-v3-design.md` §D2).
//
// ÉN kilde til sandhed for hvad en evne ER. Før denne fil lå de samme 15 evner
// spredt som parallelle lister i mindst syv filer: VISIBLE_ABILITIES og
// CONTRAST_ABILITIES og PRIMARY_STAT (abilityDerivation.js), ABILITY_KEYS
// (riderTypes.js — en ANDEN liste på 13), ABILITY_CATEGORIES/ABILITY_SHORT/
// ABILITY_ICONS (frontend/src/lib/abilities.js) og en håndholdt vægt-kopi i
// frontend/src/lib/riderRating.js. Ingen af dem kendte til hinanden.
//
// Ejer-krav 13/8: *"vi skal lave systemer fra nu af, så de nemmere kan håndtere
// at der tilføjes en ny evne."* At tilføje en evne er efter denne fil:
//   1. én post herunder
//   2. én DB-kolonne i rider_derived_abilities
//   3. én derivations-regel (`derivation` herunder)
//   4. valgfri plads i en visnings-opskrift (weights/displayRecipes.js)
// Alt andet — kolonner, badges, radar-akser, træningsfokus, i18n-validering,
// farve-skala, PostgREST-select — læser herfra. Se docs/HOWTO_ADD_ABILITY.md.
//
// FELTER
//   key           kolonnenavn i rider_derived_abilities (og evne-nøgle overalt)
//   category      "physical" | "technical" | "mental" — grupperet visning
//   i18nKey       fuld i18n-nøgle til det lange navn
//   shortLabel    2-3 tegns kolonne-label. Oversættes IKKE (#487).
//   icon          glyf til den grupperede evne-visning
//   derivation    hvordan evnen udledes: { source: "pcm", stat } | { source: "skill" }
//   inContrast    indgår i kontrast-forstærkningen (abilityDerivation.js).
//                 De 5 der IKKE gør, lever på en anden fordeling end de 10 der
//                 gør — det er rod-årsagen i #3668, ikke en fejl her.
//   inClassifier  indgår i ryttertype-klassifikatorens input (riderTypes.js).
//                 positioning og tactics gør ikke — klassifikatoren kender kun 13.
//   storageOrder  rækkefølge i VISIBLE_ABILITIES (lagrings-/derivations-orden)
//   displayOrder  rækkefølge i frontendens grupperede visning (ejer-bekræftet #2000)
//
// De to ordener er BEVIDST forskellige og var det også før denne fil; de er nu
// blot begge skrevet ned ét sted i stedet for at leve i hver sin array-literal.

export const ABILITY_REGISTRY = Object.freeze([
  {
    key: "climbing", category: "physical", i18nKey: "rider:racePreview.derived.climbing",
    shortLabel: "CLM", icon: "▲", derivation: { source: "pcm", stat: "stat_bj" },
    inContrast: true, inClassifier: true, storageOrder: 1, displayOrder: 1,
  },
  {
    key: "time_trial", category: "physical", i18nKey: "rider:racePreview.derived.time_trial",
    shortLabel: "TT", icon: "◴", derivation: { source: "pcm", stat: "stat_tt" },
    inContrast: true, inClassifier: true, storageOrder: 2, displayOrder: 7,
  },
  {
    key: "flat", category: "physical", i18nKey: "rider:racePreview.derived.flat",
    shortLabel: "FLT", icon: "▬", derivation: { source: "pcm", stat: "stat_fl" },
    inContrast: true, inClassifier: true, storageOrder: 3, displayOrder: 6,
  },
  {
    key: "tempo", category: "physical", i18nKey: "rider:racePreview.derived.tempo",
    shortLabel: "TMP", icon: "◈", derivation: { source: "pcm", stat: "stat_kb" },
    inContrast: true, inClassifier: true, storageOrder: 4, displayOrder: 2,
  },
  {
    key: "sprint", category: "physical", i18nKey: "rider:racePreview.derived.sprint",
    shortLabel: "SPR", icon: "↯", derivation: { source: "pcm", stat: "stat_sp" },
    inContrast: true, inClassifier: true, storageOrder: 5, displayOrder: 4,
  },
  {
    key: "acceleration", category: "physical", i18nKey: "rider:racePreview.derived.acceleration",
    shortLabel: "ACC", icon: "▷", derivation: { source: "pcm", stat: "stat_acc" },
    inContrast: true, inClassifier: true, storageOrder: 6, displayOrder: 5,
  },
  {
    key: "punch", category: "physical", i18nKey: "rider:racePreview.derived.punch",
    shortLabel: "PCH", icon: "✦", derivation: { source: "pcm", stat: "stat_bk" },
    inContrast: true, inClassifier: true, storageOrder: 7, displayOrder: 3,
  },
  {
    key: "endurance", category: "physical", i18nKey: "rider:racePreview.derived.endurance",
    shortLabel: "END", icon: "◎", derivation: { source: "pcm", stat: "stat_udh" },
    inContrast: true, inClassifier: true, storageOrder: 8, displayOrder: 8,
  },
  {
    key: "recovery", category: "physical", i18nKey: "rider:racePreview.derived.recovery",
    shortLabel: "REC", icon: "↺", derivation: { source: "pcm", stat: "stat_res" },
    inContrast: true, inClassifier: true, storageOrder: 9, displayOrder: 10,
  },
  {
    key: "durability", category: "physical", i18nKey: "rider:racePreview.derived.durability",
    shortLabel: "DUR", icon: "⬣", derivation: { source: "pcm", stat: "stat_mod" },
    inContrast: true, inClassifier: true, storageOrder: 10, displayOrder: 9,
  },
  {
    key: "descending", category: "technical", i18nKey: "rider:racePreview.derived.descending",
    shortLabel: "DSC", icon: "▽", derivation: { source: "pcm", stat: "stat_ned" },
    inContrast: false, inClassifier: true, storageOrder: 11, displayOrder: 13,
  },
  {
    key: "cobblestone", category: "technical", i18nKey: "rider:racePreview.derived.cobblestone",
    shortLabel: "COB", icon: "⬡", derivation: { source: "pcm", stat: "stat_bro" },
    inContrast: false, inClassifier: true, storageOrder: 12, displayOrder: 14,
  },
  {
    key: "positioning", category: "technical", i18nKey: "rider:racePreview.derived.positioning",
    shortLabel: "POS", icon: "⊹", derivation: { source: "skill" },
    inContrast: false, inClassifier: false, storageOrder: 13, displayOrder: 15,
  },
  {
    key: "aggression", category: "mental", i18nKey: "rider:racePreview.derived.aggression",
    shortLabel: "AGR", icon: "➹", derivation: { source: "skill" },
    inContrast: false, inClassifier: true, storageOrder: 14, displayOrder: 11,
  },
  {
    key: "tactics", category: "mental", i18nKey: "rider:racePreview.derived.tactics",
    shortLabel: "TAC", icon: "⌖", derivation: { source: "skill" },
    inContrast: false, inClassifier: false, storageOrder: 15, displayOrder: 12,
  },
]);

const byStorage = [...ABILITY_REGISTRY].sort((a, b) => a.storageOrder - b.storageOrder);

/** Alle 15 evne-keys i lagrings-/derivations-orden. */
export const REGISTRY_ABILITY_KEYS = Object.freeze(byStorage.map((a) => a.key));

/** De 10 evner der køres gennem kontrast-forstærkning. */
export const REGISTRY_CONTRAST_KEYS = Object.freeze(
  byStorage.filter((a) => a.inContrast).map((a) => a.key)
);

/** De 13 evner ryttertype-klassifikatoren tager som input. */
export const REGISTRY_CLASSIFIER_KEYS = Object.freeze(
  byStorage.filter((a) => a.inClassifier).map((a) => a.key)
);

/** evne → primær PCM-stat, kun for evner med pcm-derivation. */
export const REGISTRY_PRIMARY_STAT = Object.freeze(
  Object.fromEntries(
    byStorage
      .filter((a) => a.derivation.source === "pcm")
      .map((a) => [a.key, a.derivation.stat])
  )
);

/** Opslag på key. Ukendt key → undefined (kaldere skal selv fejle eksplicit). */
export function abilityMeta(key) {
  return ABILITY_REGISTRY.find((a) => a.key === key);
}
